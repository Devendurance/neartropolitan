import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { operations, transactions } from "../db/schema";
import { isFailure, provider, txStatus } from "../near/client";
import { applyEvent, parseEvents } from "./project";

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

export type ConfirmationResult = {
  failed: boolean;
  blockHeight: number;
  events: number;
};

/**
 * Fetches a transaction, projects every contract event it produced, and marks
 * the queued transaction and its operation final. Used inline by the API after
 * submission and by the background indexer as a backstop.
 */
export async function confirmTransaction(
  db: Db,
  txHash: string,
  signerId: string,
  contractId: string,
): Promise<ConfirmationResult> {
  const status = await txStatus(txHash, signerId);
  const blockHeight = status.transaction_outcome
    ? await blockHeightOf(status.transaction_outcome.block_hash)
    : 0;

  let eventIndex = 0;
  for (const receipt of status.receipts_outcome ?? []) {
    if (receipt.receipt?.receiver_id && receipt.receipt.receiver_id !== contractId) {
      continue;
    }
    for (const event of parseEvents(receipt.outcome.logs ?? [])) {
      await applyEvent({ db, txHash, blockHeight, eventIndex }, event);
      eventIndex += 1;
    }
  }

  const failed = isFailure(status.status);
  await db
    .update(operations)
    .set({ status: failed ? "failed" : "confirmed", blockHeight })
    .where(eq(operations.txHash, txHash));
  await db
    .update(transactions)
    .set({
      status: failed ? "failed" : "confirmed",
      blockHeight,
      resolvedAt: new Date(),
      lastError: failed ? JSON.stringify(status.status).slice(0, 500) : null,
    })
    .where(eq(transactions.txHash, txHash));

  return { failed, blockHeight, events: eventIndex };
}
