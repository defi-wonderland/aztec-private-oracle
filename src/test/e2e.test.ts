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

import { PrivateOracleContract } from "../../types/privateOracle.js";

const {
  SANDBOX_URL = "http://localhost:8080",
  ETHEREUM_HOST = "http://localhost:8545",
} = process.env;

const QUESTIONS_SLOT: Fr = new Fr(1);
const ANSWERS_SLOT: Fr = new Fr(2);

let pxe: PXE;
let oracle: PrivateOracleContract;
let requester: AccountWallet;
let requester2: AccountWallet;
let divinity: AccountWallet;

beforeAll(async () => {
  const logger = createDebugLogger("oracle");

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
    let shared_key_nullifier_divinity: Fr;
    let shared_key_nullifier_requester: Fr;

    // Deploy the oracle
    beforeAll(async () => {
      const deployer = await createAccount(pxe);

      oracle = await PrivateOracleContract.deploy(deployer).send().deployed();
    }, 30_000);

    it("Tx to submit_question is mined", async () => {
      // Submit the question
      const receipt = await oracle
        .withWallet(requester)
        .methods.submit_question(123, divinity.getAddress())
        .send()
        .wait();

      expect(receipt.status).toBe("mined");
    });

    it("divinity question note has the correct data", async () => {
      const divinityRequestsNotes = await pxe.getPrivateStorageAt(
        divinity.getAddress(),
        oracle.address,
        QUESTIONS_SLOT
      );

      expect(divinityRequestsNotes[0].items[0].value).toEqual(123n);
      expect(AztecAddress.fromField(divinityRequestsNotes[0].items[1])).toEqual(
        requester.getAddress()
      );
      expect(AztecAddress.fromField(divinityRequestsNotes[0].items[2])).toEqual(
        divinity.getAddress()
      );

      shared_key_nullifier_divinity = divinityRequestsNotes[0].items[3];
    });

    it("requester question note has the correct data", async () => {
      const requesterRequestsNotes = await pxe.getPrivateStorageAt(
        requester.getAddress(),
        oracle.address,
        QUESTIONS_SLOT
      );

      expect(requesterRequestsNotes[0].items[0].value).toEqual(123n);
      expect(
        AztecAddress.fromField(requesterRequestsNotes[0].items[1])
      ).toEqual(requester.getAddress());
      expect(
        AztecAddress.fromField(requesterRequestsNotes[0].items[2])
      ).toEqual(divinity.getAddress());

      shared_key_nullifier_requester = requesterRequestsNotes[0].items[3];
    });

    it("nullifier key is the same between the 2 notes", async () => {
      expect(shared_key_nullifier_divinity).toEqual(
        shared_key_nullifier_requester
      );
    });

    it("another requester can ask the same question", async () => {
      // Submit the question
      await oracle
        .withWallet(requester2)
        .methods.submit_question(123, divinity.getAddress())
        .send()
        .wait();

      const divinityRequestsNotes = await pxe.getPrivateStorageAt(
        divinity.getAddress(),
        oracle.address,
        QUESTIONS_SLOT
      );

      const requesterRequestsNotes = await pxe.getPrivateStorageAt(
        requester.getAddress(),
        oracle.address,
        QUESTIONS_SLOT
      );
      // TODO: map and only keep the right requester (instead of taking the idx 1 which is funky)
      expect(divinityRequestsNotes[1].items[0].value).toEqual(123n);
      expect(AztecAddress.fromField(divinityRequestsNotes[1].items[1])).toEqual(
        requester2.getAddress()
      );
      expect(AztecAddress.fromField(divinityRequestsNotes[1].items[2])).toEqual(
        divinity.getAddress()
      );

      expect(requesterRequestsNotes[0].items[0].value).toEqual(123n);
      expect(
        AztecAddress.fromField(requesterRequestsNotes[0].items[1])
      ).toEqual(requester2.getAddress());
      expect(
        AztecAddress.fromField(requesterRequestsNotes[0].items[2])
      ).toEqual(divinity.getAddress());

      expect(divinityRequestsNotes[1].items[3]).toEqual(
        requesterRequestsNotes[0].items[3]
      );
      expect(divinityRequestsNotes[0].items[3]).not.toEqual(
        shared_key_nullifier_divinity
      );
    });
  });

  describe("submit_answer(..)", () => {
    // Deploy the oracle and submit the question
    beforeAll(async () => {
      const deployer = await createAccount(pxe);

      oracle = await PrivateOracleContract.deploy(deployer).send().deployed();

      // Submit the question
      await oracle
        .withWallet(requester)
        .methods.submit_question(123, divinity.getAddress())
        .send()
        .wait();
    }, 30_000);

    it("Tx to submit_answer is mined", async () => {
      // Submit the answer
      const receipt = await oracle
        .withWallet(divinity)
        .methods.submit_answer(123, 456)
        .send()
        .wait();

      expect(receipt.status).toBe("mined");
    });

    it("divinity answer note has the correct data", async () => {
      const divinityAnswersNotes = await pxe.getPrivateStorageAt(
        divinity.getAddress(),
        oracle.address,
        ANSWERS_SLOT
      );

      expect(divinityAnswersNotes[0].items[0].value).toEqual(123n);
      expect(divinityAnswersNotes[0].items[1].value).toEqual(456n);
    });

    it("requester answer note has the correct data", async () => {
      const requesterAnswersNotes = await pxe.getPrivateStorageAt(
        requester.getAddress(),
        oracle.address,
        ANSWERS_SLOT
      );

      expect(requesterAnswersNotes[0].items[0].value).toEqual(123n);
      expect(requesterAnswersNotes[0].items[1].value).toEqual(456n);
    });

    it("requester request note has been nullified", async () => {
      const requesterRequestsNotes = await pxe.getPrivateStorageAt(
        requester.getAddress(),
        oracle.address,
        QUESTIONS_SLOT
      );

      expect(requesterRequestsNotes.length).toEqual(0);
    });

    it("divinity request note has been nullified", async () => {
      const divinityRequestsNotes = await pxe.getPrivateStorageAt(
        divinity.getAddress(),
        oracle.address,
        QUESTIONS_SLOT
      );

      expect(divinityRequestsNotes.length).toEqual(0);
    });

    it("second identical question cannot have a different answer (from the same divinity)", async () => {
      await oracle
        .withWallet(requester2)
        .methods.submit_question(123, divinity.getAddress())
        .send()
        .wait();

      await oracle
        .withWallet(divinity)
        .methods.submit_answer(123, 789) // different answer passed, should be discarded and 456 used instead
        .send()
        .wait();

      const requester2AnswersNotes = await pxe.getPrivateStorageAt(
        requester2.getAddress(),
        oracle.address,
        ANSWERS_SLOT
      );

      expect(requester2AnswersNotes[0].items[0].value).toEqual(123n);
      expect(requester2AnswersNotes[0].items[1].value).toEqual(456n);
    });
  });
});
