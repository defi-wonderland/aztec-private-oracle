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

struct AnswerNote {
    request: Field,
    requester: AztecAddress, // Address of the requester
    divinity: AztecAddress, // Address of the divinity
    owner: AztecAddress, // Owner of this answer, either the divinity or the requester
    answer: [Field; 3],
    header: NoteHeader
}

global ANSWER_NOTE_LEN: Field = 7;

impl AnswerNote {
    pub fn new(_request: Field, _answer: [Field; 3], _requester: AztecAddress, _divinity: AztecAddress, _owner: AztecAddress) -> Self {
        AnswerNote {
            request: _request,
            requester: _requester,
            divinity: _divinity,
            owner: _owner,
            answer: _answer,
            header: NoteHeader::empty(),
        }
    }

    fn serialize(self) -> [Field; ANSWER_NOTE_LEN] {
        [self.request, self.requester.to_field(), self.divinity.to_field(), self.owner.to_field(), self.answer[0], self.answer[1], self.answer[2]]
    }

    pub fn deserialize(preimage: [Field; ANSWER_NOTE_LEN]) -> Self {
        AnswerNote {
            request: preimage[0],
            requester: AztecAddress::from_field(preimage[1]),
            divinity: AztecAddress::from_field(preimage[2]),
            owner: AztecAddress::from_field(preimage[3]),
            answer: [preimage[4], preimage[5], preimage[6]],
            header: NoteHeader::empty(),
        }
    }

    pub fn compute_note_hash(self) -> Field {
        dep::std::hash::pedersen_hash([
            self.request,
            self.requester.to_field(),
            self.divinity.to_field(),
            self.owner.to_field(),
            self.answer[0],
            self.answer[1],
            self.answer[2]
        ])
    }

    // No nullifier needed -> only one divinity has access to the original request and the answer cannot change ever
    // still returning a value (instead of assert(false) for instance) as we need it for compute_note_hash_for_read_or_nullify
    // to emit encrypte logs
    pub fn compute_nullifier(self, _context: &mut PrivateContext) -> Field {
        self.compute_nullifier_without_context()
    }

    pub fn compute_nullifier_without_context(self) -> Field {
        let _ = self; // Avoid compiler warning (same # acir opcodes and backend size)
        0
    }

    pub fn set_header(&mut self, header: NoteHeader) {
        self.header = header;
    }

    pub fn broadcast(self, context: &mut PrivateContext, slot: Field) {
        let encryption_pub_key = get_public_key(self.owner);
        emit_encrypted_log(
            context,
            (*context).this_address(),
            slot,
            encryption_pub_key,
            self.serialize(),
        );
    }
}

fn deserialize(preimage: [Field; ANSWER_NOTE_LEN]) -> AnswerNote {
    AnswerNote::deserialize(preimage)
}

fn serialize(note: AnswerNote) -> [Field; ANSWER_NOTE_LEN] {
    note.serialize()
}

fn compute_note_hash(note: AnswerNote) -> Field {
    note.compute_note_hash()
}

fn compute_nullifier(note: AnswerNote, context: &mut PrivateContext) -> Field {
    note.compute_nullifier(context)
}

fn compute_nullifier_without_context(note: AnswerNote) -> Field {
    note.compute_nullifier_without_context()
}

fn get_header(note: AnswerNote) -> NoteHeader {
    note.header
}

fn set_header(note: &mut AnswerNote, header: NoteHeader) {
    note.set_header(header)
}

fn broadcast(context: &mut PrivateContext, slot: Field, note: AnswerNote) {
    note.broadcast(context, slot);
}

global AnswerNoteMethods = NoteInterface {
    deserialize,
    serialize,
    compute_note_hash,
    compute_nullifier,
    compute_nullifier_without_context,
    get_header,
    set_header,
    broadcast,
};