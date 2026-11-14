import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Account,
  JsonRpcProvider,
  KeyPair,
  actions,
} from "near-api-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env.local");
const WASM_PATH = path.join(
  ROOT,
  "contracts/city/target/wasm32-unknown-unknown/release/city.wasm",
);
const RPC_URL = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const FAUCET_URL =
  process.env.NEAR_FAUCET_URL ?? "https://helper.testnet.near.org/account";
const FRESH = process.argv.includes("--fresh");

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

function writeEnv(values) {
  const current = readEnv();
  Object.assign(current, values);
  const body = Object.entries(current)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  fs.writeFileSync(ENV_PATH, `${body}\n`);
}

async function accountExists(provider, accountId) {
  try {
    await provider.viewAccount(accountId);
    return true;
  } catch {
    return false;
  }
}

async function contractResponds(provider, accountId) {
  try {
    await provider.callFunction({
      contractId: accountId,
      method: "get_stats",
      args: {},
    });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(fn, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

async function createViaFaucet(accountId, publicKey) {
  const response = await fetch(FAUCET_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      newAccountId: accountId,
      newAccountPublicKey: publicKey,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`faucet ${response.status}: ${text.slice(0, 300)}`);
  }
  return text;
}

async function main() {
  const env = readEnv();
  const provider = new JsonRpcProvider({ url: RPC_URL });

  const suffix = Math.random().toString(36).slice(2, 7);
  const accountId = env.NEAR_ACCOUNT_ID || `npt-city-${suffix}.testnet`;
  const keyPair = env.NEAR_PRIVATE_KEY
    ? KeyPair.fromString(env.NEAR_PRIVATE_KEY)
    : KeyPair.fromRandom("ed25519");
  const secretKey = keyPair.toString();
  const publicKey = keyPair.getPublicKey().toString();

  console.log(`network  testnet (${RPC_URL})`);
  console.log(`contract ${accountId}`);

  writeEnv({
    NEAR_NETWORK: "testnet",
    NEAR_RPC_URL: RPC_URL,
    NEAR_ACCOUNT_ID: accountId,
    NEAR_PRIVATE_KEY: secretKey,
    NEAR_PUBLIC_KEY: publicKey,
  });

  const deployed = await contractResponds(provider, accountId);

  if (deployed && !FRESH) {
    console.log("contract already deployed, skipping (use --fresh to redeploy)");
  } else {
    if (deployed) {
      console.log("deleting existing account for a fresh deploy");
      const account = new Account(accountId, provider, secretKey);
      await account.signAndSendTransaction({
        receiverId: accountId,
        waitUntil: "FINAL",
        actions: [actions.deleteAccount(accountId)],
      });
      await waitFor(async () => !(await accountExists(provider, accountId)));
    }

    if (!(await accountExists(provider, accountId))) {
      console.log("creating account via testnet faucet");
      await createViaFaucet(accountId, publicKey);
      await waitFor(async () => accountExists(provider, accountId));
    }

    const account = new Account(accountId, provider, secretKey);
    const wasm = fs.readFileSync(WASM_PATH);
    console.log(`deploying ${(wasm.length / 1024).toFixed(1)} KiB wasm`);
    const result = await account.signAndSendTransaction({
      receiverId: accountId,
      waitUntil: "FINAL",
      actions: [
        actions.deployContract(new Uint8Array(wasm)),
        actions.functionCall("new", { owner: accountId }, 100n * 10n ** 12n, 0n),
      ],
    });
    if (result.status && "Failure" in result.status) {
      throw new Error(`deploy failed ${JSON.stringify(result.status)}`);
    }
    console.log("deploy confirmed");
  }

  await waitFor(async () => {
    try {
      const owner = await provider.callFunction({
        contractId: accountId,
        method: "get_owner",
        args: {},
      });
      return owner === accountId;
    } catch {
      return false;
    }
  });

  const stats = await provider.callFunction({
    contractId: accountId,
    method: "get_stats",
    args: {},
  });
  console.log(`stats ${JSON.stringify(stats)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
