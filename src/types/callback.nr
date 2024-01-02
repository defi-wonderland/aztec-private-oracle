use dep::std;
use dep::aztec::context::{ PrivateContext, PublicContext };
use dep::protocol_types::constants::RETURN_VALUES_LENGTH;
use dep::aztec::selector::compute_selector;

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
    data: [Field; 6]
  ) -> [Field; RETURN_VALUES_LENGTH] {
    let mut serialized_args = [0; 8];
    
    let answer_last = answer.len();
    for j in 0..answer_last {
        serialized_args[j] = answer[j];
    }

    // drop the first data element, which is the address (already in self.address)
    for k in 1..data.len() {
        serialized_args[k + answer_last - 1] = data[k];
    }

    // Calling the oracle_callback fn:  "oracle_callback(answer: [Field; 3], data: [Field; 5])"
    let selector = compute_selector("oracle_callback([Field;3],[Field;5])");
    context.call_private_function(self.address, selector, serialized_args)
  }
}