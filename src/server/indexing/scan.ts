import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { indexerCursor, operations, transactions } from "../db/schema";
import { isFailure, nearConfig, provider, txStatus } from "../near/client";
import { applyEvent, parseEvents } from "./project";

type BlockResponse = {
  header: { height: number; epoch_id: string };
  chunks?: Array<{ chunk_hash: string; shard_id: number }>;
};

type ChunkResponse = {
  transactions?: Array<{
    hash: string;
    signer_id: string;
    receiver_id: string;
  }>;
};

async function latestFinalHeight(): Promise<number> {
  const block = (await provider().sendJsonRpc("block", {
    finality: "final",
  })) as BlockResponse;
  return block.header.height;
}

/**
 * Discovers transactions submitted outside the server, for example straight
 * from a wallet. The block endpoint does not include transaction lists, so
 * chunks are fetched. Any call into the contract executes in the contract's
 * shard, so the scanner learns that shard once per epoch and then reads a
 * single chunk per block instead of all ten.
 */
export async function scanBlocks(options: { maxBlocks?: number } = {}) {
  const maxBlocks = options.maxBlocks ?? 10;
  const db = getDb();
  const { contractId, network } = nearConfig();

  const cursorRows = await db
    .select()
    .from(indexerCursor)
    .where(eq(indexerCursor.network, network))
    .limit(1);

  const latest = await latestFinalHeight();
  let last = cursorRows[0]?.lastBlockHeight ?? 0;
  let contractShard = cursorRows[0]?.contractShard ?? null;
  let epochId = cursorRows[0]?.epochId ?? null;

  if (!cursorRows[0]) {
    // Start at the head instead of replaying all of testnet history.
    last = Math.max(0, latest - 1);
    await db
      .insert(indexerCursor)
      .values({ network, contractId, lastBlockHeight: last, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: indexerCursor.network,
        set: { contractId, lastBlockHeight: last, updatedAt: new Date() },
      });
  }

  const to = Math.min(latest, last + maxBlocks);
  let discovered = 0;
  let projected = 0;
  let blocks = 0;

  for (let height = last + 1; height <= to; height += 1) {
    const block = (await provider().sendJsonRpc("block", {
      block_id: height,
    })) as BlockResponse;

    if (block.header.epoch_id !== epochId) {
      // Shard assignment is stable inside an epoch only.
      epochId = block.header.epoch_id;
      contractShard = null;
    }

    const candidates = (block.chunks ?? []).filter(
      (chunk) => contractShard === null || chunk.shard_id === contractShard,
    );

    for (const chunk of candidates) {
      const detail = (await provider().sendJsonRpc("chunk", {
        chunk_id: chunk.chunk_hash,
      })) as ChunkResponse;

      for (const tx of detail.transactions ?? []) {
        if (tx.receiver_id !== contractId) continue;
        contractShard = chunk.shard_id;
        discovered += 1;

        const queued = await db
          .insert(transactions)
          .values({
            txHash: tx.hash,
            signerId: tx.signer_id,
            method: "external",
            status: "pending",
            blockHeight: height,
          })
          .onConflictDoNothing()
          .returning({ txHash: transactions.txHash });

        if (queued.length === 0) continue;

        try {
          const status = await txStatus(tx.hash, tx.signer_id);
          let eventIndex = 0;
          for (const receipt of status.receipts_outcome ?? []) {
            if (receipt.receipt?.receiver_id && receipt.receipt.receiver_id !== contractId) {
              continue;
            }
            for (const event of parseEvents(receipt.outcome.logs ?? [])) {
              await applyEvent(
                { db, txHash: tx.hash, blockHeight: height, eventIndex },
                event,
              );
              eventIndex += 1;
              projected += 1;
            }
          }
          await db
            .update(operations)
            .set({
              status: isFailure(status.status) ? "failed" : "confirmed",
              blockHeight: height,
            })
            .where(eq(operations.txHash, tx.hash));
          await db
            .update(transactions)
            .set({
              status: isFailure(status.status) ? "failed" : "confirmed",
              blockHeight: height,
              resolvedAt: new Date(),
            })
            .where(eq(transactions.txHash, tx.hash));
        } catch {
          // Leave it pending. The poller retries and owns the final status.
        }
      }
    }

    await db
      .update(indexerCursor)
      .set({
        lastBlockHeight: height,
        contractShard,
        epochId,
        updatedAt: new Date(),
      })
      .where(eq(indexerCursor.network, network));
    last = height;
    blocks += 1;
  }

  return {
    scannedTo: last,
    latest,
    blocks,
    shard: contractShard,
    transactions: discovered,
    events: projected,
  };
}
