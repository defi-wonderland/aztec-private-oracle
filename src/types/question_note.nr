use dep::aztec::{
    note::{
        note_header::NoteHeader,
        note_interface::NoteInterface,
        utils::compute_note_hash_for_read_or_nullify,
    },
    oracle::{
        get_secret_key::get_secret_key,
        get_public_key::get_public_key,
    },
    log::emit_encrypted_log,
    context::PrivateContext,
    types::{
        point::Point,
        address::AztecAddress
    }
};

/// @member request: the question asked
/// @member requester_address: the address of the requester
/// @member requester_pk: the public key of the requester
/// @member divinity_address: the address of the divinity
/// @member shared_nullifier_key: the shared nullifier key (a random value existing in both the divinity and the requester set of notes)
/// @member header: the note header
struct QuestionNote {
    request: Field,
    requester_address: AztecAddress,
    divinity_address: AztecAddress,
    shared_nullifier_key: Field,
    header: NoteHeader
}

global QUESTION_NOTE_LEN: Field = 4;

impl QuestionNote {
    pub fn new( _request: Field,
            _requesterAddress: AztecAddress,
            _divinityAddress: AztecAddress,
            _sharedNullifierKey: Field
        ) -> Self {

        QuestionNote {
            request: _request,
            requester_address: _requesterAddress,
            divinity_address: _divinityAddress,
            shared_nullifier_key: _sharedNullifierKey,
            header: NoteHeader::empty(),
        }

    }

    fn serialize(self) -> [Field; QUESTION_NOTE_LEN] {
        [self.request, self.requester_address.address, self.divinity_address.address, self.shared_nullifier_key]
    }

    fn deserialize(preimage: [Field; QUESTION_NOTE_LEN]) -> Self {
        QuestionNote {
            request: preimage[0],
            requester_address: AztecAddress::new(preimage[1]),
            divinity_address: AztecAddress::new(preimage[2]),
            shared_nullifier_key: preimage[3], 
            header: NoteHeader::empty(),
        }
    }

    fn compute_note_hash(self) -> Field {
        dep::std::hash::pedersen_hash(serialize(self))
    }

    fn compute_nullifier(self) -> Field {
        let note_hash_for_nullify = compute_note_hash_for_read_or_nullify(QuestionNoteMethods, self);
        let nullifier_key = self.shared_nullifier_key;

        dep::std::hash::pedersen_hash([
            note_hash_for_nullify,
            nullifier_key,
        ])
    }

    fn set_header(&mut self, header: NoteHeader) {
        self.header = header;
    }

    // Broadcasts the note as an encrypted log on L1.
    fn broadcast(self, context: &mut PrivateContext, slot: Field) {
        let encryption_pub_key = get_public_key(self.requester_address.address);

        emit_encrypted_log(
            context,
            (*context).this_address(),
            slot,
            encryption_pub_key,
            self.serialize(),
        );
    }
}

fn deserialize(preimage: [Field; QUESTION_NOTE_LEN]) -> QuestionNote {
    QuestionNote::deserialize(preimage)
}

fn serialize(note: QuestionNote) -> [Field; QUESTION_NOTE_LEN] {
    note.serialize()
}

fn compute_note_hash(note: QuestionNote) -> Field {
    note.compute_note_hash()
}

fn compute_nullifier(note: QuestionNote) -> Field {
    note.compute_nullifier()
}

fn get_header(note: QuestionNote) -> NoteHeader {
    note.header
}

fn set_header(note: &mut QuestionNote, header: NoteHeader) {
    note.set_header(header)
}

fn broadcast(context: &mut PrivateContext, slot: Field, note: QuestionNote) {
    note.broadcast(context, slot);
}

global QuestionNoteMethods = NoteInterface {
    deserialize,
    serialize,
    compute_note_hash,
    compute_nullifier,
    get_header,
    set_header,
    broadcast
};