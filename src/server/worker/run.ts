import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { operations, residents, ticks, transactions } from "../db/schema";
import { getAccount, getListings, submit } from "../near/client";

const LEASE_MS = 60_000;
const TICK_PREFIX = process.env.WORKER_ID ?? "worker-1";

export function residentKeys(): Record<string, string> {
  const raw = process.env.NEAR_RESIDENT_KEYS;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    throw new Error("NEAR_RESIDENT_KEYS must be valid JSON");
  }
}

/**
 * Deterministic resident policy. A resident buys the cheapest affordable
 * listing of its good while staying under its per tick spend limit.
 * No LLM is involved, so a given starting state produces the same choices.
 */
export async function runTick() {
  const db = getDb();
  const keys = residentKeys();
  const tickId = `${TICK_PREFIX}:${Date.now()}`;
  const now = new Date();

  await db
    .insert(ticks)
    .values({
      tickId,
      worker: TICK_PREFIX,
      status: "running",
      leaseUntil: new Date(now.getTime() + LEASE_MS),
    })
    .onConflictDoNothing();

  const activeResidents = await db
    .select()
    .from(residents)
    .where(eq(residents.active, true));

  const listings = await getListings(100);
  let decisions = 0;

  for (const resident of activeResidents) {
    const secretKey = keys[resident.accountId];
    if (!secretKey) continue;

    try {
      const account = await getAccount(resident.accountId);
      const ceiling = BigInt(resident.priceCeiling);
      const spendLimit = BigInt(resident.spendLimit);
      const wanted = BigInt(resident.quantity);

      const candidates = listings
        .filter(
          (listing) =>
            listing.active &&
            listing.good.toLowerCase() === resident.good.toLowerCase() &&
            BigInt(listing.quantity) >= wanted &&
            BigInt(listing.unit_price) <= ceiling &&
            listing.seller !== resident.accountId &&
            listing.expires_at > Date.now(),
        )
        .sort((a, b) => (BigInt(a.unit_price) < BigInt(b.unit_price) ? -1 : 1));

      const offer = candidates[0];
      if (!offer) continue;

      const total = BigInt(offer.unit_price) * wanted;
      if (total > spendLimit) continue;
      if (BigInt(account.credit) < total) continue;

      const opId = `tick:${tickId}:${resident.accountId}`;
      const result = await submit({
        signerId: resident.accountId,
        secretKey,
        method: "buy",
        args: {
          listing_id: offer.id,
          quantity: wanted.toString(),
          max_unit_price: ceiling.toString(),
          op_id: opId,
        },
      });

      await db
        .insert(operations)
        .values({
          accountId: resident.accountId,
          opId,
          kind: "buy",
          amount: total.toString(),
          txHash: result.txHash,
          status: result.status === "success" ? "confirmed" : "failed",
          blockHeight: result.blockHeight,
        })
        .onConflictDoNothing();

      await db
        .insert(transactions)
        .values({
          txHash: result.txHash,
          signerId: resident.accountId,
          method: "buy",
          status: "pending",
          blockHeight: result.blockHeight,
        })
        .onConflictDoNothing();

      decisions += 1;
    } catch (error) {
      console.error(
        `resident ${resident.accountId} skipped: ${
          error instanceof Error ? error.message.slice(0, 200) : error
        }`,
      );
    }
  }

  await db
    .update(ticks)
    .set({ status: "finished", decisions, finishedAt: new Date() })
    .where(eq(ticks.tickId, tickId));

  await db
    .update(ticks)
    .set({ status: "expired" })
    .where(and(eq(ticks.status, "running"), lt(ticks.leaseUntil, new Date())));

  return { tickId, decisions, residents: activeResidents.length };
}

async function main() {
  const once = process.argv.includes("--once");
  do {
    const result = await runTick();
    console.log(
      `tick ${result.tickId} residents=${result.residents} decisions=${result.decisions}`,
    );
    if (!once) await new Promise((resolve) => setTimeout(resolve, 30_000));
  } while (!once);
}

if (process.argv[1]?.endsWith("worker/run.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
