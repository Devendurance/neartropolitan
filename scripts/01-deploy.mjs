import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair, actions } from "near-api-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env.local");
const WASM_PATH = path.join(
  ROOT,
  "contracts/city/target/wasm32-unknown-unknown/release/city.wasm",
);
const RPC_URL = "https://test.rpc.fastnear.com";
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
  fs.writeFileSync(
    ENV_PATH,
    `${Object.entries(current)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
  );
}

async function accountExists(provider, accountId) {
  try {
    await provider.sendJsonRpc("query", {
      request_type: "view_account",
      finality: "final",
      account_id: accountId,
    });
    return true;
  } catch {
    return false;
  }
}

async function contractResponds(provider, accountId) {
  try {
    await provider.callFunction({ contractId: accountId, method: "get_stats", args: {} });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(fn, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

async function deploy(provider, contractId, signerId, secretKey) {
  const wasm = fs.readFileSync(WASM_PATH);
  const account = new Account(signerId, provider, secretKey);
  console.log(`deploying ${(wasm.length / 1024).toFixed(1)} KiB wasm to ${contractId}`);
  const result = await account.signAndSendTransaction({
    receiverId: contractId,
    waitUntil: "FINAL",
    actions: [
      actions.deployContract(new Uint8Array(wasm)),
      actions.functionCall("new", { owner: contractId }, 100n * 10n ** 12n, 0n),
    ],
  });
  const status = result.status;
  if (status && typeof status === "object" && "Failure" in status) {
    throw new Error(`deploy failed ${JSON.stringify(status)}`);
  }
  console.log("deploy confirmed");
}

async function main() {
  const env = readEnv();
  const provider = new JsonRpcProvider({ url: RPC_URL });

  const deployerId = env.NEAR_DEPLOYER_ID;
  const deployerKey = env.NEAR_DEPLOYER_PRIVATE_KEY;

  // Path 1: a funded named account was provided. Create a readable
  // sub-account and deploy there.
  if (deployerId && deployerKey) {
    const keyPair = KeyPair.fromString(deployerKey);
    const contractId = env.NEAR_CONTRACT_ID || `city.${deployerId}`;
    console.log(`deployer ${deployerId}`);
    console.log(`contract ${contractId}`);

    const deployer = new Account(deployerId, provider, deployerKey);
    const balance = await provider
      .sendJsonRpc("query", {
        request_type: "view_account",
        finality: "final",
        account_id: deployerId,
      })
      .catch(() => null);
    console.log(`deployer balance ${balance ? Number(balance.amount) / 1e24 : 0} NEAR`);

    if (!(await accountExists(provider, contractId))) {
      console.log("creating contract sub-account");
      await deployer.signAndSendTransaction({
        receiverId: contractId,
        waitUntil: "FINAL",
        actions: [
          actions.createAccount(),
          actions.transfer(500_000_000_000_000_000_000_000n),
          actions.addFullAccessKey(keyPair.getPublicKey()),
        ],
      });
      await waitFor(async () => accountExists(provider, contractId));
    }

    const already = await contractResponds(provider, contractId);
    if (already && !FRESH) {
      console.log("contract already deployed, skipping (use --fresh to redeploy)");
    } else {
      if (already) {
        console.log("existing contract state must be deleted before a fresh deploy");
        const existing = new Account(contractId, provider, deployerKey);
        await existing.signAndSendTransaction({
          receiverId: contractId,
          waitUntil: "FINAL",
          actions: [actions.deleteAccount(deployerId)],
        });
        await waitFor(async () => !(await accountExists(provider, contractId)));
        await deployer.signAndSendTransaction({
          receiverId: contractId,
          waitUntil: "FINAL",
          actions: [
            actions.createAccount(),
            actions.transfer(500_000_000_000_000_000_000_000n),
            actions.addFullAccessKey(keyPair.getPublicKey()),
          ],
        });
        await waitFor(async () => accountExists(provider, contractId));
      }
      await deploy(provider, contractId, contractId, deployerKey);
    }

    writeEnv({
      NEAR_NETWORK: "testnet",
      NEAR_RPC_URL: RPC_URL,
      NEAR_ACCOUNT_ID: contractId,
      NEAR_PRIVATE_KEY: deployerKey,
      NEAR_PUBLIC_KEY: keyPair.getPublicKey().toString(),
    });
    const stats = await provider.callFunction({
      contractId,
      method: "get_stats",
      args: {},
    });
    console.log(`stats ${JSON.stringify(stats)}`);
    return;
  }

  // Path 2: no named deployer, use the implicit account in .env.local and the
  // testnet faucet if it is not funded yet.
  const suffix = Math.random().toString(36).slice(2, 7);
  const accountId = env.NEAR_ACCOUNT_ID || `npt-city-${suffix}.testnet`;
  const keyPair = env.NEAR_PRIVATE_KEY
    ? KeyPair.fromString(env.NEAR_PRIVATE_KEY)
    : KeyPair.fromRandom("ed25519");
  const secretKey = keyPair.toString();
  const publicKey = keyPair.getPublicKey().toString();

  writeEnv({
    NEAR_NETWORK: "testnet",
    NEAR_RPC_URL: RPC_URL,
    NEAR_ACCOUNT_ID: accountId,
    NEAR_PRIVATE_KEY: secretKey,
    NEAR_PUBLIC_KEY: publicKey,
  });

  const exists = await accountExists(provider, accountId);
  if (!exists) {
    console.log("creating account via testnet faucet");
    const response = await fetch(FAUCET_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
    });
    if (!response.ok) {
      throw new Error(`faucet ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    await waitFor(async () => accountExists(provider, accountId));
  }

  if (await contractResponds(provider, accountId)) {
    console.log("contract already deployed, skipping (use --fresh to redeploy)");
  } else {
    await deploy(provider, accountId, accountId, secretKey);
  }

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
