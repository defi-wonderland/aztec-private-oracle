import { AztecAddress, Fr } from "@aztec/aztec.js";

type AztecAddressWithInner = {
  inner: bigint
}

function containsInner(param: any): param is AztecAddressWithInner {
  return (param as AztecAddressWithInner).inner !== undefined;
}

export class AnswerNote {
  request: bigint;
  answer: bigint[];
  requester: AztecAddress;
  divinity: AztecAddress;
  owner: AztecAddress;

  constructor(note: any) {
    this.request = note.request;
    this.answer = note.answer;

    // TODO: Simplify in separate function
    this.requester = containsInner(note.requester)
    ? AztecAddress.fromBigInt((note.requester as AztecAddressWithInner).inner)
    : AztecAddress.fromBigInt(note.requester.asBigInt);

    this.divinity = containsInner(note.divinity)
      ? AztecAddress.fromBigInt((note.divinity as AztecAddressWithInner).inner)
      : AztecAddress.fromBigInt(note.divinity.asBigInt);
      
    this.owner = containsInner(note.owner)
    ? AztecAddress.fromBigInt((note.owner as AztecAddressWithInner).inner)
    : AztecAddress.fromBigInt(note.owner.asBigInt);
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

    this.requester = containsInner(note.requester_address)
    ? AztecAddress.fromBigInt((note.requester_address as AztecAddressWithInner).inner)
    : AztecAddress.fromBigInt(note.requester_address.asBigInt);

    this.divinity = containsInner(note.divinity_address)
    ? AztecAddress.fromBigInt((note.divinity_address as AztecAddressWithInner).inner)
    : AztecAddress.fromBigInt(note.divinity_address.asBigInt);

    this.shared_nullifier_key = note.shared_nullifier_key;
    this.callback = note.callback;
  }
}
