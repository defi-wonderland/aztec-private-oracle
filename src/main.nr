mod types;

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
 
contract PrivateOracle {
    use crate::types::question_note:: {QuestionNote, QuestionNoteMethods, QUESTION_NOTE_LEN};
    use crate::types::answer_note:: {AnswerNote, AnswerNoteMethods, ANSWER_NOTE_LEN};

    use dep::std::option::Option;

    use dep::aztec::context::Context;
    use dep::aztec::log::emit_encrypted_log;
    use dep::aztec::note::{
        note_header::NoteHeader,
        note_interface::NoteInterface,
        note_getter_options::NoteGetterOptions,
        note_viewer_options::NoteViewerOptions,
        utils as note_utils
    };
    use dep::aztec::oracle::{
        get_public_key::get_public_key,
        rand::rand
    };
    use dep::aztec::state_vars::public_state::PublicState;
    use dep::aztec::state_vars::map::Map;
    use dep::aztec::state_vars::set::Set;
    use dep::aztec::state_vars::singleton::Singleton;
    use dep::aztec::state_vars::immutable_singleton::ImmutableSingleton;
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
        let question_getter_option = NoteGetterOptions::new().select(0, question).set_limit(1);
        let question_note = storage.questions.get_notes(question_getter_option)[0];
        assert(question_note.is_none());

        // Store the question in the requester notes and send it to the oracle notes too
        let random_nullifier_shared_key = rand();

        let mut new_question: QuestionNote = QuestionNote::new(
            question,
            sender, 
            divinity_address,
            random_nullifier_shared_key
        );

        storage.questions.insert(&mut new_question);

        let serialized = new_question.serialize();

        // Encrypt the qyestion in the requester notes - todo: we might remove it later, as the requester doesn't need to access the note (only contract)
        let requester_pub_key = get_public_key(sender);

        emit_encrypted_log(
            &mut context,
            address_this,
            QUESTION_SET_SLOT,
            requester_pub_key,
            serialized,
        );

        // Encrypt the question in the divinity notes
        let divinity_pub_key = get_public_key(divinity_address);


        emit_encrypted_log(
            &mut context,
            address_this,
            QUESTION_SET_SLOT,
            divinity_pub_key,
            serialized,
        ); 
    }


    // Divinity submit an answer to a given question
    #[aztec(private)]
    fn submit_answer(question: Field, answer: Field) {
        let storage = Storage::init(Context::private(&mut context));
        let caller = context.msg_sender();
        let address_this = context.this_address();

        // Filter request note to check if existing and accesible for this divinity
        let request_filter = NoteGetterOptions::new()
            .select(0, question)
            .select(2, caller)
            .set_limit(1);
        
        // Get the question note
        let request = storage.questions.get_notes(request_filter)[0];

        // Check if exists
        assert(!request.is_none());

        // Check if this question was previously answered
        let answerFilter = NoteGetterOptions::new()
            .select(0, question)
            .set_limit(1);
        
        let mut answer: AnswerNote = AnswerNote::new(
            question,
            answer,
            caller
        );

        let answer_note = storage.answers.get_notes(answerFilter)[0];

        // Hasn't been answered yet (in another request)?
        if answer_note.is_none() {
            // Create a new note and store it in the oracle set
            storage.answers.insert(&mut answer);

            let answer_serialized = answer.serialize();

            // Encrypt the answer in the oracle notes
            emit_encrypted_log(
                &mut context,
                address_this,
                ANSWER_SET_SLOT,
                get_public_key(caller),
                answer_serialized,
            );
        } else {
            // Update the answer to the preexisting one
            answer.answer = answer_note.unwrap_unchecked().answer;
        }

        // Encrypt the answer in the requester notes
        let requester_pub_key = get_public_key(request.unwrap_unchecked().requester_address);

        let encrypted = answer.serialize();

        emit_encrypted_log(
            &mut context,
            address_this,
            ANSWER_SET_SLOT,
            requester_pub_key,
            encrypted,
        );

        // Nullify the question note
        storage.questions.remove(request.unwrap_unchecked());
    }

    // Requester consults the answer to one of their questions
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