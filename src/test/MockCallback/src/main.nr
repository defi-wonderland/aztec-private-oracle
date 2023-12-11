contract MockOracleCallback {
    use dep::aztec::{
        context::{PrivateContext, PublicContext, Context},
        state_vars::public_state::PublicState,
        selector::compute_selector,
        types::type_serialization::TypeSerializationInterface
    };

    use dep::aztec::oracle::debug_log::{ debug_log, debug_log_field, debug_log_format };

    global CALLBACK_DATA_LENGTH = 6;

    struct Callback_Data {
        answer: Field,
        data: [Field; 5],
    }

    impl Callback_Data {
        pub fn new(answer: Field, data: [Field; 5]) -> Self {
            Callback_Data {
                answer,
                data,
            }
        }

        fn deserialize(preimage: [Field; CALLBACK_DATA_LENGTH]) -> Self {
            Callback_Data {
                answer: preimage[0],
                data: [preimage[1], preimage[2], preimage[3], preimage[4], preimage[5]]
            }
        }

        fn serialize(self) -> [Field; CALLBACK_DATA_LENGTH] {
            [
                self.answer,
                self.data[0],
                self.data[1],
                self.data[2],
                self.data[3],
                self.data[4],
            ]
        }
    }

    fn serialize_callback_data(callback_data: Callback_Data) -> pub [Field; CALLBACK_DATA_LENGTH] {
        callback_data.serialize()
    }

    fn deserialize_callback_data(preimage: [Field; CALLBACK_DATA_LENGTH]) -> pub Callback_Data {
        Callback_Data::deserialize(preimage)
    }

    global CallbackDataSerializationMethods = TypeSerializationInterface {
        serialize: serialize_callback_data,
        deserialize: deserialize_callback_data,
    };

    struct Storage {
        data_received: PublicState<Callback_Data, CALLBACK_DATA_LENGTH>,
    }

    impl Storage {
        pub fn init(context: Context) -> Self {
            Storage {
                // -- Public --
                data_received: PublicState::new(context, 1, CallbackDataSerializationMethods)
            }
        }
    }

    #[aztec(private)]
    fn constructor() {
    }

    #[aztec(private)]
    fn oracle_callback(answer: Field, data: [Field; 5]) {      
        debug_log("--------------- oracle_callback called ---------------");
        debug_log_format("answer: {0}", [answer]);
        debug_log_format("Data: {0} {1} {2} {3} {4}", [data[0], data[1], data[2], data[3], data[4]]);

        // Intentional public leak
        context.call_public_function(
            context.this_address(), 
            compute_selector("write_received_data(Field,[Field; 5])"), 
            serialize_callback_data(Callback_Data::new(answer, data)));
    }

    #[aztec(public)]
    fn write_received_data(answer: Field, data: [Field; 5]) {
        storage.data_received.write(Callback_Data::new(answer, data));
    }

    #[aztec(public)]
    unconstrained fn get_received_data() -> Callback_Data {
        storage.data_received.read()
    }

    unconstrained fn compute_note_hash_and_nullifier(contract_address: Field, nonce: Field, storage_slot: Field, serialized_note: [Field; 0]) -> [Field; 4] {
        [0,0,0,0]
    }
}