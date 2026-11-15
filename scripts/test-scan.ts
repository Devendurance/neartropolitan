import { config } from "dotenv";
config({ path: ".env.local" });

import { Account, actions, type KeyPairString } from "near-api-js";
import { eq } from "drizzle-orm";
import { getDb } from "../src/server/db/client";
import { transactions } from "../src/server/db/schema";
import { provider } from "../src/server/near/client";
import { indexerCursor } from "../src/server/db/schema";
import { scanBlocks } from "../src/server/indexing/scan";

let passed = 0;
function ok(condition: unknown, message: string) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  passed += 1;
  console.log(`  ok  ${message}`);
}

async function waitFinal(hash: string, signerId: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const status = (await provider().sendJsonRpc("tx", [hash, signerId])) as {
        final_execution_status?: string;
      };
      if (status.final_execution_status === "FINAL") return true;
    } catch {
      // not available yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

async function main() {
  const accountId = process.env.NEAR_DEPLOYER_ID;
  const secret = process.env.NEAR_DEPLOYER_PRIVATE_KEY;
  if (!accountId || !secret) throw new Error("deployer credentials missing");

  const account = new Account(accountId, provider(), secret as KeyPairString);
  const result = await account.signAndSendTransaction({
    receiverId: process.env.NEAR_ACCOUNT_ID!,
    waitUntil: "FINAL",
    actions: [
      actions.functionCall("deposit", {}, 30n * 10n ** 12n, 1_000_000_000_000_000_000_000n),
    ],
  });
  const hash = (result as unknown as { transaction_outcome: { id: string } })
    .transaction_outcome.id;
  ok(Boolean(hash), "external deposit submitted outside the API");
  ok(await waitFinal(hash, accountId), "external transaction finalized");

  const status = (await provider().sendJsonRpc("tx", [hash, accountId])) as {
    transaction_outcome: { block_hash: string };
  };
  const block = (await provider().sendJsonRpc("block", {
    block_id: status.transaction_outcome.block_hash,
  })) as { header: { height: number } };

  // Rewind the cursor so the scanner must discover this transaction itself.
  await getDb()
    .update(indexerCursor)
    .set({ lastBlockHeight: block.header.height - 1 })
    .where(eq(indexerCursor.network, "testnet"));

  const scan = await scanBlocks({ maxBlocks: 4 });
  console.log(
    `scanned to ${scan.scannedTo}, discovered ${scan.transactions}, events ${scan.events}`,
  );
  ok(scan.transactions >= 1, "block scan discovered the external transaction");

  const db = getDb();
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.txHash, hash))
    .limit(1);
  ok(rows[0]?.status === "confirmed", "external transaction projected as confirmed");
  ok(rows[0]?.signerId === accountId, "scanner recorded the signer");

  console.log(`\nBLOCK SCAN PASS (${passed} checks)`);
  console.log(`transaction ${hash}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
