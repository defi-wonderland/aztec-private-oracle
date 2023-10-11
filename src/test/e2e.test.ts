import { createSandbox } from "@aztec/aztec-sandbox";
import {
  AccountWallet,
  CheatCodes,
  Fr,
  L2BlockL2Logs,
  NotePreimage,
  PXE,
  UnencryptedL2Log,
  computeMessageSecretHash,
  createAccount,
  createPXEClient,
  createDebugLogger,
  getSandboxAccountsWallets,
  waitForSandbox,
  AztecAddress,
} from "@aztec/aztec.js";
import { toBigIntBE } from "@aztec/foundation/bigint-buffer";
import { format } from "util";

import { PrivateOracleContract } from "../../types/PrivateOracle.js";

const {
  SANDBOX_URL = "http://localhost:8080",
  ETHEREUM_HOST = "http://localhost:8545",
} = process.env;

const QUESTIONS_SLOT: Fr = new Fr(1);
const ANSWERS_SLOT: Fr = new Fr(2);

const QUESTION = 123n;
const ANSWER = 456n;
const ALTERNATIVE_ANSWER = 789n;

let pxe: PXE;
let oracle: PrivateOracleContract;
let requester: AccountWallet;
let requester2: AccountWallet;
let divinity: AccountWallet;

const logger = createDebugLogger("oracle");

// Setup: Set the sandbox
beforeAll(async () => {
  const { SANDBOX_URL = "http://localhost:8080" } = process.env;
  pxe = createPXEClient(SANDBOX_URL);
  await waitForSandbox(pxe);

  const nodeInfo = await pxe.getNodeInfo();

  logger(format("Aztec Sandbox Info ", nodeInfo));

  requester = await createAccount(pxe);
  requester2 = await createAccount(pxe);
  divinity = await createAccount(pxe);
}, 30_000);


describe("E2E Private Oracle", () => {
  describe("submit_question(..)", () => {
    // global scoped to assert accross 'it' blocks
    let shared_key_nullifier_divinity: Fr;
    let shared_key_nullifier_requester: Fr;

    // Setup: Deploy the oracle
    beforeAll(async () => {
      const deployer = await createAccount(pxe);

      oracle = await PrivateOracleContract.deploy(deployer).send().deployed();

      logger(`Oracle deployed at ${oracle.address}`);
    }, 30_000);

    // Test: is the tx successful
    it("Tx to submit_question is mined", async () => {
      // Submit the question
      const receipt = await oracle
        .withWallet(requester)
        .methods.submit_question(QUESTION, divinity.getAddress())
        .send()
        .wait();

      expect(receipt.status).toBe("mined");
    });

    // Test: is the note correctly stored in the private storage, for the divinity
    it("divinity question note has the correct data", async () => {
      // Get the private storage for the divinity's question slot
      const divinityRequestsNotes = await pxe.getPrivateStorageAt(
        divinity.getAddress(),
        oracle.address,
        QUESTIONS_SLOT
      );

      // Check: Compare the note's data with the expected values
      expect(divinityRequestsNotes[0].items[0].value).toEqual(QUESTION);
      expect(AztecAddress.fromField(divinityRequestsNotes[0].items[1])).toEqual(
        requester.getAddress()
      );
      expect(AztecAddress.fromField(divinityRequestsNotes[0].items[2])).toEqual(
        divinity.getAddress()
      );

      // Store the random nullifier shared key, for later comparison
      shared_key_nullifier_divinity = divinityRequestsNotes[0].items[3];
    });

    // Test: is the note correctly stored in the private storage, for the requester
    it("requester question note has the correct data", async () => {
      // Get the private storage for the requester's question slot
      const requesterRequestsNotes = await pxe.getPrivateStorageAt(
        requester.getAddress(),
        oracle.address,
        QUESTIONS_SLOT
      );

      // Compare the note's data with the expected values
      expect(requesterRequestsNotes[0].items[0].value).toEqual(QUESTION);
      expect(
        AztecAddress.fromField(requesterRequestsNotes[0].items[1])
      ).toEqual(requester.getAddress());
      expect(
        AztecAddress.fromField(requesterRequestsNotes[0].items[2])
      ).toEqual(divinity.getAddress());

      // Store the random nullifier shared key, for later comparison
      shared_key_nullifier_requester = requesterRequestsNotes[0].items[3];
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
      // Submit the question
      await oracle
        .withWallet(requester2)
        .methods.submit_question(QUESTION, divinity.getAddress())
        .send()
        .wait();

      // Get the private storage for the divinity's question slot
      const divinityRequestsNotes = await pxe.getPrivateStorageAt(
        divinity.getAddress(),
        oracle.address,
        QUESTIONS_SLOT
      );

      // Get the private storage for the *other* requester's question slot
      const requesterRequestsNotes = await pxe.getPrivateStorageAt(
        requester2.getAddress(),
        oracle.address,
        QUESTIONS_SLOT
      );

      // Check: Compare the note's data with the expected values (this is the second note for the divnity)
      expect(divinityRequestsNotes[1].items[0].value).toEqual(QUESTION);
      expect(AztecAddress.fromField(divinityRequestsNotes[1].items[1])).toEqual(
        requester2.getAddress()
      );
      expect(AztecAddress.fromField(divinityRequestsNotes[1].items[2])).toEqual(
        divinity.getAddress()
      );

      expect(requesterRequestsNotes[0].items[0].value).toEqual(QUESTION);
      expect(
        AztecAddress.fromField(requesterRequestsNotes[0].items[1])
      ).toEqual(requester2.getAddress());
      expect(
        AztecAddress.fromField(requesterRequestsNotes[0].items[2])
      ).toEqual(divinity.getAddress());

      // Check: Nullifier shared key is the same for requester and divinity
      expect(divinityRequestsNotes[1].items[3]).toEqual(
        requesterRequestsNotes[0].items[3]
      );

      // Check: Nullifier shared key is different from the previous request
      expect(divinityRequestsNotes[1].items[3]).not.toEqual(
        shared_key_nullifier_divinity
      );
    });
  });

  describe("submit_answer(..)", () => {
    // Setup: Deploy the oracle and submit a question
    beforeAll(async () => {
      const deployer = await createAccount(pxe);

      // Deploy the oracle
      oracle = await PrivateOracleContract.deploy(deployer).send().deployed();

      // Submit a question
      await oracle
        .withWallet(requester)
        .methods.submit_question(QUESTION, divinity.getAddress())
        .send()
        .wait();
    }, 30_000);

    // Test: is the tx successful
    it("Tx to submit_answer is mined", async () => {
      // Submit the answer
      const receipt = await oracle
        .withWallet(divinity)
        .methods.submit_answer(QUESTION, requester.getAddress(), ANSWER)
        .send()
        .wait();

      expect(receipt.status).toBe("mined");
    });

    // Test: is the answer note stored correct, for the divinity
    it("divinity answer note has the correct data", async () => {
      // Get the private storage for the divinity's answer slot
      const divinityAnswersNotes = await pxe.getPrivateStorageAt(
        divinity.getAddress(),
        oracle.address,
        ANSWERS_SLOT
      );

      // Check: Compare the note's data with the expected values
      expect(divinityAnswersNotes[0].items[0].value).toEqual(QUESTION);
      expect(divinityAnswersNotes[0].items[1].value).toEqual(ANSWER);
    });

    // Test: is the answer note stored correct, for the requester
    it("requester answer note has the correct data", async () => {
      // Get the private storage for the requester's answer slot
      const requesterAnswersNotes = await pxe.getPrivateStorageAt(
        requester.getAddress(),
        oracle.address,
        ANSWERS_SLOT
      );

      // Check: Compare the note's data with the expected values
      expect(requesterAnswersNotes[0].items[0].value).toEqual(QUESTION);
      expect(requesterAnswersNotes[0].items[1].value).toEqual(ANSWER);
    });

    // Test: is the request note of the requester now nullified
    it("requester request note has been nullified", async () => {
      // Get the private storage for the requester's question slot
      const requesterRequestsNotes = await pxe.getPrivateStorageAt(
        requester.getAddress(),
        oracle.address,
        QUESTIONS_SLOT
      );

      // Check: There is no request left (has been nullified when submit_answer was called)
      expect(requesterRequestsNotes.length).toEqual(0);
    });

    // Test: is the request note of the divinity now nullified
    it("divinity request note has been nullified", async () => {
      // Get the private storage for the divinity's question slot
      const divinityRequestsNotes = await pxe.getPrivateStorageAt(
        divinity.getAddress(),
        oracle.address,
        QUESTIONS_SLOT
      );

      // Check: There is no request left (has been nullified when submit_answer was called)
      expect(divinityRequestsNotes.length).toEqual(0);
    });

    // Test: if a second request is made from a different requester, asking the same question, is the divinity
    //       forced to answer with the same answer (answer consistency)?
    it("second identical question cannot have a different answer (from the same divinity)", async () => {
      // Setup: submit the same question from a second requester
      await oracle
        .withWallet(requester2)
        .methods.submit_question(QUESTION, divinity.getAddress())
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
      const requester2AnswersNotes = await pxe.getPrivateStorageAt(
        requester2.getAddress(),
        oracle.address,
        ANSWERS_SLOT
      );

      // Check: Compare the note's data with the expected values: the answer is the same as the first one and not the new one
      expect(requester2AnswersNotes[0].items[0].value).toEqual(QUESTION);
      expect(requester2AnswersNotes[0].items[1].value).toEqual(ANSWER);
    });
  });

  describe("cancel_question(..)", () => {
    // Setup: Deploy the oracle and submit the question
    beforeAll(async () => {
      const deployer = await createAccount(pxe);

      // Deploy the oracle
      oracle = await PrivateOracleContract.deploy(deployer).send().deployed();

      // Submit a question
      await oracle
        .withWallet(requester)
        .methods.submit_question(QUESTION, divinity.getAddress())
        .send()
        .wait();
    }, 30_000);

    // Test: is the tx successful
    it("Tx to cancel_question is mined", async () => {
      const receipt = await oracle
        .withWallet(requester)
        .methods.cancel_question(QUESTION)
        .send()
        .wait();

      expect(receipt.status).toBe("mined");
    });

    // Test: is the request note of the requester now nullified
    it("requester request note has been nullified", async () => {
      // Get the private storage for the requester's question slot
      const requesterRequestsNotes = await pxe.getPrivateStorageAt(
        requester.getAddress(),
        oracle.address,
        QUESTIONS_SLOT
      );

      // Check: There is no request left (has been nullified when cancel_question was called)
      expect(requesterRequestsNotes.length).toEqual(0);
    });

    // Test: is the request note of the divinity now nullified
    it("divinity request note has been nullified", async () => {
      // Get the private storage for the divinity's question slot
      const divinityRequestsNotes = await pxe.getPrivateStorageAt(
        divinity.getAddress(),
        oracle.address,
        QUESTIONS_SLOT
      );

      // Check: There is no request left (has been nullified when cancel_question was called)
      expect(divinityRequestsNotes.length).toEqual(0);
    });
  });
});
