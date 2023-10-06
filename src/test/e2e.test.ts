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
} from "@aztec/aztec.js";
import { toBigIntBE } from "@aztec/foundation/bigint-buffer";
import { format } from "util";

import { PrivateOracleContract } from "../../types/privateOracle.js";

const {
  SANDBOX_URL = "http://localhost:8080",
  ETHEREUM_HOST = "http://localhost:8545",
} = process.env;

let pxe: PXE;
let oracle: PrivateOracleContract;
let requestor: AccountWallet;
let divinity: AccountWallet;

beforeAll(async () => {
  const logger = createDebugLogger("oracle");

  const { SANDBOX_URL = "http://localhost:8080" } = process.env;
  pxe = createPXEClient(SANDBOX_URL);
  await waitForSandbox(pxe);

  const nodeInfo = await pxe.getNodeInfo();

  logger(format("Aztec Sandbox Info ", nodeInfo));

  requestor = await createAccount(pxe);
  divinity = await createAccount(pxe);
});

describe("E2E Private Oracle", () => {
  beforeEach(async () => {
    const deployer = await createAccount(pxe);

    oracle = await PrivateOracleContract.deploy(deployer).send().deployed();
  }, 30_000);

  it("send request", async () => {
    const receipt = await oracle.methods
      .submit_question(123, divinity.getAddress())
      .send()
      .wait();

    console.log(receipt);
  });
});
