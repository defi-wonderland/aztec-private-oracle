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
    context::PrivateContext,
    types::address::AztecAddress
};

struct FeeNote {
    fee: Field,
    header: NoteHeader,
}

global FEE_NOTE_LEN: Field = 1;

impl FeeNote {
    pub fn new(_fee: Field) -> Self {
        FeeNote {
            fee: _fee,
            header: NoteHeader::empty(),
        }
    }

    fn serialize(self) -> [Field; FEE_NOTE_LEN] {
        [self.fee]
    }

    fn deserialize(preimage: [Field; FEE_NOTE_LEN]) -> Self {
        FeeNote {
            fee: preimage[0],
            header: NoteHeader::empty(),
        }
    }

    fn compute_note_hash(self) -> Field {
        dep::std::hash::pedersen([
            self.fee
        ])[0]
    }

    fn compute_nullifier(self) -> Field {
         0
    }

    fn set_header(&mut self, header: NoteHeader) {
        self.header = header;
    }

    fn broadcast(self, context: &mut PrivateContext, slot: Field) {
        // no owner == no broadcast
    }
}

fn deserialize(preimage: [Field; FEE_NOTE_LEN]) -> FeeNote {
    FeeNote::deserialize(preimage)
}

fn serialize(note: FeeNote) -> [Field; FEE_NOTE_LEN] {
    note.serialize()
}

fn compute_note_hash(note: FeeNote) -> Field {
    note.compute_note_hash()
}

fn compute_nullifier(note: FeeNote) -> Field {
    note.compute_nullifier()
}

fn get_header(note: FeeNote) -> NoteHeader {
    note.header
}

fn set_header(note: &mut FeeNote, header: NoteHeader) {
    note.set_header(header)
}

fn broadcast(context: &mut PrivateContext, slot: Field, note: FeeNote) {
    note.broadcast(context, slot);
}

global FeeNoteMethods = NoteInterface {
    deserialize,
    serialize,
    compute_note_hash,
    compute_nullifier,
    get_header,
    set_header,
    broadcast
};