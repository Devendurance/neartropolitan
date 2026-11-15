import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs";
import { Account, KeyPair, actions, type KeyPairString } from "near-api-js";
import { getDb } from "./db/client";
import { residents } from "./db/schema";
import { getAccount, provider, submit } from "./near/client";

type Policy = {
  label: string;
  good: "wheat" | "bread";
  quantity: number;
  priceCeiling: string;
  spendLimit: string;
};

const POLICIES: Policy[] = [
  {
    label: "resident-a",
    good: "wheat",
    quantity: 1,
    priceCeiling: "2000000000000000000000",
    spendLimit: "2000000000000000000000",
  },
  {
    label: "resident-b",
    good: "wheat",
    quantity: 2,
    priceCeiling: "1500000000000000000000",
    spendLimit: "3000000000000000000000",
  },
  {
    label: "resident-c",
    good: "bread",
    quantity: 1,
    priceCeiling: "5000000000000000000000",
    spendLimit: "5000000000000000000000",
  },
];

const ENV_PATH = ".env.local";
const MIN_BALANCE = 150_000_000_000_000_000_000_000n; // 0.15 NEAR

function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

function writeEnv(values: Record<string, string>) {
  const current = readEnv();
  Object.assign(current, values);
  fs.writeFileSync(
    ENV_PATH,
    `${Object.entries(current)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
  );
}

async function balanceOf(accountId: string): Promise<bigint> {
  try {
    const account = await provider().sendJsonRpc("query", {
      request_type: "view_account",
      finality: "final",
      account_id: accountId,
    });
    return BigInt((account as { amount: string }).amount);
  } catch {
    return 0n;
  }
}

async function main() {
  const env = readEnv();
  const deployerId = env.NEAR_DEPLOYER_ID;
  const deployerKey = env.NEAR_DEPLOYER_PRIVATE_KEY;
  if (!deployerId || !deployerKey) throw new Error("deployer credentials missing");
  const funder = new Account(deployerId, provider(), deployerKey as KeyPairString);

  const keys: Record<string, string> = env.NEAR_RESIDENT_KEYS
    ? (JSON.parse(env.NEAR_RESIDENT_KEYS) as Record<string, string>)
    : {};
  const labels: Record<string, string> = env.NEAR_RESIDENT_LABELS
    ? (JSON.parse(env.NEAR_RESIDENT_LABELS) as Record<string, string>)
    : {};

  const db = getDb();

  for (const policy of POLICIES) {
    let accountId: string;
    let secretKey: string;

    const known = labels[policy.label];
    if (known && keys[known]) {
      accountId = known;
      secretKey = keys[known];
      console.log(`${policy.label} reusing ${accountId}`);
    } else {
      const key = KeyPair.fromRandom("ed25519");
      secretKey = key.toString();
      accountId = Buffer.from(key.getPublicKey().data).toString("hex");
      keys[accountId] = secretKey;
      labels[policy.label] = accountId;
      console.log(`${policy.label} created ${accountId}`);
    }

    const balance = await balanceOf(accountId);
    if (balance < MIN_BALANCE) {
      const topUp = MIN_BALANCE - balance;
      await funder.signAndSendTransaction({
        receiverId: accountId,
        waitUntil: "FINAL",
        actions: [actions.transfer(topUp)],
      });
      console.log(`  funded ${topUp} yocto`);
    }

    const state = await getAccount(accountId);
    if (!state.starter_granted && env.NEAR_ACCOUNT_ID && env.NEAR_PRIVATE_KEY) {
      const result = await submit({
        signerId: env.NEAR_ACCOUNT_ID,
        secretKey: env.NEAR_PRIVATE_KEY,
        method: "grant_starter",
        args: { account_id: accountId },
      });
      console.log(`  starter ${result.status} ${result.txHash}`);
    }

    await db
      .insert(residents)
      .values({
        accountId,
        policyVersion: 1,
        priceCeiling: policy.priceCeiling,
        spendLimit: policy.spendLimit,
        good: policy.good,
        quantity: policy.quantity,
        active: true,
      })
      .onConflictDoUpdate({
        target: residents.accountId,
        set: {
          priceCeiling: policy.priceCeiling,
          spendLimit: policy.spendLimit,
          good: policy.good,
          quantity: policy.quantity,
          active: true,
        },
      });
  }

  writeEnv({
    NEAR_RESIDENT_KEYS: JSON.stringify(keys),
    NEAR_RESIDENT_LABELS: JSON.stringify(labels),
  });
  console.log(`\nseeded ${POLICIES.length} residents`);
  console.log("keys saved to .env.local as NEAR_RESIDENT_KEYS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
