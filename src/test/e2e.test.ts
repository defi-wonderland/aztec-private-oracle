import {
  Fr,
  PXE,
  computeMessageSecretHash,
  createAccount,
  createPXEClient,
  getSandboxAccountsWallets,
  waitForSandbox,
  AztecAddress,
  AccountWalletWithPrivateKey,
  computeAuthWitMessageHash,
  TxHash,
  ExtendedNote,
  Note,
} from "@aztec/aztec.js";

import { TokenContract } from "@aztec/noir-contracts/types";
import { PrivateOracleContract } from "../../types/PrivateOracle.js";

const {
  SANDBOX_URL = "http://localhost:8080",
  ETHEREUM_HOST = "http://localhost:8545",
} = process.env;

const PAYMENT_TOKEN_SLOT: Fr = new Fr(1);
const FEE_SLOT: Fr = new Fr(2);
const QUESTIONS_SLOT: Fr = new Fr(3);
const ANSWERS_SLOT: Fr = new Fr(4);

const QUESTION = 123n;
const ANSWER = 456n;
const ALTERNATIVE_ANSWER = 789n;
const FEE = 1000n;
const MINT_AMOUNT = 10000n;

let pxe: PXE;
let oracle: PrivateOracleContract;
let token: TokenContract;

let requester: AccountWalletWithPrivateKey;
let requester2: AccountWalletWithPrivateKey;
let divinity: AccountWalletWithPrivateKey;
let deployer: AccountWalletWithPrivateKey;

// Setup: Set the sandbox
beforeAll(async () => {
  const { SANDBOX_URL = "http://localhost:8080" } = process.env;
  pxe = createPXEClient(SANDBOX_URL);

  [, [requester, requester2, divinity], deployer] = await Promise.all([
    waitForSandbox(pxe),
    getSandboxAccountsWallets(pxe),
    createAccount(pxe),
  ]);
}, 60_000);

describe("E2E Private Oracle", () => {
  describe("submit_question(..)", () => {
    // global scoped to assert accross 'it' blocks
    let shared_key_nullifier_divinity: Fr;
    let shared_key_nullifier_requester: Fr;

    // Setup: Deploy the oracle
    beforeAll(async () => {
      // Deploy the token
      token = await TokenContract.deploy(deployer, requester.getAddress())
        .send()
        .deployed();

      // Mint tokens for the requester
      await mintTokenFor(requester, requester, MINT_AMOUNT);

      // Deploy the oracle
      const receipt = await PrivateOracleContract.deploy(
        deployer,
        token.address,
        FEE
      )
        .send()
        .wait();
      oracle = receipt.contract;

      await addTokenAndFeeNotesToPXE(
        requester.getAddress(),
        oracle.address,
        token.address,
        FEE,
        receipt.txHash
      );
    }, 60_000);

    it("Requester has tokens", async () => {
      let requesterBalance = await token
        .withWallet(requester)
        .methods.balance_of_private(requester.getAddress())
        .view();
      expect(requesterBalance).toEqual(MINT_AMOUNT);
    });

    // Test: is the tx successful
    it("Tx to submit_question is mined and token are transfered", async () => {
      const nonce = await createAuthUnshieldMessage(
        token,
        requester,
        oracle.address,
        FEE
      );
      // Submit the question
      const receipt = await oracle
        .withWallet(requester)
        .methods.submit_question(QUESTION, divinity.getAddress(), nonce)
        .send()
        .wait();

      expect(receipt.status).toBe("mined");

      let [requesterBalance, oracleBalance] = await Promise.all([
        token
          .withWallet(requester)
          .methods.balance_of_private(requester.getAddress())
          .view(),
        token.methods.balance_of_public(oracle.address).view(),
      ]);

      expect(requesterBalance).toEqual(MINT_AMOUNT - FEE);
      expect(oracleBalance).toEqual(FEE);
    });

    // Test: is the note correctly stored in the private storage, for the divinity
    it("divinity question note has the correct data", async () => {
      // Get the private storage for the divinity's question slot
      const divinityRequestsNotes = await pxe.getNotes({
        owner: divinity.getAddress(),
        contractAddress: oracle.address,
        storageSlot: QUESTIONS_SLOT,
      });

      // Check: Compare the note's data with the expected values
      expect(divinityRequestsNotes[0].note.items[0].value).toEqual(QUESTION);
      expect(
        AztecAddress.fromField(divinityRequestsNotes[0].note.items[1])
      ).toEqual(requester.getAddress());
      expect(
        AztecAddress.fromField(divinityRequestsNotes[0].note.items[2])
      ).toEqual(divinity.getAddress());

      // Store the random nullifier shared key, for later comparison
      shared_key_nullifier_divinity = divinityRequestsNotes[0].note.items[3];
    });

    // Test: is the note correctly stored in the private storage, for the requester
    it("requester question note has the correct data", async () => {
      // Get the private storage for the requester's question slot
      const requesterRequestsNotes = await pxe.getNotes({
        owner: requester.getAddress(),
        contractAddress: oracle.address,
        storageSlot: QUESTIONS_SLOT,
      });

      // Compare the note's data with the expected values
      expect(requesterRequestsNotes[0].note.items[0].value).toEqual(QUESTION);
      expect(
        AztecAddress.fromField(requesterRequestsNotes[0].note.items[1])
      ).toEqual(requester.getAddress());
      expect(
        AztecAddress.fromField(requesterRequestsNotes[0].note.items[2])
      ).toEqual(divinity.getAddress());

      // Store the random nullifier shared key, for later comparison
      shared_key_nullifier_requester = requesterRequestsNotes[0].note.items[3];
    });

    // Test: is the nullifier shared key the same for the divinity and the requester
    it("nullifier key is the same between the 2 notes", async () => {
      expect(shared_key_nullifier_divinity).toEqual(
        shared_key_nullifier_requester
      );
    });

    // Test: creating a new question with the same parameters (from a different requester) is possible
    //       and will have a different nullifier shared key
    it("another requester can ask the same question and will get a different nullifier shared key", async () => {
      const nonce = await createAuthUnshieldMessage(
        token,
        requester2,
        oracle.address,
        FEE
      );

      // Mint tokens for the requester
      await mintTokenFor(requester2, requester, MINT_AMOUNT);

      // Submit the question
      await oracle
        .withWallet(requester2)
        .methods.submit_question(QUESTION, divinity.getAddress(), nonce)
        .send()
        .wait();

      const [divinityRequestsNotes, requesterRequestsNotes] = await Promise.all(
        [
          // Get the private storage for the divinity's question slot
          pxe.getNotes({
            owner: divinity.getAddress(),
            contractAddress: oracle.address,
            storageSlot: QUESTIONS_SLOT,
          }),
          // Get the private storage for the *other* requester's question slot
          pxe.getNotes({
            owner: requester2.getAddress(),
            contractAddress: oracle.address,
            storageSlot: QUESTIONS_SLOT,
          }),
        ]
      );

      // Check: Compare the note's data with the expected values (this is the second note for the divnity)
      expect(divinityRequestsNotes[1].note.items[0].value).toEqual(QUESTION);
      expect(
        AztecAddress.fromField(divinityRequestsNotes[1].note.items[1])
      ).toEqual(requester2.getAddress());
      expect(
        AztecAddress.fromField(divinityRequestsNotes[1].note.items[2])
      ).toEqual(divinity.getAddress());

      expect(requesterRequestsNotes[0].note.items[0].value).toEqual(QUESTION);
      expect(
        AztecAddress.fromField(requesterRequestsNotes[0].note.items[1])
      ).toEqual(requester2.getAddress());
      expect(
        AztecAddress.fromField(requesterRequestsNotes[0].note.items[2])
      ).toEqual(divinity.getAddress());

      // Check: Nullifier shared key is the same for requester and divinity
      expect(divinityRequestsNotes[1].note.items[3]).toEqual(
        requesterRequestsNotes[0].note.items[3]
      );

      // Check: Nullifier shared key is different from the previous request
      expect(divinityRequestsNotes[1].note.items[3]).not.toEqual(
        shared_key_nullifier_divinity
      );
    }, 60_000);
  });

  describe("submit_answer(..)", () => {
    // Setup: Deploy the oracle and submit a question
    beforeAll(async () => {
      // Deploy the token
      token = await TokenContract.deploy(deployer, requester.getAddress())
        .send()
        .deployed();

      // Mint tokens for the requester
      await mintTokenFor(requester, requester, MINT_AMOUNT);

      // Deploy the oracle
      const receipt = PrivateOracleContract.deploy(
        deployer,
        token.address,
        FEE
      ).send();

      oracle = await receipt.deployed();

      await addTokenAndFeeNotesToPXE(
        requester.getAddress(),
        oracle.address,
        token.address,
        FEE,
        await receipt.getTxHash()
      );

      const nonce = await createAuthUnshieldMessage(
        token,
        requester,
        oracle.address,
        FEE
      );

      // Submit a question
      await oracle
        .withWallet(requester)
        .methods.submit_question(QUESTION, divinity.getAddress(), nonce)
        .send()
        .wait();
    }, 60_000);

    // Test: is the tx successful
    it("Tx to submit_answer is mined and tokens are transferred to the divinity", async () => {
      // Submit the answer
      const receipt = await oracle
        .withWallet(divinity)
        .methods.submit_answer(QUESTION, requester.getAddress(), ANSWER)
        .send()
        .wait();

      expect(receipt.status).toBe("mined");

      let [divinityBalance, oracleBalance] = await Promise.all([
        token.methods.balance_of_public(divinity.getAddress()).view(),
        token.methods.balance_of_public(oracle.address).view(),
      ]);

      expect(divinityBalance).toEqual(FEE);
      expect(oracleBalance).toEqual(0n);
    });

    // Test: is the answer note stored correct, for the divinity
    it("divinity answer note has the correct data", async () => {
      // Get the private storage for the divinity's answer slot
      const divinityAnswersNotes = await pxe.getNotes({
        owner: divinity.getAddress(),
        contractAddress: oracle.address,
        storageSlot: ANSWERS_SLOT,
      });

      // Check: Compare the note's data with the expected values
      expect(divinityAnswersNotes[0].note.items[0].value).toEqual(QUESTION);
      expect(divinityAnswersNotes[0].note.items[1].value).toEqual(ANSWER);
      expect(
        AztecAddress.fromBigInt(divinityAnswersNotes[0].note.items[2].value)
      ).toEqual(requester.getAddress());
      expect(
        AztecAddress.fromBigInt(divinityAnswersNotes[0].note.items[3].value)
      ).toEqual(divinity.getAddress());
      expect(
        AztecAddress.fromBigInt(divinityAnswersNotes[0].note.items[4].value)
      ).toEqual(divinity.getAddress());
    });

    // Test: Is the data of the answer note stored correct, for the requester?
    //       The owner should be the requester (not tested otherwise, as we "cheat" with getNotes
    //       and the sk is in the current pxe)
    it("requester answer note has the correct data", async () => {
      // Get the private storage for the requester's answer slot
      const requesterAnswersNotes = await pxe.getNotes({
        owner: requester.getAddress(),
        contractAddress: oracle.address,
        storageSlot: ANSWERS_SLOT,
      });

      // Check: Compare the note's data with the expected values
      expect(requesterAnswersNotes[0].note.items[0].value).toEqual(QUESTION);
      expect(requesterAnswersNotes[0].note.items[1].value).toEqual(ANSWER);
      expect(
        AztecAddress.fromBigInt(requesterAnswersNotes[0].note.items[2].value)
      ).toEqual(requester.getAddress());
      expect(
        AztecAddress.fromBigInt(requesterAnswersNotes[0].note.items[3].value)
      ).toEqual(divinity.getAddress());
      expect(
        AztecAddress.fromBigInt(requesterAnswersNotes[0].note.items[4].value)
      ).toEqual(requester.getAddress());
    });

    // Test: is the request note of the requester now nullified
    it("requester request note has been nullified", async () => {
      // Get the private storage for the requester's question slot
      const requesterRequestsNotes = await pxe.getNotes({
        owner: requester.getAddress(),
        contractAddress: oracle.address,
        storageSlot: QUESTIONS_SLOT,
      });

      // Check: There is no request left (has been nullified when submit_answer was called)
      expect(requesterRequestsNotes.length).toEqual(0);
    });

    // Test: is the request note of the divinity now nullified
    it("divinity request note has been nullified", async () => {
      // Get the private storage for the divinity's question slot
      const divinityRequestsNotes = await pxe.getNotes({
        owner: divinity.getAddress(),
        contractAddress: oracle.address,
        storageSlot: QUESTIONS_SLOT,
      });

      // Check: There is no request left (has been nullified when submit_answer was called)
      expect(divinityRequestsNotes.length).toEqual(0);
    });

    // Test: if a second request is made from a different requester, asking the same question, is the divinity
    //       forced to answer with the same answer (answer consistency)?
    it("second identical question cannot have a different answer (from the same divinity)", async () => {
      const nonce = await createAuthUnshieldMessage(
        token,
        requester2,
        oracle.address,
        FEE
      );

      // Mint tokens for the requester
      await mintTokenFor(requester2, requester, MINT_AMOUNT);

      // Setup: submit the same question from a second requester
      await oracle
        .withWallet(requester2)
        .methods.submit_question(QUESTION, divinity.getAddress(), nonce)
        .send()
        .wait();

      // Try to submit a different answer, which should be discarded
      await oracle
        .withWallet(divinity)
        .methods.submit_answer(
          QUESTION,
          requester2.getAddress(),
          ALTERNATIVE_ANSWER
        )
        .send()
        .wait();

      // Get the private storage for the requester's answer slot
      const requester2AnswersNotes = await pxe.getNotes({
        owner: requester2.getAddress(),
        contractAddress: oracle.address,
        storageSlot: ANSWERS_SLOT,
      });

      // Check: Compare the note's data with the expected values: the answer is the same as the first one and not the new one
      expect(requester2AnswersNotes[0].note.items[0].value).toEqual(QUESTION);
      expect(requester2AnswersNotes[0].note.items[1].value).toEqual(ANSWER);
    }, 30_000);
  });

  describe("cancel_question(..)", () => {
    // Setup: Deploy the oracle and submit the question
    beforeAll(async () => {
      // Deploy the token
      token = await TokenContract.deploy(deployer, requester.getAddress())
        .send()
        .deployed();

      // Mint tokens for the requester
      await mintTokenFor(requester, requester, MINT_AMOUNT);

      // Deploy the oracle
      const receipt = PrivateOracleContract.deploy(
        deployer,
        token.address,
        FEE
      ).send();
      oracle = await receipt.deployed();
      await addTokenAndFeeNotesToPXE(
        requester.getAddress(),
        oracle.address,
        token.address,
        FEE,
        await receipt.getTxHash()
      );

      const nonce = await createAuthUnshieldMessage(
        token,
        requester,
        oracle.address,
        FEE
      );

      // Submit a question
      await oracle
        .withWallet(requester)
        .methods.submit_question(QUESTION, divinity.getAddress(), nonce)
        .send()
        .wait();
    }, 45_000);

    // Test: is the tx successful
    it("Tx to cancel_question is mined and token transferred back to requester", async () => {
      const receipt = await oracle
        .withWallet(requester)
        .methods.cancel_question(QUESTION)
        .send()
        .wait();

      expect(receipt.status).toBe("mined");

      let [requesterBalance, requesterBalanceUnshielded, oracleBalance] =
        await Promise.all([
          token
            .withWallet(requester)
            .methods.balance_of_private(requester.getAddress())
            .view(),

          // Refunded portion is unshielded
          token.methods.balance_of_public(requester.getAddress()).view(),

          token
            .withWallet(requester)
            .methods.balance_of_public(oracle.address)
            .view(),
        ]);

      expect(requesterBalance + requesterBalanceUnshielded).toEqual(
        MINT_AMOUNT
      );
      expect(oracleBalance).toEqual(0n);
    });

    // Test: is the request note of the requester now nullified
    it("requester request note has been nullified", async () => {
      // Get the private storage for the requester's question slot
      const requesterRequestsNotes = await pxe.getNotes({
        owner: requester.getAddress(),
        contractAddress: oracle.address,
        storageSlot: QUESTIONS_SLOT,
      });

      // Check: There is no request left (has been nullified when cancel_question was called)
      expect(requesterRequestsNotes.length).toEqual(0);
    });

    // Test: is the request note of the divinity now nullified
    it("divinity request note has been nullified", async () => {
      // Get the private storage for the divinity's question slot
      const divinityRequestsNotes = await pxe.getNotes({
        owner: divinity.getAddress(),
        contractAddress: oracle.address,
        storageSlot: QUESTIONS_SLOT,
      });

      // Check: There is no request left (has been nullified when cancel_question was called)
      expect(divinityRequestsNotes.length).toEqual(0);
    });
  });

  describe("unconstrained: get_answer_unconstrained(..)", () => {
    // Setup: Deploy the oracle and submit a question
    beforeAll(async () => {
      // Deploy the token
      token = await TokenContract.deploy(deployer, requester.getAddress())
        .send()
        .deployed();

      // Mint tokens for the requester
      await mintTokenFor(requester, requester, MINT_AMOUNT);

      // Deploy the oracle
      const receipt = PrivateOracleContract.deploy(
        deployer,
        token.address,
        FEE
      ).send();
      oracle = await receipt.deployed();

      await addTokenAndFeeNotesToPXE(
        requester.getAddress(),
        oracle.address,
        token.address,
        FEE,
        await receipt.getTxHash()
      );

      const nonce = await createAuthUnshieldMessage(
        token,
        requester,
        oracle.address,
        FEE
      );

      // Submit a question
      await oracle
        .withWallet(requester)
        .methods.submit_question(QUESTION, divinity.getAddress(), nonce)
        .send()
        .wait();

      // Submit an answer
      await oracle
        .withWallet(divinity)
        .methods.submit_answer(QUESTION, requester.getAddress(), ANSWER)
        .send()
        .wait();
    }, 60_000);

    it("get_answer returns the correct answer to the requester", async () => {
      // Get the answer
      // Using "from" authentification (follow https://github.com/AztecProtocol/aztec-packages/blob/2d498b352364debf59af940f0a69c453651a4ad0/yarn-project/pxe/src/pxe_service/pxe_service.ts#L337)
      const answer = await oracle
        .withWallet(requester)
        .methods.get_answer_unconstrained(QUESTION, requester.getAddress())
        .view({ from: requester.getAddress() });

      // Check: Compare the answer with the expected value
      expect(answer.request).toEqual(QUESTION);
      expect(answer.answer).toEqual(ANSWER);
      expect(AztecAddress.fromBigInt(answer.requester.address)).toEqual(
        requester.getAddress()
      );
      expect(AztecAddress.fromBigInt(answer.divinity.address)).toEqual(
        divinity.getAddress()
      );
      expect(AztecAddress.fromBigInt(answer.owner.address)).toEqual(
        requester.getAddress()
      );
    });

    it("get_answer returns the correct answer to the divinity", async () => {
      // Get the answer
      // Using "from" authentification (follow https://github.com/AztecProtocol/aztec-packages/blob/2d498b352364debf59af940f0a69c453651a4ad0/yarn-project/pxe/src/pxe_service/pxe_service.ts#L337)
      const answer = await oracle
        .withWallet(divinity)
        .methods.get_answer_unconstrained(QUESTION, divinity.getAddress())
        .view({ from: divinity.getAddress() });

      // Check: Compare the answer with the expected value
      expect(answer.request).toEqual(QUESTION);
      expect(answer.answer).toEqual(ANSWER);
      expect(AztecAddress.fromBigInt(answer.requester.address)).toEqual(
        requester.getAddress()
      );
      expect(AztecAddress.fromBigInt(answer.divinity.address)).toEqual(
        divinity.getAddress()
      );
      expect(AztecAddress.fromBigInt(answer.owner.address)).toEqual(
        divinity.getAddress()
      );
    });
  });

  describe("unconstrained: get_fee() and get_payment_token()", () => {
    // Setup: Deploy the oracle
    beforeAll(async () => {
      // Deploy the token
      token = await TokenContract.deploy(deployer, requester.getAddress())
        .send()
        .deployed();

      // Mint tokens for the requester
      await mintTokenFor(requester, requester, MINT_AMOUNT);

      // Deploy the oracle
      const receipt = await PrivateOracleContract.deploy(
        deployer,
        token.address,
        FEE
      )
        .send()
        .wait();
      oracle = receipt.contract;
    }, 30_000);

    it("returns the correct fee", async () => {
      let storedFee = await oracle.methods.get_fee().view();

      expect(storedFee).toEqual(FEE);
    });

    it("returns the correct token address", async () => {
      let storedTokenAddress = await oracle.methods.get_payment_token().view();

      expect(AztecAddress.fromBigInt(storedTokenAddress.address)).toEqual(
        token.address
      );
    });

    // Test if not initialized a second time (even from the deployer)
    it("getters are immutable", async () => {
      await expect(
        oracle
          .withWallet(deployer)
          .methods.initialize_payment_token(token.address, FEE + 1n)
          .simulate()
      ).rejects.toThrowError(
        "(JSON-RPC PROPAGATED) Failed to solve brillig function, reason: explicit trap hit in brillig 'context.msg_sender() == context.this_address()"
      );
    });
  });
});

const createAuthUnshieldMessage = async (
  token: TokenContract,
  from: AccountWalletWithPrivateKey,
  to: AztecAddress,
  amount: any
) => {
  const nonce = Fr.random();

  // We need to compute the message we want to sign and add it to the wallet as approved
  const action = token.methods.unshield(from.getAddress(), to, amount, nonce);
  const messageHash = await computeAuthWitMessageHash(to, action.request());

  // Both wallets are connected to same node and PXE so we could just insert directly using
  // await wallet.signAndAddAuthWitness(messageHash, );
  // But doing it in two actions to show the flow.
  const witness = await from.createAuthWitness(messageHash);
  await from.addAuthWitness(witness);
  return nonce;
};

const addTokenAndFeeNotesToPXE = async (
  requester: AztecAddress,
  oracle: AztecAddress,
  token: AztecAddress,
  fee: bigint,
  txHash: TxHash
) => {
  await Promise.all([
    // Add note for the payment token
    pxe.addNote(
      new ExtendedNote(
        new Note([token.toField()]),
        requester,
        oracle,
        PAYMENT_TOKEN_SLOT,
        txHash
      )
    ),

    // Add note for the fee
    pxe.addNote(
      new ExtendedNote(
        new Note([new Fr(fee)]),
        requester,
        oracle,
        FEE_SLOT,
        txHash
      )
    ),
  ]);
};

const addPendingShieldNoteToPXE = async (
  account: AccountWalletWithPrivateKey,
  amount: bigint,
  secretHash: Fr,
  txHash: TxHash
) => {
  const storageSlot = new Fr(5); // The storage slot of `pending_shields` is 5.

  await pxe.addNote(
    new ExtendedNote(
      new Note([new Fr(amount), secretHash]),
      account.getAddress(),
      token.address,
      storageSlot,
      txHash
    )
  );
};

const mintTokenFor = async (
  account: AccountWalletWithPrivateKey,
  minter: AccountWalletWithPrivateKey,
  amount: bigint
) => {
  // Mint private tokens
  const secret = Fr.random();
  const secretHash = await computeMessageSecretHash(secret);

  const recipt = await token
    .withWallet(minter)
    .methods.mint_private(amount, secretHash)
    .send()
    .wait();

  await addPendingShieldNoteToPXE(minter, amount, secretHash, recipt.txHash);

  await token
    .withWallet(minter)
    .methods.redeem_shield(account.getAddress(), amount, secret)
    .send()
    .wait();
};
