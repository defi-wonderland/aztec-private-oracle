import { AztecAddress } from "@aztec/aztec.js";

export type AnswerNote = {
  _is_some: boolean;
  _value: {
    request: bigint;
    answer: bigint;
    requester: AztecAddress;
    divinity: AztecAddress;
    owner: AztecAddress;
  };
};
