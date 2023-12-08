contract MockOracleCallback {
    use dep::aztec::types::type_serialization::bool_serialization::{ BoolSerializationMethods, BOOL_SERIALIZED_LEN};

    use dep::aztec::{
        context::{PrivateContext, PublicContext, Context},
        state_vars::public_state::PublicState
    };

    use dep::aztec::oracle::debug_log::{ debug_log, debug_log_field, debug_log_format };


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
    fn oracle_callback(answer: Field, data: [Field; 5]) {
        // Do nothing and avoid warning
        assert(data==data);
        assert(answer==answer);
        debug_log("Oracle callback called");
        storage.has_been_called.write(true);
    }

    unconstrained fn compute_note_hash_and_nullifier(contract_address: Field, nonce: Field, storage_slot: Field, serialized_note: [Field; 0]) -> [Field; 4] {
        [0, 0, 0, 0]
    }
}