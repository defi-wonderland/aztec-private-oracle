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

struct PaymentTokenNote {
    payment_token: AztecAddress,
    header: NoteHeader
}

global PAYMENT_TOKEN_NOTE_LEN: Field = 1;

impl PaymentTokenNote {
    pub fn new(_payment_token: AztecAddress) -> Self {
        PaymentTokenNote {
            payment_token: _payment_token,
            header: NoteHeader::empty(),
        }
    }

    fn serialize(self) -> [Field; PAYMENT_TOKEN_NOTE_LEN] {
        [self.payment_token.to_field()]
    }

    fn deserialize(preimage: [Field; PAYMENT_TOKEN_NOTE_LEN]) -> Self {
        PaymentTokenNote {
            payment_token: AztecAddress::from_field(preimage[0]),
            header: NoteHeader::empty(),
        }
    }

    fn compute_note_hash(self) -> Field {
        dep::std::hash::pedersen_hash([
            self.payment_token.to_field()
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
        let _ = self; // Avoid compiler warning (same # acir opcodes and backend size)
        let __ = context;
        let ___ = slot;
    }
}

fn deserialize(preimage: [Field; PAYMENT_TOKEN_NOTE_LEN]) -> PaymentTokenNote {
    PaymentTokenNote::deserialize(preimage)
}

fn serialize(note: PaymentTokenNote) -> [Field; PAYMENT_TOKEN_NOTE_LEN] {
    note.serialize()
}

fn compute_note_hash(note: PaymentTokenNote) -> Field {
    note.compute_note_hash()
}

fn compute_nullifier(note: PaymentTokenNote, context: &mut PrivateContext) -> Field {
    note.compute_nullifier(context)
}

fn compute_nullifier_without_context(note: PaymentTokenNote) -> Field {
    note.compute_nullifier_without_context()
}

fn get_header(note: PaymentTokenNote) -> NoteHeader {
    note.header
}

fn set_header(note: &mut PaymentTokenNote, header: NoteHeader) {
    note.set_header(header)
}

fn broadcast(context: &mut PrivateContext, slot: Field, note: PaymentTokenNote) {
    note.broadcast(context, slot);
}

global PaymentTokenNoteMethods = NoteInterface {
    deserialize,
    serialize,
    compute_note_hash,
    compute_nullifier,
    compute_nullifier_without_context,
    get_header,
    set_header,
    broadcast
};