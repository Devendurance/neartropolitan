import { config } from "dotenv";
config({ path: ".env.local" });

import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { transactions } from "../db/schema";
import { nearConfig } from "../near/client";
import { confirmTransaction } from "./confirm";
import { scanBlocks } from "./scan";

const ONCE = process.argv.includes("--once");
const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 3000);

/**
 * Self healing pass. If the process dies between confirming a transaction and
 * updating its operation row, this closes the gap on the next run.
 */
export async function reconcileOperations() {
  const db = getDb();
  await db.execute(sql`
    update operations o
    set status = t.status,
        block_height = t.block_height
    from transactions t
    where o.tx_hash = t.tx_hash
      and o.status = 'pending'
      and t.status in ('confirmed', 'failed')
  `);
}

export async function indexOnce() {
  const db = getDb();
  const { contractId } = nearConfig();
  const pending = await db
    .select()
    .from(transactions)
    .where(eq(transactions.status, "pending"))
    .limit(25);

  let applied = 0;

  for (const tx of pending) {
    try {
      const result = await confirmTransaction(db, tx.txHash, tx.signerId, contractId);
      applied += result.events;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const notFound = /UNKNOWN_TRANSACTION|does not exist|Not found/i.test(message);
      await db
        .update(transactions)
        .set({
          attempts: tx.attempts + 1,
          lastError: message.slice(0, 500),
          ...(notFound || tx.attempts < 60 ? {} : { status: "failed" }),
        })
        .where(eq(transactions.txHash, tx.txHash));
    }
  }

  return { scanned: pending.length, applied };
}

async function main() {
  console.log(`indexer starting (${ONCE ? "single pass" : "polling"})`);
  do {
    await reconcileOperations();
    const result = await indexOnce();
    const scan = await scanBlocks();
    console.log(
      `indexer pending=${result.scanned} projected=${result.applied} ` +
        `blocks=${scan.scannedTo}/${scan.latest} shard=${scan.shard} external=${scan.transactions} ` +
        `external_events=${scan.events} at=${new Date().toISOString()}`,
    );
    if (!ONCE) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  } while (!ONCE);
}

if (process.argv[1]?.endsWith("indexing/run.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
