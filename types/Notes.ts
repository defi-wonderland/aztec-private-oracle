import { AztecAddress, Fr } from "@aztec/aztec.js";

export class AnswerNote {
  request: bigint;
  answer: bigint;
  requester: AztecAddress;
  divinity: AztecAddress;
  owner: AztecAddress;

  constructor(note: any) {
    // object returned in arrays of notes
    if (note._is_some !== undefined) {
      this.request = note._value.request;
      this.answer = note._value.answer;
      this.requester = AztecAddress.fromBigInt(note._value.requester.address);
      this.divinity = AztecAddress.fromBigInt(note._value.divinity.address);
      this.owner = AztecAddress.fromBigInt(note._value.owner.address);
    } else {
      // object returned in single note
      this.request = note.request;
      this.answer = note.answer;
      this.requester = note.requester;
      this.divinity = note.divinity;
      this.owner = note.owner;
    }
  }
}

export class QuestionNote {
  request: bigint;
  requester: AztecAddress;
  divinity: AztecAddress;
  shared_nullifier_key: bigint;

  constructor(note: any) {
    if (note._is_some !== undefined) {
      this.request = note._value.request;
      this.requester = AztecAddress.fromBigInt(
      note._value.requester_address.address
      );
      this.divinity = AztecAddress.fromBigInt(
      note._value.divinity_address.address
      );
      this.shared_nullifier_key = note._value.shared_nullifier_key;
    } else {
      this.request = note.request;
      this.requester = note.requester_address;
      this.divinity = note.divinity_address;
      this.shared_nullifier_key = note.shared_nullifier_key;
    }
  }
}
