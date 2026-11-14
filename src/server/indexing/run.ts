import { config } from "dotenv";
config({ path: ".env.local" });

import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { transactions } from "../db/schema";
import { nearConfig, isFailure, provider, txStatus } from "../near/client";
import { applyEvent, parseEvents } from "./project";

const ONCE = process.argv.includes("--once");
const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 3000);

async function blockHeightOf(blockHash: string): Promise<number> {
  try {
    const block = (await provider().sendJsonRpc("block", {
      block_id: blockHash,
    })) as { header?: { height?: number } };
    return block.header?.height ?? 0;
  } catch {
    return 0;
  }
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
      const status = await txStatus(tx.txHash, tx.signerId);
      const blockHeight = status.transaction_outcome
        ? await blockHeightOf(status.transaction_outcome.block_hash)
        : 0;

      let eventIndex = 0;
      for (const receipt of status.receipts_outcome ?? []) {
        if (receipt.receipt?.receiver_id && receipt.receipt.receiver_id !== contractId) {
          continue;
        }
        for (const event of parseEvents(receipt.outcome.logs ?? [])) {
          await applyEvent(
            { db, txHash: tx.txHash, blockHeight, eventIndex },
            event,
          );
          applied += 1;
          eventIndex += 1;
        }
      }

      const failed = isFailure(status.status);
      await db
        .update(transactions)
        .set({
          status: failed ? "failed" : "confirmed",
          blockHeight,
          resolvedAt: new Date(),
          lastError: failed ? JSON.stringify(status.status).slice(0, 500) : null,
        })
        .where(eq(transactions.txHash, tx.txHash));
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
    const result = await indexOnce();
    console.log(
      `indexer scanned=${result.scanned} events=${result.applied} at=${new Date().toISOString()}`,
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
