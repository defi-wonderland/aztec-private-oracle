import { AztecAddress, Fr } from "@aztec/aztec.js";

export class AnswerNote {
  is_some: boolean;
  request: bigint;
  answer: bigint;
  requester: AztecAddress;
  divinity: AztecAddress;
  owner: AztecAddress;

  constructor(note: any) {
    this.is_some = note._is_some;
    this.request = note._value.request;
    this.answer = note._value.answer;
    this.requester = AztecAddress.fromBigInt(note._value.requester.address);
    this.divinity = AztecAddress.fromBigInt(note._value.divinity.address);
    this.owner = AztecAddress.fromBigInt(note._value.owner.address);
  }
}

export class QuestionNote {
  is_some: boolean;
  request: bigint;
  requester: AztecAddress;
  divinity: AztecAddress;
  shared_nullifier_key: bigint;

  constructor(note: any) {
    this.is_some = note._is_some;
    this.request = note._value.request;
    this.requester = AztecAddress.fromBigInt(
      note._value.requester_address.address
    );
    this.divinity = AztecAddress.fromBigInt(
      note._value.divinity_address.address
    );
    this.shared_nullifier_key = note._value.shared_nullifier_key;
  }
}
