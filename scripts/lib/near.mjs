import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair, actions, keyToImplicitAddress } from "near-api-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENV_PATH = path.join(ROOT, ".env.local");

export function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

export function saveEnv(values) {
  const current = loadEnv();
  Object.assign(current, values);
  fs.writeFileSync(
    ENV_PATH,
    `${Object.entries(current)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
  );
}

export const env = loadEnv();
export const CONTRACT_ID = env.NEAR_ACCOUNT_ID;
export const NETWORK = env.NEAR_NETWORK ?? "testnet";
export const GAS = 30n * 10n ** 12n;
export const YOCTO = 10n ** 24n;

export const provider = new JsonRpcProvider({
  url: env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
});

export function ownerAccount() {
  return new Account(CONTRACT_ID, provider, env.NEAR_PRIVATE_KEY);
}

export function implicitAccount(keyPair) {
  const accountId = keyToImplicitAddress(keyPair.getPublicKey().toString());
  return new Account(accountId, provider, keyPair.toString());
}

export function randomImplicitAccount() {
  const keyPair = KeyPair.fromRandom("ed25519");
  return { keyPair, account: implicitAccount(keyPair), accountId: keyToImplicitAddress(keyPair.getPublicKey().toString()) };
}

export async function view(method, args = {}) {
  return provider.callFunction({ contractId: CONTRACT_ID, method, args });
}

export async function call(account, method, args, options = {}) {
  const result = await account.signAndSendTransaction({
    receiverId: CONTRACT_ID,
    waitUntil: "FINAL",
    actions: [
      actions.functionCall(method, args, options.gas ?? GAS, options.deposit ?? 0n),
    ],
  });
  return result;
}

export function near(amount) {
  return BigInt(Math.round(amount * 1e6)) * 10n ** 18n;
}

export function fmt(yocto) {
  const value = BigInt(yocto);
  const whole = value / YOCTO;
  const frac = (value % YOCTO).toString().padStart(24, "0").slice(0, 6);
  return `${whole}.${frac}`;
}

export async function expectFailure(label, fn, needle) {
  try {
    await fn();
  } catch (error) {
    const message = String(error?.message ?? error);
    if (needle && !message.includes(needle)) {
      throw new Error(`${label}: failed with unexpected error: ${message.slice(0, 200)}`);
    }
    console.log(`  ok  ${label} rejected`);
    return;
  }
  throw new Error(`${label}: expected failure but call succeeded`);
}

export function summary(label, value) {
  console.log(`${label}: ${value}`);
}
