use dep::aztec::{
    note::{
        note_header::NoteHeader,
        note_interface::NoteInterface,
        utils::compute_note_hash_for_read_or_nullify,
    },
    oracle::{
        get_public_key::get_public_key,
    },
    context::PrivateContext,
    protocol_types::address::AztecAddress
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
        dep::std::hash::pedersen_hash([
            self.fee
        ])
    }

    fn compute_nullifier(self, _context: &mut PrivateContext) -> Field {
        self.compute_nullifier_without_context()
    }

    fn compute_nullifier_without_context(self) -> Field {
        let _ = self; // Avoid compiler warning (same # acir opcodes and backend size)
         0
    }

    fn set_header(&mut self, header: NoteHeader) {
        self.header = header;
    }

    fn broadcast(self, context: &mut PrivateContext, slot: Field) {
        // no owner == no broadcast
        let _ = self; // Avoid compiler warning (same # acir opcodes and backend size)
        let __ = context;
        let ___ = slot;
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

fn compute_nullifier(note: FeeNote, context: &mut PrivateContext) -> Field {
    note.compute_nullifier(context)
}

fn compute_nullifier_without_context(note: FeeNote) -> Field {
    note.compute_nullifier_without_context()
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
    compute_nullifier_without_context,
    get_header,
    set_header,
    broadcast
};