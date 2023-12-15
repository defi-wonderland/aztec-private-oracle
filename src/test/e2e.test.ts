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
  BatchCall,
} from "@aztec/aztec.js";

import { TokenContract } from "../artifacts/token/Token.js";
import { MockOracleCallbackContract } from "./MockCallback/interfaces/MockOracleCallback.js";

import { PrivateOracleContract } from "../artifacts/PrivateOracle.js";
import { AnswerNote, QuestionNote } from "../../types/Notes.js";
import { initAztecJs } from "@aztec/aztec.js/init";

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
const MINT_AMOUNT = 100000000n;

const ADDRESS_ZERO = AztecAddress.fromBigInt(0n);

const ZERO_FIELD = new Fr(0n);

const EMPTY_CALLBACK = [0n, 0n, 0n, 0n, 0n, 0n];
// First element should be replaced by the callback address (submit_question) or the answer (submit_answer)
const CALLBACK_DATA = [69n, 420n, 42069n, 69420n, 6942069n]; 

let pxe: PXE;
let oracle: PrivateOracleContract;
let token: TokenContract;

let mockCallback: MockOracleCallbackContract;

let requester: AccountWalletWithPrivateKey;
let requester2: AccountWalletWithPrivateKey;
let divinity: AccountWalletWithPrivateKey;
let deployer: AccountWalletWithPrivateKey;

// Setup: Set the sandbox
beforeAll(async () => {
  const { SANDBOX_URL = "http://localhost:8080" } = process.env;
  pxe = createPXEClient(SANDBOX_URL);

  await initAztecJs();

  [, [requester, requester2, divinity], deployer] = await Promise.all([
    waitForSandbox(pxe),
    getSandboxAccountsWallets(pxe),
    createAccount(pxe),
  ]);
}, 120_000);

describe("E2E Private Oracle", () => {
  describe("submit_question(..)", () => {
    // global scoped to assert accross 'it' blocks
    let shared_key_nullifier_divinity: bigint;
    let shared_key_nullifier_requester: bigint;

    // create the question notes for the requester and divinity
    let QUESTION_NOTE: QuestionNote;

    // Setup: Deploy the oracle
    beforeAll(async () => {
      // Create the question notes we should get
      QUESTION_NOTE = createCorrectNotes(requester)[0][0];

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

      // Add the contract public key to the PXE
      await pxe.registerRecipient(oracle.completeAddress);

      await addTokenAndFeeNotesToPXE(
        requester.getAddress(),
        oracle.address,
        token.address,
        FEE,
        receipt.txHash
      );
    }, 120_000);

    it("Requester has tokens", async () => {
      let requesterBalance = await token
        .withWallet(requester)
        .methods.balance_of_private(requester.getAddress())
        .view();
      expect(requesterBalance).toEqual(MINT_AMOUNT);
    });

    // Test: is the tx successful
    it("Tx to submit_question is mined and token are transfered", async () => {
      const nonce = await createAuthEscrowMessage(
        token,
        requester,
        oracle.address,
        FEE
      );
      // Submit the question
      const receipt = await oracle
        .withWallet(requester)
        .methods.submit_question(
          requester.getAddress(),
          QUESTION_NOTE.request,
          divinity.getAddress(),
          nonce,
          EMPTY_CALLBACK
        )
        .send()
        .wait();

      expect(receipt.status).toBe("mined");

      let requesterBalance = await token
        .withWallet(requester)
        .methods.balance_of_private(requester.getAddress())
        .view();

      expect(requesterBalance).toEqual(MINT_AMOUNT - FEE);
    });

    // Test: is the note correctly stored in the private storage, for the divinity
    it("divinity question note has the correct data", async () => {
      const question: QuestionNote = new QuestionNote(
        (
          await oracle
            .withWallet(divinity)
            .methods.get_pending_questions_unconstrained(
              divinity.getAddress(),
              0n
            )
            .view({ from: divinity.getAddress() })
        )[0]._value
      ); // returns 10 by default

      // Check: Compare the note's data with the expected values
      type QuestionNoteWithoutRandom = Omit<
        QuestionNote,
        "shared_nullifier_key" | "callback"
      >;

      const questionNoteWithoutRandom: QuestionNoteWithoutRandom = {
        request: QUESTION_NOTE.request,
        requester: QUESTION_NOTE.requester,
        divinity: QUESTION_NOTE.divinity,
      };

      expect(question).toEqual(
        expect.objectContaining(questionNoteWithoutRandom)
      );

      // Store the random nullifier shared key, for later comparison
      shared_key_nullifier_divinity = question.shared_nullifier_key;
    });

    // Test: is the note correctly stored in the private storage, for the requester
    it("requester question note has the correct data", async () => {
      const question: QuestionNote = new QuestionNote(
        (
          await oracle
            .withWallet(requester)
            .methods.get_pending_questions_unconstrained(
              divinity.getAddress(),
              0n
            )
            .view({ from: requester.getAddress() })
        )[0]._value
      ); // returns 10 by default

      // Check: Compare the note's data with the expected values
      type QuestionNoteWithoutRandom = Omit<
        QuestionNote,
        "shared_nullifier_key" | "callback"
      >;

      const questionNoteWithoutRandom: QuestionNoteWithoutRandom = {
        request: QUESTION_NOTE.request,
        requester: QUESTION_NOTE.requester,
        divinity: QUESTION_NOTE.divinity,
      };

      expect(question).toEqual(
        expect.objectContaining(questionNoteWithoutRandom)
      );

      // Store the random nullifier shared key, for later comparison
      shared_key_nullifier_requester = question.shared_nullifier_key;
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
      const nonce = await createAuthEscrowMessage(
        token,
        requester2,
        oracle.address,
        FEE
      );

      // Mint tokens for the requester
      await mintTokenFor(requester2, requester, MINT_AMOUNT);

      // Submit the question from another requester
      await oracle
        .withWallet(requester2)
        .methods.submit_question(
          requester2.getAddress(),
          QUESTION_NOTE.request,
          divinity.getAddress(),
          nonce,
          EMPTY_CALLBACK
        )
        .send()
        .wait();

      const storedQuestions: QuestionNote[] = (
        await oracle
          .withWallet(divinity)
          .methods.get_pending_questions_unconstrained(
            divinity.getAddress(),
            0n
          )
          .view({ from: divinity.getAddress() })
      )
        .map((questionNote: any) => questionNote._value)
        .map((x: QuestionNote) => new QuestionNote(x)); // returns 10 by default

      // Check: Compare the note's data with the expected values
      type QuestionNoteWithoutRandom = Omit<
        QuestionNote,
        "shared_nullifier_key"
      >;

      const questionNoteWithoutRandom: QuestionNoteWithoutRandom = {
        request: QUESTION_NOTE.request,
        requester: QUESTION_NOTE.requester,
        divinity: QUESTION_NOTE.divinity,
        callback: QUESTION_NOTE.callback,
      };

      // Remove duplicates (by default, return all notes from all wallets in the pxe) and empty notes
      const uniqueStored = [
        ...new Map(
          storedQuestions.map((e) => [e.shared_nullifier_key, e])
        ).values(),
      ].filter((e, i) => e.shared_nullifier_key !== 0n);

      const matches = uniqueStored.filter((obj) =>
        expect.objectContaining(questionNoteWithoutRandom)
      );

      // Check: Compare the note's data with the expected values (this is the second note for the divnity)
      expect(matches.length).toBe(2);

      // Check: nullifier keys should be different
      expect(matches[0].shared_nullifier_key).not.toEqual(
        matches[1].shared_nullifier_key
      );
    }, 60_000);

    it("question can be submitted by a third party", async () => {
      // requester = sender, executes it
      // requester2 = from, on their behalf
      const question = new Fr(300n);
      const nonce = await createAuthEscrowMessage(
        token,
        requester2,
        oracle.address,
        FEE
      );

      // Mint tokens for the requester
      await mintTokenFor(requester2, requester, MINT_AMOUNT);

      const action = await createAuthSubmitQuestionMessage(
        oracle,
        requester,
        requester2,
        question,
        divinity.getAddress(),
        nonce
      );

      // Submit the question
      await action.send().wait();

      const questionNotes = await pxe.getNotes({
        owner: requester2.getAddress(),
        contractAddress: token.address,
        storageSlot: new Fr(7),
      });
    }, 120_000);

    // Test: if a callback is provided, it is correctly stored
    it("callback is correctly stored", async () => {
      // Deploy the contract receiving the callback
      mockCallback = await MockOracleCallbackContract.deploy(deployer)
        .send()
        .deployed();

      const nonce = await createAuthEscrowMessage(
        token,
        requester,
        oracle.address,
        FEE
      );

      // Submit the question
      const receipt = await oracle
        .withWallet(requester)
        .methods.submit_question(
          requester.getAddress(),
          123456n,
          divinity.getAddress(),
          nonce,
          [mockCallback.address.toBigInt(), ...CALLBACK_DATA]
        )
        .send()
        .wait();

      expect(receipt.status).toBe("mined");

      // Check: is the callback correctly stored?
      const question: QuestionNote[] = (
        await oracle
          .withWallet(requester)
          .methods.get_pending_questions_unconstrained(
            divinity.getAddress(),
            0n
          )
          .view({ from: requester.getAddress() })
      )
        .map((questionNote: any) => questionNote._value)
        .map((x: QuestionNote) => new QuestionNote(x)); // returns 10 by default

      // Filter the question with the correct request
      const questionWithCallback = question.filter(
        (e) => e.request === 123456n
      )[0];

      expect(questionWithCallback.callback).toEqual([
        mockCallback.address.toBigInt(),
        ...CALLBACK_DATA,
      ]);
    });
  });

  describe("submit_answer(..)", () => {
    let QUESTION_NOTE: QuestionNote;
    let ANSWER_NOTE_REQUESTER: AnswerNote;
    let ANSWER_NOTE_DIVINITY: AnswerNote;

    // Setup: Deploy the oracle and submit a question
    beforeAll(async () => {
      // Create the answer notes we should get
      QUESTION_NOTE = createCorrectNotes(requester)[0][0];
      ANSWER_NOTE_REQUESTER = createCorrectNotes(requester)[1][0];
      ANSWER_NOTE_DIVINITY = createCorrectNotes(divinity)[1][0];

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

      await pxe.registerRecipient(oracle.completeAddress);

      await addTokenAndFeeNotesToPXE(
        requester.getAddress(),
        oracle.address,
        token.address,
        FEE,
        await receipt.getTxHash()
      );

      const nonce = await createAuthEscrowMessage(
        token,
        requester,
        oracle.address,
        FEE
      );

      // Submit a question
      await oracle
        .withWallet(requester)
        .methods.submit_question(
          requester.getAddress(),
          QUESTION_NOTE.request,
          divinity.getAddress(),
          nonce,
          EMPTY_CALLBACK
        )
        .send()
        .wait();
    }, 120_000);

    // Test: is the tx successful
    it("Tx to submit_answer is mined and tokens are transferred to the divinity", async () => {
      // Submit the answer
      const receipt = await oracle
        .withWallet(divinity)
        .methods.submit_answer(
          QUESTION_NOTE.request,
          requester.getAddress(),
          ANSWER_NOTE_DIVINITY.answer
        )
        .send()
        .wait();

      expect(receipt.status).toBe("mined");

      let divinityBalance = await token
        .withWallet(divinity)
        .methods.balance_of_private(divinity.getAddress())
        .view();

      expect(divinityBalance).toEqual(FEE);
    });

    // Test: is the answer note stored correct, for the divinity
    it("divinity answer note has the correct data", async () => {
      // get the answers
      const answer: AnswerNote = (
        await oracle
          .withWallet(divinity)
          .methods.get_answers_unconstrained(divinity.getAddress(), 0n)
          .view({ from: divinity.getAddress() })
      )
        .map((answerNote: any) => answerNote._value)
        .map((x: AnswerNote) => new AnswerNote(x))[0];

      // Check: are all answers included in the array (will return 10 notes, 3 and 7 which are uninitialized)
      expect(answer).toEqual(expect.objectContaining(ANSWER_NOTE_DIVINITY));
    });

    // Test: Is the data of the answer note stored correct, for the requester?
    //       The owner should be the requester (not tested otherwise, as we "cheat" with getNotes
    //       and the sk is in the current pxe)
    it("requester answer note has the correct data", async () => {
      // get the answers
      const answer: AnswerNote = (
        await oracle
          .withWallet(requester)
          .methods.get_answers_unconstrained(requester.getAddress(), 0n)
          .view({ from: requester.getAddress() })
      )
        .map((answerNote: any) => answerNote._value)
        .map((x: AnswerNote) => new AnswerNote(x))[0];

      // Check: are all answers included in the array (will return 10 notes, 3 and 7 which are uninitialized)
      expect(answer).toEqual(expect.objectContaining(ANSWER_NOTE_REQUESTER));
    });

    // Test: is the request note of the requester now nullified
    it("requester request note has been nullified", async () => {
      // Get the private storage for the requester's question slot
      const requesterRequestsNotes: QuestionNote[] = (
        await oracle
          .withWallet(requester)
          .methods.get_questions_unconstrained(requester.getAddress(), 0n)
          .view({ from: requester.getAddress() })
      )
        .map((questionNote: any) => questionNote._value)
        .map((x: QuestionNote) => new QuestionNote(x));

      const notesWithoutEmpties = requesterRequestsNotes.filter((e, i) => {
        e.shared_nullifier_key !== 0n &&
          e.request !== 0n &&
          e.requester.toBigInt() !== 0n &&
          e.divinity.toBigInt() !== 0n;
      });

      // Check: There is no request left (has been nullified when submit_answer was called)
      expect(notesWithoutEmpties.length).toEqual(0);
    });

    // Test: is the request note of the divinity now nullified
    it("divinity request note has been nullified", async () => {
      // get the answers
      const divinityRequestsNotes: QuestionNote[] = (
        await oracle
          .withWallet(requester)
          .methods.get_pending_questions_unconstrained(
            divinity.getAddress(),
            0n
          )
          .view({ from: requester.getAddress() })
      )
        .map((questionNote: any) => questionNote._value)
        .map((x: QuestionNote) => new QuestionNote(x));

      const notesWithoutEmpties = divinityRequestsNotes.filter((e, i) => {
        e.shared_nullifier_key !== 0n &&
          e.request !== 0n &&
          e.requester.toBigInt() !== 0n &&
          e.divinity.toBigInt() !== 0n;
      });

      // Check: There is no request left (has been nullified when submit_answer was called)
      expect(notesWithoutEmpties.length).toEqual(0);
    });

    // Test: if a second request is made from a different requester, asking the same question, is the divinity
    //       forced to answer with the same answer (answer consistency)?
    it("second identical question cannot have a different answer (from the same divinity)", async () => {
      const nonce = await createAuthEscrowMessage(
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
        .methods.submit_question(
          requester2.getAddress(),
          QUESTION,
          divinity.getAddress(),
          nonce,
          EMPTY_CALLBACK
        )
        .send()
        .wait();

      // Try to submit a different answer, which should be discarded
      await oracle
        .withWallet(divinity)
        .methods.submit_answer(
          QUESTION_NOTE.request,
          requester2.getAddress(),
          ANSWER_NOTE_REQUESTER.answer + 1n
        )
        .send()
        .wait();

      // Check: Compare the note's data with the expected values: the answer is the same as the first one and not the new one
      const answer: AnswerNote = new AnswerNote(
        await oracle
          .withWallet(requester)
          .methods.get_answer_unconstrained(
            QUESTION_NOTE.request,
            requester.getAddress()
          )
          .view({ from: requester.getAddress() })
      );

      // Check: Compare the answer with the expected value
      expect(answer).toEqual(ANSWER_NOTE_REQUESTER);
    }, 120_000);

    // Test: callback address is correctly called, if provided
    it("callback is correctly called", async () => {
      const NEW_REQUEST = 123456n;
      const NEW_ANSWER = 654321n;

      // Deploy the contract receiving the callback
      mockCallback = await MockOracleCallbackContract.deploy(deployer)
        .send()
        .deployed();

      const nonce = await createAuthEscrowMessage(
        token,
        requester,
        oracle.address,
        FEE
      );

      // Submit the question
      await oracle
        .withWallet(requester)
        .methods.submit_question(
          requester.getAddress(),
          NEW_REQUEST,
          divinity.getAddress(),
          nonce,
          [mockCallback.address.toBigInt(), ...CALLBACK_DATA]
        )
        .send()
        .wait();

      // Submit the answer
      await oracle
        .withWallet(divinity)
        .methods.submit_answer(NEW_REQUEST, requester.getAddress(), NEW_ANSWER)
        .send()
        .wait();

      // Check that the callback has been triggered (see sandbox log too)
      const _storedCallbackData = await mockCallback
        .withWallet(requester)
        .methods.get_received_data()
        .view();

      expect(Object.values(_storedCallbackData).flat()).toEqual([
        NEW_ANSWER,
        ...CALLBACK_DATA,
      ]);
    }, 120_000);
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

      await pxe.registerRecipient(oracle.completeAddress);

      const nonce = await createAuthEscrowMessage(
        token,
        requester,
        oracle.address,
        FEE
      );

      // Submit a question
      await oracle
        .withWallet(requester)
        .methods.submit_question(
          requester.getAddress(),
          QUESTION,
          divinity.getAddress(),
          nonce,
          EMPTY_CALLBACK
        )
        .send()
        .wait();
    }, 100_000);

    // Test: is the tx successful
    it("Tx to cancel_question is mined and token transferred back to requester", async () => {
      const receipt = await oracle
        .withWallet(requester)
        .methods.cancel_question(QUESTION)
        .send()
        .wait();

      expect(receipt.status).toBe("mined");

      let requesterBalance = await token
        .withWallet(requester)
        .methods.balance_of_private(requester.getAddress())
        .view();

      expect(requesterBalance).toEqual(MINT_AMOUNT);
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

  describe("unconstrained: get_questions_unconstrained(..)", () => {
    let QUESTION_NOTE_REQUESTER: QuestionNote[];

    // Setup: Deploy the oracle and submit 4 questions
    beforeAll(async () => {
      [QUESTION_NOTE_REQUESTER] = createCorrectNotes(requester, 20);

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

      await pxe.registerRecipient(oracle.completeAddress);

      await addTokenAndFeeNotesToPXE(
        requester.getAddress(),
        oracle.address,
        token.address,
        FEE,
        await receipt.getTxHash()
      );

      // Submit the questions (in a single batch for optimisation)
      await sendQuestionsBatch(QUESTION_NOTE_REQUESTER.slice(0, 4));
    }, 120_000);

    it("get_questions returns the correct questions to the requester", async () => {
      // get the answers
      const questions: QuestionNote[] = (
        await oracle
          .withWallet(requester)
          .methods.get_questions_unconstrained(requester.getAddress(), 0n)
          .view({ from: requester.getAddress() })
      )
        .map((questionNote: any) => questionNote._value)
        .map((x: QuestionNote) => new QuestionNote(x));

      // Check: are all questions included in the array (will return 10 notes, 3 and 7 which are uninitialized)
      // Match on the 3 deterministic fields of each note (ie drop the random shared key nullifier)
      type QuestionNoteWithoutRandom = Omit<
        QuestionNote,
        "shared_nullifier_key" | "callback"
      >;

      expect(questions).toEqual(
        expect.arrayContaining(
          QUESTION_NOTE_REQUESTER.slice(0, 4).map((questionNote) => {
            const noteWithoutNullifier: QuestionNoteWithoutRandom = {
              request: questionNote.request,
              requester: questionNote.requester,
              divinity: questionNote.divinity,
            };

            return expect.objectContaining(noteWithoutNullifier);
          })
        )
      );
    });

    it("get_questions returns the correct questions to the divinity", async () => {
      // get the answers
      const questions: QuestionNote[] = (
        await oracle
          .withWallet(divinity)
          .methods.get_questions_unconstrained(requester.getAddress(), 0n)
          .view({ from: divinity.getAddress() })
      )
        .map((questionNote: any) => questionNote._value)
        .map((x: QuestionNote) => new QuestionNote(x));

      // Check: are all questions included in the array (will return 10 notes, 3 and 7 which are uninitialized)
      // Match on the 3 deterministic fields of each note (ie drop the random shared key nullifier)
      type QuestionNoteWithoutRandom = Omit<
        QuestionNote,
        "shared_nullifier_key" | "callback"
      >;

      expect(questions).toEqual(
        expect.arrayContaining(
          QUESTION_NOTE_REQUESTER.slice(0, 4).map((questionNote) => {
            const noteWithoutNullifier: QuestionNoteWithoutRandom = {
              request: questionNote.request,
              requester: questionNote.requester,
              divinity: questionNote.divinity,
            };

            return expect.objectContaining(noteWithoutNullifier);
          })
        )
      );
    });

    // To fix: indices mismatch?
    it.skip("get_questions returns the correct questions when using an offset", async () => {
      // submit 20 questions
      // const [QUESTION_NOTE_REQUESTER_2] = createCorrectNotes(requester, 4);

      // Submit the questions (in a single batch for optimisation)
      await sendQuestionsBatch(QUESTION_NOTE_REQUESTER.slice(4, 8));
      await sendQuestionsBatch(QUESTION_NOTE_REQUESTER.slice(8, 12));
      await sendQuestionsBatch(QUESTION_NOTE_REQUESTER.slice(12, 16));
      await sendQuestionsBatch(QUESTION_NOTE_REQUESTER.slice(16, 19));
      await sendQuestionsBatch(QUESTION_NOTE_REQUESTER.slice(20));

      // get the questions
      const questions1: QuestionNote[] = (
        await oracle
          .withWallet(requester)
          .methods.get_questions_unconstrained(requester.getAddress(), 0n)
          .view({ from: requester.getAddress() })
      )
        .map((questionNote: any) => questionNote._value)
        .map((x: QuestionNote) => new QuestionNote(x));

      const questions2: QuestionNote[] = (
        await oracle
          .withWallet(requester)
          .methods.get_questions_unconstrained(requester.getAddress(), 0n)
          .view({ from: requester.getAddress() })
      )
        .map((questionNote: any) => questionNote._value)
        .map((x: QuestionNote) => new QuestionNote(x));

      const questions: QuestionNote[] = [...questions1, ...questions2];

      // Check: are all questions included in the array (will return 10 notes, 3 and 7 which are uninitialized)
      // Match on the 3 deterministic fields of each note (ie drop the random shared key nullifier)
      type QuestionNoteWithoutRandom = Omit<
        QuestionNote,
        "shared_nullifier_key"
      >;

      expect(questions).toEqual(
        expect.arrayContaining(
          QUESTION_NOTE_REQUESTER.map((questionNote) => {
            const noteWithoutNullifier: QuestionNoteWithoutRandom = {
              request: questionNote.request,
              requester: questionNote.requester,
              divinity: questionNote.divinity,
              callback: questionNote.callback,
            };

            return expect.objectContaining(noteWithoutNullifier);
          })
        )
      );
    }, 120_000);
  });

  describe("unconstrained: get_pending_questions_unconstrained(..)", () => {
    let QUESTION_NOTE_REQUESTER: QuestionNote[];

    // Setup: Deploy the oracle and submit 3 questions
    beforeAll(async () => {
      [QUESTION_NOTE_REQUESTER] = createCorrectNotes(requester);

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

      // Add the contract public key to the PXE
      await pxe.registerRecipient(oracle.completeAddress);

      await addTokenAndFeeNotesToPXE(
        requester.getAddress(),
        oracle.address,
        token.address,
        FEE,
        await receipt.getTxHash()
      );

      // Submit the questions (in a single batch for optimisation)
      await sendQuestionsBatch(QUESTION_NOTE_REQUESTER);
    }, 120_000);

    it("get_pending_questions_unconstrained returns the correct questions to the requester", async () => {
      // get the answers
      const questions: QuestionNote[] = (
        await oracle
          .withWallet(requester)
          .methods.get_pending_questions_unconstrained(
            divinity.getAddress(),
            0n
          )
          .view({ from: requester.getAddress() })
      )
        .map((questionNote: any) => questionNote._value)
        .map((x: QuestionNote) => new QuestionNote(x));

      // Check: are all questions included in the array (will return 10 notes, 3 and 7 which are uninitialized)
      // Match on the 3 deterministic fields of each note (ie drop the random shared key nullifier)
      type QuestionNoteWithoutRandom = Omit<
        QuestionNote,
        "shared_nullifier_key" | "callback"
      >;

      expect(questions).toEqual(
        expect.arrayContaining(
          QUESTION_NOTE_REQUESTER.map((questionNote) => {
            const noteWithoutNullifier: QuestionNoteWithoutRandom = {
              request: questionNote.request,
              requester: questionNote.requester,
              divinity: questionNote.divinity,
            };

            return expect.objectContaining(noteWithoutNullifier);
          })
        )
      );
    });

    it("get_pending_questions_unconstrained returns the correct questions to the divinity", async () => {
      // get the answers
      const questions: QuestionNote[] = (
        await oracle
          .withWallet(divinity)
          .methods.get_pending_questions_unconstrained(
            divinity.getAddress(),
            0n
          )
          .view({ from: divinity.getAddress() })
      )
        .map((questionNote: any) => questionNote._value)
        .map((x: QuestionNote) => new QuestionNote(x));

      // Check: are all questions included in the array (will return 10 notes, 3 and 7 which are uninitialized)
      // Match on the 3 deterministic fields of each note (ie drop the random shared key nullifier)
      type QuestionNoteWithoutRandom = Omit<
        QuestionNote,
        "shared_nullifier_key" | "callback"
      >;

      expect(questions).toEqual(
        expect.arrayContaining(
          QUESTION_NOTE_REQUESTER.map((questionNote) => {
            const noteWithoutNullifier: QuestionNoteWithoutRandom = {
              request: questionNote.request,
              requester: questionNote.requester,
              divinity: questionNote.divinity,
            };

            return expect.objectContaining(noteWithoutNullifier);
          })
        )
      );
    });

    it.skip("get_pending_questions_unconstrained returns the correct questions when using an offset", async () => {
      // Implement based on questions offset test
    });
  });

  describe("unconstrained: get_answers_unconstrained(..)", () => {
    let QUESTION_NOTE_DIVINITY: QuestionNote[];
    let QUESTION_NOTE_REQUESTER: QuestionNote[];
    let ANSWER_NOTE_DIVINITY: AnswerNote[];
    let ANSWER_NOTE_REQUESTER: AnswerNote[];

    // Setup: Deploy the oracle and submit 3 questions
    beforeAll(async () => {
      // Create the answer notes we should get
      [QUESTION_NOTE_DIVINITY, ANSWER_NOTE_DIVINITY] = createCorrectNotes(
        divinity,
        4
      );
      [QUESTION_NOTE_REQUESTER, ANSWER_NOTE_REQUESTER] = createCorrectNotes(
        requester,
        4
      );

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

      // Add the contract public key to the PXE
      await pxe.registerRecipient(oracle.completeAddress);

      await addTokenAndFeeNotesToPXE(
        requester.getAddress(),
        oracle.address,
        token.address,
        FEE,
        await receipt.getTxHash()
      );

      // Submit the questions (in a single batch for optimisation)
      await sendQuestionsBatch(QUESTION_NOTE_REQUESTER);

      // Submit the answers
      await sendAnswersBatch(ANSWER_NOTE_REQUESTER);
    }, 160_000);

    it("get_answers returns the correct answers to the requester", async () => {
      // get the answers
      const answer: AnswerNote[] = (
        await oracle
          .withWallet(requester)
          .methods.get_answers_unconstrained(requester.getAddress(), 0n)
          .view({ from: requester.getAddress() })
      )
        .map((answerNote: any) => answerNote._value)
        .map((x: AnswerNote) => new AnswerNote(x));

      // Check: are all answers included in the array (will return 10 notes, 3 and 7 which are uninitialized)
      expect(answer).toEqual(
        expect.arrayContaining(ANSWER_NOTE_REQUESTER.slice(0, 10))
      );
    });

    it("get_answers returns the correct answers to the divinity", async () => {
      // get the answers
      const answer: AnswerNote[] = (
        await oracle
          .withWallet(divinity)
          .methods.get_answers_unconstrained(divinity.getAddress(), 0n)
          .view({ from: divinity.getAddress() })
      )
        .map((answerNote: any) => answerNote._value)
        .map((x: AnswerNote) => new AnswerNote(x));

      // Check: Compare the answer with the expected value
      expect(answer).toEqual(
        expect.arrayContaining(ANSWER_NOTE_DIVINITY.slice(0, 10))
      );
    });

    it.skip("get_answers returns the correct answers when using an offset", async () => {
      // Implement based on questions offset test
    });
  });

  describe("unconstrained: get_answer_unconstrained(..)", () => {
    let QUESTION_NOTE_REQUESTER: QuestionNote[];
    let ANSWER_NOTE_REQUESTER: AnswerNote[];
    let ANSWER_NOTE_DIVINITY: AnswerNote[];

    // Setup: Deploy the oracle and submit a question
    beforeAll(async () => {
      // Create the answer notes we should get
      [QUESTION_NOTE_REQUESTER, ANSWER_NOTE_REQUESTER] =
        createCorrectNotes(requester);
      [, ANSWER_NOTE_DIVINITY] = createCorrectNotes(divinity);

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

      // Add the contract public key to the PXE
      await pxe.registerRecipient(oracle.completeAddress);

      await addTokenAndFeeNotesToPXE(
        requester.getAddress(),
        oracle.address,
        token.address,
        FEE,
        await receipt.getTxHash()
      );

      // Submit multiple questions (in a single batch for optimisation)
      await sendQuestionsBatch(QUESTION_NOTE_REQUESTER);

      // Submit multiple answers (in a single batch for optimisation)
      await sendAnswersBatch(ANSWER_NOTE_REQUESTER);
    }, 120_000);

    it("get_answer returns the correct answer to the requester", async () => {
      // Get the answer
      // Using "from" authentification (follow https://github.com/AztecProtocol/aztec-packages/blob/2d498b352364debf59af940f0a69c453651a4ad0/yarn-project/pxe/src/pxe_service/pxe_service.ts#L337)
      const answer: AnswerNote = new AnswerNote(
        await oracle
          .withWallet(requester)
          .methods.get_answer_unconstrained(
            QUESTION_NOTE_REQUESTER[0].request,
            requester.getAddress()
          )
          .view({ from: requester.getAddress() })
      );

      // Check: Compare the answer with the expected value
      expect(answer).toEqual(ANSWER_NOTE_REQUESTER[0]);
    });

    it("get_answer returns the correct answer to the divinity", async () => {
      // Get the answer
      // Using "from" authentification (follow https://github.com/AztecProtocol/aztec-packages/blob/2d498b352364debf59af940f0a69c453651a4ad0/yarn-project/pxe/src/pxe_service/pxe_service.ts#L337)
      const answer: AnswerNote = new AnswerNote(
        await oracle
          .withWallet(divinity)
          .methods.get_answer_unconstrained(
            QUESTION_NOTE_REQUESTER[0].request,
            divinity.getAddress()
          )
          .view({ from: divinity.getAddress() })
      );

      // Check: Compare the answer with the expected value
      expect(answer).toEqual(expect.objectContaining(ANSWER_NOTE_DIVINITY[0]));
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

      // Add the contract public key to the PXE
      await pxe.registerRecipient(oracle.completeAddress);
    }, 120_000);

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

const createAuthEscrowMessage = async (
  token: TokenContract,
  from: AccountWalletWithPrivateKey,
  agent: AztecAddress,
  amount: any
) => {
  const nonce = Fr.random();

  // We need to compute the message we want to sign and add it to the wallet as approved
  const action = token.methods.escrow(from.getAddress(), agent, amount, nonce);
  const messageHash = await computeAuthWitMessageHash(agent, action.request());

  // Both wallets are connected to same node and PXE so we could just insert directly using
  // await wallet.signAndAddAuthWitness(messageHash, );
  // But doing it in two actions to show the flow.
  const witness = await from.createAuthWitness(messageHash);
  await from.addAuthWitness(witness);
  return nonce;
};

const createAuthSubmitQuestionMessage = async (
  oracle: PrivateOracleContract,
  sender: AccountWalletWithPrivateKey,
  from: AccountWalletWithPrivateKey,
  question: Fr,
  divinity: AztecAddress,
  nonce: Fr,
  callback: bigint[] = EMPTY_CALLBACK
) => {
  // from: AztecAddress, question: Field, divinity_address: AztecAddress, nonce: Field
  // We need to compute the message we want to sign and add it to the wallet as approved
  const action = oracle
    .withWallet(sender)
    .methods.submit_question(
      from.getAddress(),
      question,
      divinity,
      nonce,
      callback
    );

  const messageHash = computeAuthWitMessageHash(
    sender.getAddress(),
    action.request()
  );

  // Both wallets are connected to same node and PXE so we could just insert directly using
  // await wallet.signAndAddAuthWitness(messageHash, );
  // But doing it in two actions to show the flow.
  const witness = await from.createAuthWitness(messageHash);

  await sender.addAuthWitness(witness);

  return action;
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

const sendQuestionsBatch = async (questionNotes: QuestionNote[]) => {
  // Create nonces for token transfer
  const nonces: Fr[] = await Promise.all(
    questionNotes.map((_) =>
      createAuthEscrowMessage(token, requester, oracle.address, FEE)
    )
  );

  const batchQuestions = new BatchCall(
    requester,
    questionNotes.map((questionNote, i) =>
      oracle.methods
        .submit_question(
          requester.getAddress(),
          questionNote.request,
          divinity.getAddress(),
          nonces[i],
          EMPTY_CALLBACK
        )
        .request()
    )
  );
  await batchQuestions.send().wait();
};

const sendAnswersBatch = async (answerNotes: AnswerNote[]) => {
  const batchAnswers = new BatchCall(
    divinity,
    answerNotes.map((answerNote) =>
      oracle.methods
        .submit_answer(
          answerNote.request,
          requester.getAddress(),
          answerNote.answer
        )
        .request()
    )
  );

  await batchAnswers.send().wait();
};

function createCorrectNotes(
  owner: AccountWalletWithPrivateKey,
  number?: number
): [QuestionNote[], AnswerNote[]] {
  return [
    Array.from({ length: number || 3 }, (_, i) => i).map((i) => {
      return new QuestionNote({
        request: QUESTION + BigInt(i),
        requester_address: requester.getAddress(),
        divinity_address: divinity.getAddress(),
        shared_nullifier_key: 0n, // Generated while submitting the question, in the contract
      });
    }),
    Array.from({ length: number || 3 }, (_, i) => i).map((i) => {
      return new AnswerNote({
        request: QUESTION + BigInt(i),
        answer: ANSWER + BigInt(i),
        requester: requester.getAddress(),
        divinity: divinity.getAddress(),
        owner: owner.getAddress(),
      });
    }),
  ];
}
