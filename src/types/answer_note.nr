use dep::aztec::note::{
    note_header::NoteHeader,
    note_interface::NoteInterface,
    utils::compute_note_hash_for_read_or_nullify,
};
use dep::aztec::oracle::{
    get_secret_key::get_secret_key,
    get_public_key::get_public_key,
};

struct AnswerNote {
    request: Field,
    answer: Field,
    owner: Field, // Owner of this answer, either the divinity or the requester
    header: NoteHeader
}

global ANSWER_NOTE_LEN: Field = 3;

impl AnswerNote {
    fn new(_request: Field, _answer: Field, _owner: Field) -> Self {
        AnswerNote {
            request: _request,
            answer: _answer,
            owner: _owner,
            header: NoteHeader::empty(),
        }
    }

    fn serialize(self) -> [Field; ANSWER_NOTE_LEN] {
        [self.request, self.answer, self.owner]
    }

    fn deserialize(preimage: [Field; ANSWER_NOTE_LEN]) -> Self {
        AnswerNote {
            request: preimage[0],
            answer: preimage[1],
            owner: preimage[2],
            header: NoteHeader::empty(),
        }
    }

    fn compute_note_hash(self) -> Field {
        dep::std::hash::pedersen([
            self.request,
            self.answer,
            self.owner
        ])[0]
    }

// TODO: refactor to a set of immutable singleton instead
    // No nullifier needed -> only one divinity has access to the original request and the answer cannot change ever
    fn compute_nullifier(self) -> Field {
        0
    }

    fn set_header(&mut self, header: NoteHeader) {
        self.header = header;
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

global AnswerNoteMethods = NoteInterface {
    deserialize,
    serialize,
    compute_note_hash,
    compute_nullifier,
    get_header,
    set_header,
};