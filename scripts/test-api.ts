import { config } from "dotenv";
config({ path: ".env.local" });

import { Account, KeyPair, actions, type KeyPairString } from "near-api-js";
import {
  decodeNonce,
  serializeNep413,
} from "../src/server/auth/nep413";
import { provider } from "../src/server/near/client";
import { indexOnce } from "../src/server/indexing/run";

const BASE = process.env.API_BASE ?? "http://127.0.0.1:3100";

let passed = 0;
function ok(condition: unknown, message: string) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  passed += 1;
  console.log(`  ok  ${message}`);
}

async function json(path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, init);
  const body = await response.json();
  return { status: response.status, body, headers: response.headers };
}

async function main() {
  const accountId = process.env.NEAR_DEPLOYER_ID;
  const secret = process.env.NEAR_DEPLOYER_PRIVATE_KEY;
  if (!accountId || !secret) throw new Error("deployer credentials missing");
  const key = KeyPair.fromString(secret as KeyPairString);

  console.log("auth");
  const challenge = await json("/api/auth/challenge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId }),
  });
  ok(challenge.status === 200, "challenge issued");
  ok(challenge.body.message.includes("Neartropolitan"), "challenge message is signed by the app");

  const nonce = decodeNonce(challenge.body.nonce);
  const payload = {
    message: challenge.body.message,
    nonce,
    recipient: challenge.body.recipient,
  };
  const signature = key.sign(serializeNep413(payload)).signature;

  const verified = await json("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accountId,
      publicKey: key.getPublicKey().toString(),
      nonce: challenge.body.nonce,
      signature: Buffer.from(signature).toString("base64"),
    }),
  });
  ok(verified.status === 200, "signature accepted");
  const cookie = verified.headers.get("set-cookie")?.split(";")[0];
  ok(Boolean(cookie), "session cookie issued");
  if (!cookie) throw new Error("session cookie missing");

  const rejected = await json("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accountId,
      publicKey: key.getPublicKey().toString(),
      nonce: challenge.body.nonce,
      signature: Buffer.from(signature).toString("base64"),
    }),
  });
  ok(rejected.status === 400, "a used challenge cannot be replayed");

  const session = await json("/api/auth/session", { headers: { cookie } });
  ok(session.body.accountId === accountId, "session resolves to the signer");

  console.log("commands");
  const before = await json(`/api/state?accountId=${accountId}`);
  const wheatBefore = BigInt(before.body.account.wheat);
  const readyAt = Number(before.body.account.harvest_ready_at);
  if (readyAt > Date.now()) {
    const wait = readyAt - Date.now() + 1_000;
    console.log(`  ..  waiting ${Math.ceil(wait / 1000)}s for harvest cooldown`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  const command = await json("/api/commands", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "harvest" }),
  });
  ok(command.status === 200, "harvest command prepared");
  ok(command.body.call.method === "harvest", "prepared call targets harvest");
  ok(Boolean(command.body.operationId), "operation id issued");

  const unauthenticated = await json("/api/commands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "harvest" }),
  });
  ok(unauthenticated.status === 401, "commands require a session");

  console.log("submit and index");
  const call = command.body.call;
  const account = new Account(accountId, provider(), secret as KeyPairString);
  const result = await account.signAndSendTransaction({
    receiverId: call.contractId,
    waitUntil: "FINAL",
    actions: [
      actions.functionCall(
        call.method,
        call.args,
        BigInt(call.gas),
        BigInt(call.deposit),
      ),
    ],
  });
  const txHash = (result as unknown as { transaction_outcome: { id: string } })
    .transaction_outcome.id;
  ok(Boolean(txHash), "harvest submitted to testnet");

  const tracked = await json("/api/transactions", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      txHash,
      action: "harvest",
      operationId: command.body.operationId,
    }),
  });
  ok(tracked.status === 202, "transaction registered for indexing");
  ok(tracked.body.confirmed === true, "transaction confirmed inline");

  await indexOnce();
  ok(true, "indexer backstop runs without error");

  const after = await json(`/api/state?accountId=${accountId}`);
  const wheatAfter = BigInt(after.body.account.wheat);
  ok(wheatAfter === wheatBefore + 6n, "harvest credited 6 wheat through the read model");

  const history = await json(`/api/history?accountId=${accountId}`, {
    headers: { cookie },
  });
  ok(history.status === 200, "history is readable for the session account");
  ok(
    history.body.operations.some((op: { opId: string }) => op.opId === command.body.operationId),
    "operation recorded in history",
  );

  const foreign = await json(`/api/history?accountId=someone.testnet`, {
    headers: { cookie },
  });
  ok(foreign.status === 403, "history cannot be read for another account");

  console.log(`\nAPI END TO END PASS (${passed} checks)`);
  console.log(`transaction ${txHash}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
