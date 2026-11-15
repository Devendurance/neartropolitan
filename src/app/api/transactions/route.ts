import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { operations, transactions } from "@/server/db/schema";
import {
  COMMAND_ACTIONS,
  CommandError,
  type CommandAction,
} from "@/server/commands/plan";
import { errorResponse, rateLimit, requireSession } from "@/server/http/guard";
import { confirmTransaction } from "@/server/indexing/confirm";
import { nearConfig } from "@/server/near/client";


const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const OPERATION_ID = /^[A-Za-z0-9:_-]{8,84}$/;

function asAction(value: unknown): CommandAction {
  if (typeof value === "string" && (COMMAND_ACTIONS as readonly string[]).includes(value)) {
    return value as CommandAction;
  }
  throw new CommandError(400, "unknown_action", "unknown action");
}

/**
 * Registers a wallet-submitted transaction so the indexer can confirm it.
 * The contract remains authoritative, this only queues confirmation.
 */
export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    rateLimit(`tx:${session.accountId}`, 30, 60_000);

    const body = (await request.json()) as {
      txHash?: unknown;
      action?: unknown;
      operationId?: unknown;
    };

    const txHash = String(body.txHash ?? "");
    if (!TX_HASH.test(txHash)) {
      throw new CommandError(400, "invalid_tx", "transaction hash is not valid");
    }

    const action = asAction(body.action);

    if (typeof body.operationId !== "string" || !OPERATION_ID.test(body.operationId)) {
      throw new CommandError(400, "invalid_operation_id", "operation id is not valid");
    }
    const operationId = body.operationId;

    const db = getDb();
    const inserted = await db
      .insert(transactions)
      .values({
        txHash,
        signerId: session.accountId,
        method: action,
        status: "pending",
      })
      .onConflictDoNothing()
      .returning({ txHash: transactions.txHash });

    if (inserted.length === 0) {
      const existing = await db
        .select()
        .from(transactions)
        .where(eq(transactions.txHash, txHash))
        .limit(1);
      if (existing[0] && existing[0].signerId !== session.accountId) {
        throw new CommandError(409, "tx_owner_mismatch", "that transaction belongs to another account");
      }
    }

    await db
      .insert(operations)
      .values({
        accountId: session.accountId,
        opId: operationId,
        kind: action,
        amount: "0",
        txHash,
        status: "pending",
      })
      .onConflictDoNothing();

    // The wallet already waited for inclusion, so confirm inline when the
    // node can see it. The indexer retries anything that is not visible yet.
    let confirmed = false;
    let failed = false;
    try {
      const result = await confirmTransaction(
        db,
        txHash,
        session.accountId,
        nearConfig().contractId,
      );
      confirmed = true;
      failed = result.failed;
    } catch {
      confirmed = false;
    }

    return NextResponse.json(
      { tracked: true, txHash, confirmed, failed },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
