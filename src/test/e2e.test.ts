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
  getSandboxAccountsWallets,
  waitForSandbox,
} from "@aztec/aztec.js";
import { toBigIntBE } from "@aztec/foundation/bigint-buffer";

const {
  SANDBOX_URL = "http://localhost:8080",
  ETHEREUM_HOST = "http://localhost:8545",
} = process.env;
