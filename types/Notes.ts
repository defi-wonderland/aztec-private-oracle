import { AztecAddress, Fr } from "@aztec/aztec.js";

export class AnswerNote {
  request: bigint;
  answer: bigint;
  requester: AztecAddress;
  divinity: AztecAddress;
  owner: AztecAddress;

  constructor(note: any) {
    this.request = note.request;
    this.answer = note.answer;
    this.requester = AztecAddress.fromBigInt(
      note.requester.address || note.requester.asBigInt
    );
    this.divinity = AztecAddress.fromBigInt(
      note.divinity.address || note.divinity.asBigInt
    );
    this.owner = AztecAddress.fromBigInt(
      note.owner.address || note.owner.asBigInt
    );
  }
}

export class QuestionNote {
  request: bigint;
  requester: AztecAddress;
  divinity: AztecAddress;
  shared_nullifier_key: bigint;
  callback: bigint[];

  constructor(note: any) {
    this.request = note.request;
    this.requester = AztecAddress.fromBigInt(
      note.requester_address.address || note.requester_address.asBigInt
    );
    this.divinity = AztecAddress.fromBigInt(
      note.divinity_address.address || note.divinity_address.asBigInt
    );
    this.shared_nullifier_key = note.shared_nullifier_key;
    this.callback = note.callback;
  }
}
