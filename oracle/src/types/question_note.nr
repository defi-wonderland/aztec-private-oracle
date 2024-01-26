use dep::aztec::{
    note::{
        note_header::NoteHeader,
        note_interface::NoteInterface,
        utils::compute_note_hash_for_read_or_nullify,
    },
    oracle::{
        get_public_key::get_public_key,
    },
    log::emit_encrypted_log,
    context::PrivateContext,
    protocol_types::{
        address::AztecAddress
    }
};

/// @member request: the question asked
/// @member requester_address: the address of the requester
/// @member requester_pk: the public key of the requester
/// @member divinity_address: the address of the divinity
/// @member shared_nullifier_key: the shared nullifier key (a random value existing in both the divinity and the requester set of notes)
/// @member escrow_randomness: the randomness for the created escrow
/// @member header: the note header
struct QuestionNote {
    request: Field,
    requester_address: AztecAddress,
    divinity_address: AztecAddress,
    shared_nullifier_key: Field,
    escrow_randomness: Field,
    callback: [Field; 6],
    header: NoteHeader
}

global QUESTION_NOTE_LEN: Field = 11;

impl QuestionNote {
    pub fn new(
            _request: Field,
            _requesterAddress: AztecAddress,
            _divinityAddress: AztecAddress,
            _sharedNullifierKey: Field,
            _escrowRandomness: Field,
            _callback: [Field; 6]
        ) -> Self {

        QuestionNote {
            request: _request,
            requester_address: _requesterAddress,
            divinity_address: _divinityAddress,
            shared_nullifier_key: _sharedNullifierKey,
            escrow_randomness: _escrowRandomness,
            callback: _callback,
            header: NoteHeader::empty(),
        }

    }

    pub fn serialize(self) -> [Field; QUESTION_NOTE_LEN] {
        [self.request, self.requester_address.to_field(), self.divinity_address.to_field(), self.shared_nullifier_key, self.escrow_randomness, self.callback[0], self.callback[1], self.callback[2], self.callback[3], self.callback[4], self.callback[5]]
    }

    pub fn deserialize(preimage: [Field; QUESTION_NOTE_LEN]) -> Self {
        QuestionNote {
            request: preimage[0],
            requester_address: AztecAddress::from_field(preimage[1]),
            divinity_address: AztecAddress::from_field(preimage[2]),
            shared_nullifier_key: preimage[3], 
            escrow_randomness: preimage[4],
            callback: [preimage[5], preimage[6], preimage[7], preimage[8], preimage[9], preimage[10]],
            header: NoteHeader::empty(),
        }
    }

    pub fn compute_note_hash(self) -> Field {
        dep::std::hash::pedersen_hash(serialize(self))
    }

    pub fn compute_nullifier(self, _context: &mut PrivateContext) -> Field {
        self.compute_nullifier_without_context()
    }

    pub fn compute_nullifier_without_context(self) -> Field {
        let note_hash_for_nullify = compute_note_hash_for_read_or_nullify(QuestionNoteMethods, self);
        let nullifier_key = self.shared_nullifier_key;

        dep::std::hash::pedersen_hash([
            note_hash_for_nullify,
            nullifier_key,
        ])
    }

    pub fn set_header(&mut self, header: NoteHeader) {
        self.header = header;
    }

    // Broadcasts the note as an encrypted log on L1.
    pub fn broadcast(self, context: &mut PrivateContext, slot: Field) {
        let encryption_pub_key = get_public_key(self.requester_address);

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

fn compute_nullifier(note: QuestionNote, context: &mut PrivateContext) -> Field {
    note.compute_nullifier(context)
}

fn compute_nullifier_without_context(note: QuestionNote) -> Field {
    note.compute_nullifier_without_context()
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
    compute_nullifier_without_context,
    get_header,
    set_header,
    broadcast
};