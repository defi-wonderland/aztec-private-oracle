import { AztecAddress } from "@aztec/aztec.js";

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