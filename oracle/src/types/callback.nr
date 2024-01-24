use dep::std;
use dep::aztec::context::{ PrivateContext, PublicContext };
use dep::aztec::protocol_types::{
    address::AztecAddress,
    constants::RETURN_VALUES_LENGTH,
    abis::function_selector::FunctionSelector,
};

// Interface for calling Token functions from a private context
struct PrivateOracleCallbackInterface {
  address: Field,
}

impl PrivateOracleCallbackInterface {
  pub fn at(address: Field) -> Self {
      Self {
          address,
      }
  }
  
  pub fn trigger_callback(
    self,
    context: &mut PrivateContext,
    answer: [Field; 3],
    data: [Field; 6],
    divinity: AztecAddress
  ) -> [Field; RETURN_VALUES_LENGTH] {
    let mut serialized_args = [0; 9];
    
    let answer_last = answer.len();
    for j in 0..answer_last {
        serialized_args[j] = answer[j];
    }

    // drop the first data element, which is the address (already in self.address)
    for k in 1..data.len() {
        serialized_args[k + answer_last - 1] = data[k];
    }

    serialized_args[8] = divinity.to_field();

    // Calling the oracle_callback fn:  "oracle_callback(answer: [Field; 3], data: [Field; 5])"
    let selector = FunctionSelector::from_signature("oracle_callback([Field;3],[Field;5],(Field))");
    context.call_private_function(AztecAddress::from_field(self.address), selector, serialized_args)
  }
}