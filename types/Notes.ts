import { AztecAddress, Fr } from "@aztec/aztec.js";

export class AnswerNote {
  request: bigint;
  answer: bigint;
  requester: AztecAddress;
  divinity: AztecAddress;
  owner: AztecAddress;

  constructor(request: bigint, answer: bigint, requester: AztecAddress, divinity: AztecAddress, owner: AztecAddress) {
    this.request = request;
    this.answer = answer;
    this.requester = requester;
    this.divinity = divinity;
    this.owner = owner;
  }

  static fromChainData(note: any) {
    return new AnswerNote(
      note.request,
      note.answer,
      AztecAddress.fromBigInt(note.requester.address),
      AztecAddress.fromBigInt(note.divinity.address),
      AztecAddress.fromBigInt(note.owner.address),
    );
  }

  static fromLocal(note: any) {
    return new AnswerNote(
      note.request,
      note.answer,
      AztecAddress.fromBigInt(note.requester.asBigInt),
      AztecAddress.fromBigInt(note.divinity.asBigInt),
      AztecAddress.fromBigInt(note.owner.asBigInt),
    );
  }
}

export class QuestionNote {
  request: bigint;
  requester: AztecAddress;
  divinity: AztecAddress;
  shared_nullifier_key: bigint;
  callback: bigint[];

  constructor(
    request: bigint,
    requester: AztecAddress,
    divinity: AztecAddress,
    shared_nullifier_key: bigint,
    callback: bigint[]
  ) {
    this.request = request;
    this.requester = requester;
    this.divinity = divinity;
    this.shared_nullifier_key = shared_nullifier_key;
    this.callback = callback;
  }

  static fromChainData(note: any) {
    return new QuestionNote(
      note.request,
      AztecAddress.fromBigInt(note.requester_address.address),
      AztecAddress.fromBigInt(note.divinity_address.address),
      note.shared_nullifier_key,
      note.callback
    );
  }

  static fromLocal(note: any) {
    return new QuestionNote(
      note.request,
      AztecAddress.fromBigInt(note.requester_address.asBigInt),
      AztecAddress.fromBigInt(note.divinity_address.asBigInt),
      note.shared_nullifier_key,
      note.callback
    );
  }
}
