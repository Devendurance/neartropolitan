import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { accounts, indexerCursor } from "@/server/db/schema";
import { errorResponse } from "@/server/http/guard";
import { CommandError } from "@/server/commands/plan";
import { ACCOUNT_ID_PATTERN } from "@/server/auth/nep413";
import {
  getAccount,
  getListings,
  getOrders,
  getStats,
  nearConfig,
} from "@/server/near/client";


export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const accountId = url.searchParams.get("accountId");
    if (accountId && !ACCOUNT_ID_PATTERN.test(accountId)) {
      throw new CommandError(400, "invalid_account", "account id is not valid");
    }

    const config = nearConfig();
    const [stats, listings, orders] = await Promise.all([
      getStats(),
      getListings(64),
      getOrders(64),
    ]);

    let account = null;
    let indexed = null;
    if (accountId) {
      account = await getAccount(accountId);
      const db = getDb();
      const rows = await db
        .select()
        .from(accounts)
        .where(eq(accounts.accountId, accountId))
        .limit(1);
      indexed = rows[0] ?? null;
    }

    const cursorRows = await getDb()
      .select()
      .from(indexerCursor)
      .where(eq(indexerCursor.network, config.network))
      .limit(1);

    return NextResponse.json({
      contractId: config.contractId,
      network: config.network,
      now: Date.now(),
      stats,
      listings,
      orders,
      account,
      indexed,
      indexer: cursorRows[0] ?? null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
