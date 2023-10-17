/**
This first version is "free for use" (no fee) and "free for all" (anyone can answer to any question).

Overall design:
- Requester Alice: I would like Bob to tell me X. Here is the fee.

- Bob: Here is the answer Y to Alice, the fee is now mine
or
- Alice: nvm, I'm good, cancel and give me my money back


Bob is whoever Alice wants.
If Charlie asks X to Bob, Bob will answer Y too.
Eve cannot know anything beside: the token to use, the fee amount
Bob can withdraw it's token whenever.


Side-side-quest
If possible, Bob can post a proof of knowledge ("here is the proof that the thumbnail Z correspond to the high res picture Y")


Tech TL;DR with stuff to clarify:
Create request:
- Fee: value_note balanceOf[Alice] += delta token
- Request:
-- Alice request notes: { request, Alice PK, Bob, randomSalt } - nullifier: Pedersen(note_hash, randomSalt)
-- Bob request notes: adding the same note - nullifier is the same (P(note_hash, randomSalt))

Answer:
- Fee: Should be the same nullifier pattern (then nullify Alice value_note and create for Bob)?
- Check if previously answered (then reuse it, if not, use the answer passed as arg)
- Replace note for a note with the answer
- Add note to Alice notes, with the answer
--> nullifier should be different here -> another note type (answer_note)

*/
mod types;
 
contract PrivateOracle {
    use crate::types::question_note:: {QuestionNote, QuestionNoteMethods, QUESTION_NOTE_LEN};
    use crate::types::answer_note:: {AnswerNote, AnswerNoteMethods, ANSWER_NOTE_LEN};

    use dep::std::option::Option;

    use dep::aztec::context::Context;
    use dep::aztec::log::emit_encrypted_log;
    use dep::aztec::note::{
        note_getter_options::NoteGetterOptions,
        note_header::NoteHeader,
        note_interface::NoteInterface,
        note_viewer_options::NoteViewerOptions,
        utils as note_utils
    };
    use dep::aztec::oracle::{
        get_public_key::get_public_key,
        rand::rand
    };
    use dep::aztec::state_vars::{
        public_state::PublicState,
        map::Map,
        set::Set,
        singleton::Singleton,
        immutable_singleton::ImmutableSingleton
    };
    use dep::aztec::types::type_serialization::field_serialization::{ FieldSerializationMethods, FIELD_SERIALIZED_LEN};
    
    global QUESTION_SET_SLOT = 1;
    global ANSWER_SET_SLOT = 2;

    struct Storage {
        questions: Set<QuestionNote, QUESTION_NOTE_LEN>,
        answers: Set<AnswerNote, ANSWER_NOTE_LEN> // TODO: use a set of immutable singletons
        // payment_token: PublicState<Field, FIELD_SERIALIZED_LEN>,
        // fee: PublicState<Field, FIELD_SERIALIZED_LEN>,
        // stored_balance: PublicState<Field, FIELD_SERIALIZED_LEN>,
        // balance_of: Map<Set<ValueNote, VALUE_NOTE_LEN>>,
    }

    impl Storage {
        fn init(context: Context) -> pub Self {
            Storage {
                // -- Public --

                // -- Private --
                // Set of questions
                questions: Set::new(context, QUESTION_SET_SLOT, QuestionNoteMethods),
                // Set of answers
                answers: Set::new(context, ANSWER_SET_SLOT, AnswerNoteMethods)
            }
        }
    }
 
    // Constructs the contract.
    #[aztec(private)] 
    fn constructor() {
    }

    // Requester submit a question
    #[aztec(private)]
    fn submit_question(question: Field, divinity_address: Field) {
        let storage = Storage::init(Context::private(&mut context));
        let address_this = context.this_address();
        let sender = context.msg_sender();

        // Assert if question doesn't already exist from the same requester
        let question_getter_option = NoteGetterOptions::new().select(0, question).select(1, sender).set_limit(1);
        let question_note = storage.questions.get_notes(question_getter_option)[0];

        assert(question_note.is_none());

        // Store the question in the requester and the divinity notes
        let random_nullifier_shared_key = rand();

        let mut new_question: QuestionNote = QuestionNote::new(
            question,
            sender, 
            divinity_address,
            random_nullifier_shared_key
        );

        // Commit the note in the data tree
        storage.questions.insert(&mut new_question);

        // Encrypt/send the question to the requester notes - todo: we might remove this event later, as the requester doesn't need to read the note (only contract)
        emit_encrypted_log(
            &mut context,
            address_this,
            QUESTION_SET_SLOT,
            get_public_key(sender),
            new_question.serialize(),
        );

        // Encrypt/send the question in the divinity notes
        emit_encrypted_log(
            &mut context,
            address_this,
            QUESTION_SET_SLOT,
            get_public_key(divinity_address),
            new_question.serialize(),
        ); 
    }

    // Divinity submit an answer to a given question
    #[aztec(private)]
    fn submit_answer(question: Field, requester: Field, answer: Field) { 
        let storage = Storage::init(Context::private(&mut context));
        let divinity_calling = context.msg_sender();
        let address_this = context.this_address();

        // Filter request note to check if existing and accesible for this divinity
        let request_filter = NoteGetterOptions::new()
            .select(0, question)
            .select(1, requester)
            .select(2, divinity_calling)
            .set_limit(1);
        
        // Get the question note
        let request = storage.questions.get_notes(request_filter)[0];

        // Check if the question exists
        assert(!request.is_none());

        // Check if this question was previously answered
        let answerFilter = NoteGetterOptions::new()
            .select(0, question)
            .select(2, divinity_calling)
            .set_limit(1);
        
        let stored_answer_note = storage.answers.get_notes(answerFilter)[0];

        // Create new notes for both sides
        let mut new_answer_note_for_requester: AnswerNote = AnswerNote::new(
            question,
            answer,
            requester
        );

        let mut new_answer_note_for_divinity: AnswerNote = AnswerNote::new(
            question,
            answer,
            divinity_calling
        );

        // Hasn't been answered yet (in another request)?
        if stored_answer_note.is_none() {
            // Encrypt the answer in the oracle notes
            emit_encrypted_log(
                &mut context,
                address_this,
                ANSWER_SET_SLOT,
                get_public_key(divinity_calling),
                new_answer_note_for_divinity.serialize(),
            );
        }
        else {
            // Already answered previously?
            // Modify the answer to the preexisting one
            new_answer_note_for_requester = AnswerNote::new(
                question,
                stored_answer_note.unwrap_unchecked().answer,
                requester
            );

            new_answer_note_for_divinity = AnswerNote::new(
                question,
                stored_answer_note.unwrap_unchecked().answer,
                divinity_calling
            );
        }

        // Commit both notes in data tree, as insert in an if() (ie to avoid duplicating the divinity one)
        // fails (unreachable code panick)
        storage.answers.insert(&mut new_answer_note_for_divinity);
        storage.answers.insert(&mut new_answer_note_for_requester);

        // Send the note to the requester (divinity already has the answer)
        let requester_pub_key = get_public_key(request.unwrap_unchecked().requester_address);

        emit_encrypted_log(
            &mut context,
            address_this,
            ANSWER_SET_SLOT,
            requester_pub_key,
            new_answer_note_for_requester.serialize(),
        );

        // Nullify the question note (will nullify both divinity and requester notes, via the shared key)
        storage.questions.remove(request.unwrap_unchecked());
    }

    // Requester consults the answer to one of their questions
    // Onchain use - see the unconstrained get_answer_unconstrained(..) infra for frontend integration
    #[aztec(private)]
    fn consult_answer(question: Field) -> Field {
        let storage = Storage::init(Context::private(&mut context));
        let caller = context.msg_sender();
        
        // create the answer_getter_option: select answer and limit
        let answer_getter_option = NoteGetterOptions::new().select(0, question).select(2, caller).set_limit(1);

        // filter the notes - get_notes returns the note **that the account has access to** (if not, add it to the Option)
        let answered_note = storage.answers.get_notes(answer_getter_option)[0].unwrap_unchecked();
        
        // Return the answer
        answered_note.answer
    }

    // Requester cancels a question - no real utility here, will be usefull when request bound an amount, waiting for the answer
    #[aztec(private)]
    fn cancel_question(question: Field) {
        let storage = Storage::init(Context::private(&mut context));
        let caller = context.msg_sender();

        // create the Answer_getter_option: SELECT by address and max number of requests
        let question_getter_option = NoteGetterOptions::new().select(0, question).select(1, caller).set_limit(1);
        let question_note = storage.questions.get_notes(question_getter_option)[0].unwrap_unchecked();

        // nullify the note
        storage.questions.remove(question_note);
    }

    // Get the answer to a question - unconstrained. Returns all answers to the same questions, from all the divinities
    // Obviously, only the question from the sender can be read
    // Keeping a requester arg to remind of this unconstrained nature (ts .view has a from option as  an alternative)
    unconstrained fn get_answer_unconstrained(question: Field, requester: Field) -> AnswerNote {
    // MAX_NOTES_PER_PAGE == 10
    // https://github.com/AztecProtocol/aztec-packages/blob/2d498b352364debf59af940f0a69c453651a4ad0/yarn-project/aztec-nr/aztec/src/constants_gen.nr#L53

    //TODO: paginate
        // create the filter
        let answer_getter_option = NoteViewerOptions::new().select(0, question).select(2, requester).set_limit(1);

        // filter the notes and return the answer-
        storage.answers.view_notes(answer_getter_option)[0].unwrap_unchecked()
    }

    // Computes note hash and nullifier.
    unconstrained fn compute_note_hash_and_nullifier(contract_address: Field, nonce: Field, storage_slot: Field, preimage: [Field; QUESTION_NOTE_LEN]) -> [Field; 4] {
        let note_header = NoteHeader::new(contract_address, nonce, storage_slot);

        if(storage_slot == QUESTION_SET_SLOT) {
            note_utils::compute_note_hash_and_nullifier(QuestionNoteMethods, note_header, preimage)
        }
        else {
            note_utils::compute_note_hash_and_nullifier(AnswerNoteMethods, note_header, preimage)
        }
    }
}