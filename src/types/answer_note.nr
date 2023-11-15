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

struct AnswerNote {
    request: Field,
    answer: Field,
    requester: AztecAddress, // Address of the requester
    divinity: AztecAddress, // Address of the divinity
    owner: AztecAddress, // Owner of this answer, either the divinity or the requester
    header: NoteHeader
}

global ANSWER_NOTE_LEN: Field = 5;

impl AnswerNote {
    pub fn new(_request: Field, _answer: Field, _requester: AztecAddress, _divinity: AztecAddress, _owner: AztecAddress) -> Self {
        AnswerNote {
            request: _request,
            answer: _answer,
            requester: _requester,
            divinity: _divinity,
            owner: _owner,
            header: NoteHeader::empty(),
        }
    }

    fn serialize(self) -> [Field; ANSWER_NOTE_LEN] {
        [self.request, self.answer, self.requester.address, self.divinity.address, self.owner.address]
    }

    fn deserialize(preimage: [Field; ANSWER_NOTE_LEN]) -> Self {
        AnswerNote {
            request: preimage[0],
            answer: preimage[1],
            requester: AztecAddress::new(preimage[2]),
            divinity: AztecAddress::new(preimage[3]),
            owner: AztecAddress::new(preimage[4]),
            header: NoteHeader::empty(),
        }
    }

    fn compute_note_hash(self) -> Field {
        dep::std::hash::pedersen_hash([
            self.request,
            self.answer,
            self.requester.address,
            self.divinity.address,
            self.owner.address
        ])
    }

    // No nullifier needed -> only one divinity has access to the original request and the answer cannot change ever
    // still returning a value (instead of assert(false) for instance) as we need it for compute_note_hash_for_read_or_nullify
    // to emit encrypte logs
    fn compute_nullifier(self) -> Field {
        let _ = self; // Avoid compiler warning (same # acir opcodes and backend size)
        0
    }

    fn set_header(&mut self, header: NoteHeader) {
        self.header = header;
    }

    fn broadcast(self, context: &mut PrivateContext, slot: Field) {
        let encryption_pub_key = get_public_key(self.owner.address);
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

fn compute_nullifier(note: AnswerNote) -> Field {
    note.compute_nullifier()
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
    get_header,
    set_header,
    broadcast,
};