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
      note.requester.asBigInt || note.requester.address
    );
    this.divinity = AztecAddress.fromBigInt(
      note.divinity.asBigInt || note.divinity.address
    );
    this.owner = AztecAddress.fromBigInt(
      note.owner.asBigInt || note.owner.address
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
      note.requester_address.asBigInt || note.requester_address.address
    );
    this.divinity = AztecAddress.fromBigInt(
      note.divinity_address.asBigInt || note.divinity_address.address
    );
    this.shared_nullifier_key = note.shared_nullifier_key;
    this.callback = note.callback;
  }
}
