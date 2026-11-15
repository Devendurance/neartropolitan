import { NextResponse } from "next/server";
import { desc, eq, or } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { operations, trades } from "@/server/db/schema";
import { errorResponse, requireSession } from "@/server/http/guard";
import { CommandError } from "@/server/commands/plan";


export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const url = new URL(request.url);
    const accountId = url.searchParams.get("accountId") ?? session.accountId;

    if (accountId !== session.accountId) {
      throw new CommandError(403, "forbidden", "you can only read your own history");
    }

    const db = getDb();
    const [tradeRows, operationRows] = await Promise.all([
      db
        .select()
        .from(trades)
        .where(or(eq(trades.buyer, accountId), eq(trades.seller, accountId)))
        .orderBy(desc(trades.createdAt))
        .limit(50),
      db
        .select()
        .from(operations)
        .where(eq(operations.accountId, accountId))
        .orderBy(desc(operations.createdAt))
        .limit(50),
    ]);

    return NextResponse.json({
      accountId,
      trades: tradeRows,
      operations: operationRows,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
