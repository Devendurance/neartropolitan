import { config } from "dotenv";
config({ path: ".env.local" });

import { KeyPair } from "near-api-js";
import {
  createNonce,
  encodeNonce,
  serializeNep413,
  signInMessage,
  verifyNep413Signature,
} from "../src/server/auth/nep413";
import {
  createSession,
  parseSession,
  signSession,
} from "../src/server/auth/session";
import {
  planCommand,
  CommandError,
  type PlanContext,
} from "../src/server/commands/plan";
import type { ContractAccount } from "../src/server/near/client";

let passed = 0;

function ok(condition: unknown, message: string) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  passed += 1;
  console.log(`  ok  ${message}`);
}

function rejects(fn: () => unknown, code: string, message: string) {
  try {
    fn();
  } catch (error) {
    if (error instanceof CommandError && error.code === code) {
      ok(true, message);
      return;
    }
    throw error;
  }
  throw new Error(`FAILED: ${message} (no error thrown)`);
}

function authTests() {
  console.log("NEP-413");
  const key = KeyPair.fromRandom("ed25519");
  const other = KeyPair.fromRandom("ed25519");
  const nonce = createNonce();
  const payload = {
    message: signInMessage(nonce),
    nonce,
    recipient: "neartropolitan",
  };

  const digest = serializeNep413(payload);
  const signature = key.sign(digest).signature;
  ok(digest.length === 32, "payload digest is 32 bytes");
  ok(
    verifyNep413Signature({
      publicKey: key.getPublicKey().toString(),
      payload,
      signature,
    }),
    "valid signature verifies",
  );
  ok(
    !verifyNep413Signature({
      publicKey: other.getPublicKey().toString(),
      payload,
      signature,
    }),
    "wrong key is rejected",
  );
  ok(
    !verifyNep413Signature({
      publicKey: key.getPublicKey().toString(),
      payload: { ...payload, recipient: "evil.example" },
      signature,
    }),
    "changed recipient is rejected",
  );
  ok(
    !verifyNep413Signature({
      publicKey: key.getPublicKey().toString(),
      payload,
      signature: signature.slice(0, 63),
    }),
    "short signature is rejected",
  );
  ok(encodeNonce(nonce).length > 40, "nonce encodes to base64");
}

function sessionTests() {
  console.log("session");
  const session = createSession("alice.testnet", "ed25519:abc");
  const token = signSession(session);
  ok(parseSession(token)?.accountId === "alice.testnet", "session round trips");
  ok(parseSession(`${token}x`) === null, "tampered signature is rejected");
  const expired = signSession({ ...session, exp: Math.floor(Date.now() / 1000) - 10 });
  ok(parseSession(expired) === null, "expired session is rejected");
}

function context(overrides: Partial<ContractAccount> = {}): PlanContext {
  const account: ContractAccount = {
    credit: "100000000000000000000000",
    wheat: "10",
    bread: "2",
    cart_capacity: 1,
    harvest_ready_at: 0,
    bake_ready_at: 0,
    starter_granted: true,
    ...overrides,
  };
  const now = Date.now();
  return {
    accountId: "bob.testnet",
    contractId: "city.testnet",
    now,
    account,
    listings: [
      {
        id: 1,
        seller: "alice.testnet",
        good: "Wheat",
        quantity: "10",
        unit_price: "1000",
        expires_at: now + 60_000,
        active: true,
      },
      {
        id: 2,
        seller: "bob.testnet",
        good: "Wheat",
        quantity: "10",
        unit_price: "1000",
        expires_at: now + 60_000,
        active: true,
      },
    ],
    orders: [
      {
        id: 1,
        bread_required: "1",
        reward: "500",
        status: "Open",
        assignee: null,
        deadline: now + 60_000,
      },
      {
        id: 2,
        bread_required: "1",
        reward: "500",
        status: "Assigned",
        assignee: "bob.testnet",
        deadline: now + 60_000,
      },
      {
        id: 3,
        bread_required: "3",
        reward: "500",
        status: "Assigned",
        assignee: "bob.testnet",
        deadline: now + 60_000,
      },
    ],
  };
}

function commandTests() {
  console.log("commands");
  const base = context();

  const harvest = planCommand({ action: "harvest" }, base);
  ok(harvest.method === "harvest" && harvest.operationId.length >= 8, "harvest plans a call");
  rejects(
    () =>
      planCommand(
        { action: "harvest" },
        context({ harvest_ready_at: Date.now() + 60_000 }),
      ),
    "cooldown",
    "harvest cooldown is enforced",
  );

  const bake = planCommand({ action: "bake", params: { quantity: 1 } }, base);
  ok(bake.args.quantity === "1", "bake converts quantity to a string");
  rejects(
    () => planCommand({ action: "bake", params: { quantity: 50 } }, base),
    "insufficient_goods",
    "baking more wheat than held is rejected",
  );

  const list = planCommand(
    { action: "list", params: { good: "wheat", quantity: 4, unit_price: 1200 } },
    base,
  );
  ok(list.args.good === "Wheat" && list.args.quantity === "4", "listing normalizes the good");

  const buy = planCommand(
    {
      action: "buy",
      params: { listing_id: 1, quantity: 2, max_unit_price: 1000 },
    },
    base,
  );
  ok(buy.args.listing_id === 1, "buy plans the listing id");
  rejects(
    () =>
      planCommand(
        { action: "buy", params: { listing_id: 1, quantity: 2, max_unit_price: 999 } },
        base,
      ),
    "price_above_limit",
    "buy above the caller price ceiling is rejected",
  );
  rejects(
    () =>
      planCommand(
        { action: "buy", params: { listing_id: 2, quantity: 1, max_unit_price: 1000 } },
        base,
      ),
    "self_trade",
    "buying your own listing is rejected",
  );
  rejects(
    () =>
      planCommand(
        { action: "buy", params: { listing_id: 1, quantity: 99, max_unit_price: 1000 } },
        base,
      ),
    "insufficient_listing",
    "buying more than listed is rejected",
  );

  rejects(
    () => planCommand({ action: "upgrade" }, context({ cart_capacity: 3 })),
    "already_upgraded",
    "upgrading a full cart is rejected",
  );
  const upgrade = planCommand({ action: "upgrade" }, base);
  ok(upgrade.method === "upgrade_cart", "upgrade plans a cart purchase");

  const accept = planCommand({ action: "accept_order", params: { order_id: 1 } }, base);
  ok(accept.method === "accept_order", "accepting an open order is allowed");

  const complete = planCommand(
    { action: "complete_order", params: { order_id: 2 } },
    base,
  );
  ok(complete.method === "complete_order", "assignee can complete an order");
  rejects(
    () =>
      planCommand(
        { action: "complete_order", params: { order_id: 3 } },
        context({ bread: "3" }),
      ),
    "capacity_exceeded",
    "delivery above cart capacity is rejected",
  );

  const scoped = context();
  scoped.accountId = "carol.testnet";
  rejects(
    () => planCommand({ action: "complete_order", params: { order_id: 2 } }, scoped),
    "not_assignee",
    "non assignee cannot complete an order",
  );
}

authTests();
sessionTests();
commandTests();
console.log(`\nAUTH AND COMMAND PASS (${passed} checks)`);
