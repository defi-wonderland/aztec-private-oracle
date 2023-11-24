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

import { TokenContract } from "@aztec/noir-contracts/types";

import { PrivateOracleContract } from "../../types/PrivateOracle.js";
import { AnswerNote, QuestionNote } from "../../types/Notes.js";

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
      const nonce = await createAuthUnshieldMessage(
        token,
        requester,
        oracle.address,
        FEE
      );
      // Submit the question
      const receipt = await oracle
        .withWallet(requester)
        .methods.submit_question(
          QUESTION_NOTE.request,
          divinity.getAddress(),
          nonce
        )
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
      const question: QuestionNote = new QuestionNote(
        (
          await oracle
            .withWallet(divinity)
            .methods.get_pending_questions_unconstrained(divinity.getAddress())
            .view({ from: divinity.getAddress() })
        )[0]
      ); // returns 10 by default

      console.log(question);

      // Check: Compare the note's data with the expected values
      type QuestionNoteWithoutRandom = Omit<
        QuestionNote,
        "shared_nullifier_key"
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
      const question: QuestionNote = (
        await oracle
          .withWallet(requester)
          .methods.get_pending_questions_unconstrained(divinity.getAddress())
          .view({ from: requester.getAddress() })
      ).map((x: QuestionNote) => new QuestionNote(x))[0]; // returns 10 by default

      // Check: Compare the note's data with the expected values
      type QuestionNoteWithoutRandom = Omit<
        QuestionNote,
        "shared_nullifier_key"
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
    it.only("another requester can ask the same question and will get a different nullifier shared key", async () => {
      const nonce = await createAuthUnshieldMessage(
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
          QUESTION_NOTE.request + 1n,
          divinity.getAddress(),
          nonce
        )
        .send()
        .wait();

      const storedQuestions: QuestionNote[] = (
        await oracle
          .withWallet(divinity)
          .methods.get_pending_questions_unconstrained(divinity.getAddress())
          .view({ from: divinity.getAddress() })
      ).map((x: QuestionNote) => new QuestionNote(x)); // returns 10 by default

      console.log(
        await oracle
          .withWallet(divinity)
          .methods.get_pending_questions_unconstrained(divinity.getAddress())
          .view({ from: divinity.getAddress() })
      );

      // Check: Compare the note's data with the expected values
      type QuestionNoteWithoutRandom = Omit<
        QuestionNote,
        "shared_nullifier_key"
      >;

      const questionNoteWithoutRandom: QuestionNoteWithoutRandom = {
        request: QUESTION_NOTE.request,
        requester: QUESTION_NOTE.requester,
        divinity: QUESTION_NOTE.divinity,
      };

      const matches = storedQuestions.filter((obj) =>
        expect.objectContaining(questionNoteWithoutRandom).asymmetricMatch(obj)
      );

      // Check: Compare the note's data with the expected values (this is the second note for the divnity)
      expect(matches.length).toBe(2);

      // Check: nullifier keys should be different
      expect(matches[0].shared_nullifier_key).not.toEqual(
        matches[1].shared_nullifier_key
      );
    }, 120_000);
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
    }, 120_000);

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

  describe("unconstrained: get_questions_unconstrained(..)", () => {
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

    it("get_questions returns the correct questions to the requester", async () => {
      // get the answers
      const questions: QuestionNote[] = (
        await oracle
          .withWallet(requester)
          .methods.get_questions_unconstrained(requester.getAddress())
          .view({ from: requester.getAddress() })
      ).map((x: QuestionNote) => new QuestionNote(x));

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
          .methods.get_questions_unconstrained(requester.getAddress())
          .view({ from: divinity.getAddress() })
      ).map((x: QuestionNote) => new QuestionNote(x));

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
            };

            return expect.objectContaining(noteWithoutNullifier);
          })
        )
      );
    });
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
          .methods.get_pending_questions_unconstrained(divinity.getAddress())
          .view({ from: requester.getAddress() })
      ).map((x: QuestionNote) => new QuestionNote(x));

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
          .methods.get_pending_questions_unconstrained(divinity.getAddress())
          .view({ from: divinity.getAddress() })
      ).map((x: QuestionNote) => new QuestionNote(x));

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
            };

            return expect.objectContaining(noteWithoutNullifier);
          })
        )
      );
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
      [QUESTION_NOTE_DIVINITY, ANSWER_NOTE_DIVINITY] =
        createCorrectNotes(divinity);
      [QUESTION_NOTE_REQUESTER, ANSWER_NOTE_REQUESTER] =
        createCorrectNotes(requester);

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

      // Submit the questions (in a single batch for optimisation)
      await sendQuestionsBatch(QUESTION_NOTE_REQUESTER);

      // Submit the answers
      await sendAnswersBatch(ANSWER_NOTE_REQUESTER);
    }, 120_000);

    it("get_answer returns the correct answers to the requester", async () => {
      // get the answers
      const answer: AnswerNote[] = (
        await oracle
          .withWallet(requester)
          .methods.get_answers_unconstrained(requester.getAddress())
          .view({ from: requester.getAddress() })
      ).map((x: AnswerNote) => new AnswerNote(x));

      // Check: are all answers included in the array (will return 10 notes, 3 and 7 which are uninitialized)
      expect(answer).toEqual(expect.arrayContaining(ANSWER_NOTE_REQUESTER));
    });

    it("get_answer returns the correct answers to the divinity", async () => {
      // get the answers
      const answer: AnswerNote[] = (
        await oracle
          .withWallet(divinity)
          .methods.get_answers_unconstrained(divinity.getAddress())
          .view({ from: divinity.getAddress() })
      ).map((x: AnswerNote) => new AnswerNote(x));

      // Check: Compare the answer with the expected value
      expect(answer).toEqual(expect.arrayContaining(ANSWER_NOTE_DIVINITY));
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

const sendQuestionsBatch = async (questionNotes: QuestionNote[]) => {
  // Create 3 nonces for token transfer
  const nonces: Fr[] = await Promise.all([
    createAuthUnshieldMessage(token, requester, oracle.address, FEE),
    createAuthUnshieldMessage(token, requester, oracle.address, FEE),
    createAuthUnshieldMessage(token, requester, oracle.address, FEE),
  ]);
  const batchQuestions = new BatchCall(requester, [
    oracle.methods
      .submit_question(
        questionNotes[0].request,
        divinity.getAddress(),
        nonces[0]
      )
      .request(),
    oracle.methods
      .submit_question(
        questionNotes[1].request,
        divinity.getAddress(),
        nonces[1]
      )
      .request(),
    oracle.methods
      .submit_question(
        questionNotes[2].request,
        divinity.getAddress(),
        nonces[2]
      )
      .request(),
  ]);

  await batchQuestions.send().wait();
};

const sendAnswersBatch = async (answerNotes: AnswerNote[]) => {
  const batchAnswers = new BatchCall(divinity, [
    oracle.methods
      .submit_answer(
        answerNotes[0].request,
        requester.getAddress(),
        answerNotes[0].answer
      )
      .request(),
    oracle.methods
      .submit_answer(
        answerNotes[1].request,
        requester.getAddress(),
        answerNotes[1].answer
      )
      .request(),
    oracle.methods
      .submit_answer(
        answerNotes[2].request,
        requester.getAddress(),
        answerNotes[2].answer
      )
      .request(),
  ]);

  await batchAnswers.send().wait();
};

function createCorrectNotes(
  owner: AccountWalletWithPrivateKey
): [QuestionNote[], AnswerNote[]] {
  return [
    [
      {
        request: QUESTION,
        requester: requester.getAddress(),
        divinity: divinity.getAddress(),
        shared_nullifier_key: 0n, // Generated while submitting the question, in the contract
      },
      {
        request: QUESTION + 1n,
        requester: requester.getAddress(),
        divinity: divinity.getAddress(),
        shared_nullifier_key: 0n,
      },
      {
        request: QUESTION + 2n,
        requester: requester.getAddress(),
        divinity: divinity.getAddress(),
        shared_nullifier_key: 0n,
      },
    ],
    [
      {
        request: QUESTION,
        answer: ANSWER,
        requester: requester.getAddress(),
        divinity: divinity.getAddress(),
        owner: owner.getAddress(),
      },
      {
        request: QUESTION + 1n,
        answer: ANSWER + 1n,
        requester: requester.getAddress(),
        divinity: divinity.getAddress(),
        owner: owner.getAddress(),
      },
      {
        request: QUESTION + 2n,
        answer: ANSWER + 2n,
        requester: requester.getAddress(),
        divinity: divinity.getAddress(),
        owner: owner.getAddress(),
      },
    ],
  ];
};