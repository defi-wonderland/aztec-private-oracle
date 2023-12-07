contract MockOracleCallback {
    use dep::aztec::types::type_serialization::bool_serialization::{ BoolSerializationMethods, BOOL_SERIALIZED_LEN};

    struct Storage {
        has_been_called: PublicState<bool, BOOL_SERIALIZED_LEN>,
    }

    impl Storage {
        fn init(context: Context) -> Self {
            Storage {
                // -- Public --
                has_been_called: PublicState::new(context, 1, BoolSerializationMethods),
            }
        }
    }

    #[aztec(private)]
    constructor() {
        storage.has_been_called.write(false);
    }

    #[aztec(private)]
    fn oracle_callback(answer: Field, data: [Field; 5]) {
        // Do nothing and avoid warning
        assert(data==data);
        assert(answer==answer);
        debug_log("Oracle callback called");
        storage.has_been_called.write(true);
    }

    unconstrained fn compute_note_hash_and_nullifier(contract_address: Field, nonce: Field, storage_slot: Field, preimage: [Field; BOOL_SERIALIZED_LEN]) -> [Field; 4] {
        let note_header = NoteHeader::new(contract_address, nonce, storage_slot);
        note_utils::compute_note_hash_and_nullifier(BoolSerializationMethods, note_header, preimage)
    }
}