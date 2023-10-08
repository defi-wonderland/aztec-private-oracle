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
let divinity: AccountWallet;

beforeAll(async () => {
  const logger = createDebugLogger("oracle");

  const { SANDBOX_URL = "http://localhost:8080" } = process.env;
  pxe = createPXEClient(SANDBOX_URL);
  await waitForSandbox(pxe);

  const nodeInfo = await pxe.getNodeInfo();

  logger(format("Aztec Sandbox Info ", nodeInfo));

  requester = await createAccount(pxe);
  divinity = await createAccount(pxe);
});

describe("E2E Private Oracle", () => {
  // Deploy the oracle
  beforeAll(async () => {
    const deployer = await createAccount(pxe);

    oracle = await PrivateOracleContract.deploy(deployer).send().deployed();
  }, 30_000);

  describe("submit_question(..)", () => {
    let shared_key_nullifier_divinity: Fr;
    let shared_key_nullifier_requester: Fr;

    it("Tx to submit_question is mined", async () => {
      // Submit the question
      const receipt = await oracle
        .withWallet(requester)
        .methods.submit_question(123, divinity.getAddress())
        .send()
        .wait();

      expect(receipt.status).toBe("mined");
    });

    it("divinity note has the correct data", async () => {
      const divinityNotes = await pxe.getPrivateStorageAt(
        divinity.getAddress(),
        oracle.address,
        QUESTIONS_SLOT
      );

      expect(divinityNotes[0].items[0].value).toEqual(123n);
      expect(AztecAddress.fromField(divinityNotes[0].items[1])).toEqual(
        requester.getAddress()
      );
      expect(AztecAddress.fromField(divinityNotes[0].items[2])).toEqual(
        divinity.getAddress()
      );

      shared_key_nullifier_divinity = divinityNotes[0].items[3];
    });

    it("requester note has the correct data", async () => {
      const requesterNotes = await pxe.getPrivateStorageAt(
        requester.getAddress(),
        oracle.address,
        QUESTIONS_SLOT
      );

      expect(requesterNotes[0].items[0].value).toEqual(123n);
      expect(AztecAddress.fromField(requesterNotes[0].items[1])).toEqual(
        requester.getAddress()
      );
      expect(AztecAddress.fromField(requesterNotes[0].items[2])).toEqual(
        divinity.getAddress()
      );

      shared_key_nullifier_requester = requesterNotes[0].items[3];
    });

    it("nullifier key is the same between the 2 notes", async () => {
      expect(shared_key_nullifier_divinity).toEqual(
        shared_key_nullifier_requester
      );
    });
  });
});
