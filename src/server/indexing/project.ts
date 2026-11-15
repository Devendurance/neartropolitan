import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, listings, operations, orders, trades } from "../db/schema";
import { getAccount } from "../near/client";

export type CityEvent = {
  event: string;
  data: Record<string, unknown>;
};

export type AccountSnapshot = Awaited<ReturnType<typeof getAccount>>;
export type RefreshAccount = (accountId: string) => Promise<AccountSnapshot>;

export type EventContext = {
  db: Db;
  txHash: string;
  blockHeight: number;
  eventIndex: number;
  refreshAccount?: RefreshAccount;
};

const PREFIX = "EVENT_JSON:";

export function parseEvents(logs: string[]): CityEvent[] {
  return logs
    .filter((line) => line.startsWith(PREFIX))
    .map((line) => {
      try {
        const parsed = JSON.parse(line.slice(PREFIX.length)) as {
          event?: string;
          data?: Record<string, unknown>;
        };
        if (!parsed.event || !parsed.data) return null;
        return { event: parsed.event, data: parsed.data };
      } catch {
        return null;
      }
    })
    .filter((event): event is CityEvent => event !== null);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function num(value: unknown): number {
  return Number(value ?? 0);
}

async function refreshAccount(
  db: Db,
  accountId: string,
  reader: RefreshAccount | undefined,
) {
  const account = await (reader ?? getAccount)(accountId);
  await db
    .insert(accounts)
    .values({
      accountId,
      credit: account.credit,
      wheat: account.wheat,
      bread: account.bread,
      cartCapacity: account.cart_capacity,
      starterGranted: account.starter_granted,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: accounts.accountId,
      set: {
        credit: account.credit,
        wheat: account.wheat,
        bread: account.bread,
        cartCapacity: account.cart_capacity,
        starterGranted: account.starter_granted,
        updatedAt: new Date(),
      },
    });
}

async function touchAccounts(
  db: Db,
  ids: Array<string | null | undefined>,
  reader: RefreshAccount | undefined,
) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  for (const id of unique) {
    await refreshAccount(db, id, reader);
  }
}

/**
 * Applies one confirmed contract event to the read model. Safe to replay:
 * trade rows are deduplicated by (tx hash, event index) and every other write
 * is an upsert keyed by the contract identifier.
 */
export async function applyEvent(context: EventContext, event: CityEvent) {
  const { db } = context;
  const data = event.data;

  switch (event.event) {
    case "trade": {
      const listingId = num(data.listing_id);
      const quantity = BigInt(text(data.quantity));
      const inserted = await db
        .insert(trades)
        .values({
          listingId,
          buyer: text(data.buyer),
          seller: text(data.seller),
          good: text(data.good),
          quantity: quantity.toString(),
          unitPrice: text(data.unit_price),
          total: text(data.total),
          txHash: context.txHash,
          blockHeight: context.blockHeight,
          eventIndex: context.eventIndex,
        })
        .onConflictDoNothing()
        .returning({ id: trades.id });

      // A replayed receipt must not decrement inventory a second time.
      if (inserted.length === 0) return;

      const listing = await db
        .select()
        .from(listings)
        .where(eq(listings.listingId, listingId))
        .limit(1);
      if (listing[0]) {
        const remaining = BigInt(listing[0].quantity) - quantity;
        await db
          .update(listings)
          .set({
            quantity: (remaining > 0n ? remaining : 0n).toString(),
            active: remaining > 0n,
            updatedAt: new Date(),
          })
          .where(eq(listings.listingId, listingId));
      }
      await touchAccounts(db, [text(data.buyer), text(data.seller)], context.refreshAccount);
      await db
        .update(operations)
        .set({ amount: text(data.total) })
        .where(and(eq(operations.txHash, context.txHash), eq(operations.kind, "buy")));
      break;
    }

    case "listing_created": {
      const listingId = num(data.listing_id);
      await db
        .insert(listings)
        .values({
          listingId,
          seller: text(data.seller),
          good: text(data.good),
          quantity: text(data.quantity),
          unitPrice: text(data.unit_price),
          expiresAt: num(data.expires_at),
          active: true,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: listings.listingId,
          set: {
            seller: text(data.seller),
            good: text(data.good),
            quantity: text(data.quantity),
            unitPrice: text(data.unit_price),
            expiresAt: num(data.expires_at),
            active: true,
            updatedAt: new Date(),
          },
        });
      await touchAccounts(db, [text(data.seller)], context.refreshAccount);
      break;
    }

    case "listing_cancelled": {
      const listingId = num(data.listing_id);
      await db
        .update(listings)
        .set({ quantity: "0", active: false, updatedAt: new Date() })
        .where(eq(listings.listingId, listingId));
      await touchAccounts(db, [text(data.seller)], context.refreshAccount);
      break;
    }

    case "order_created": {
      const orderId = num(data.order_id);
      await db
        .insert(orders)
        .values({
          orderId,
          breadRequired: text(data.bread_required),
          reward: text(data.reward),
          status: "open",
          deadline: num(data.deadline),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: orders.orderId,
          set: {
            breadRequired: text(data.bread_required),
            reward: text(data.reward),
            status: "open",
            deadline: num(data.deadline),
            updatedAt: new Date(),
          },
        });
      break;
    }

    case "order_accepted": {
      await db
        .update(orders)
        .set({ status: "assigned", assignee: text(data.assignee), updatedAt: new Date() })
        .where(eq(orders.orderId, num(data.order_id)));
      break;
    }

    case "order_completed": {
      await db
        .update(orders)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(orders.orderId, num(data.order_id)));
      await touchAccounts(db, [text(data.assignee)], context.refreshAccount);
      await db
        .update(operations)
        .set({ amount: text(data.reward) })
        .where(
          and(
            eq(operations.txHash, context.txHash),
            eq(operations.kind, "complete_order"),
          ),
        );
      break;
    }

    case "harvest": {
      await touchAccounts(db, [text(data.account)], context.refreshAccount);
      await db
        .update(operations)
        .set({ amount: text(data.wheat) })
        .where(and(eq(operations.txHash, context.txHash), eq(operations.kind, "harvest")));
      break;
    }

    case "bake": {
      await touchAccounts(db, [text(data.account)], context.refreshAccount);
      await db
        .update(operations)
        .set({ amount: text(data.bread) })
        .where(and(eq(operations.txHash, context.txHash), eq(operations.kind, "bake")));
      break;
    }

    case "upgrade": {
      await touchAccounts(db, [text(data.account)], context.refreshAccount);
      await db
        .update(operations)
        .set({ amount: text(data.cart_capacity) })
        .where(and(eq(operations.txHash, context.txHash), eq(operations.kind, "upgrade")));
      break;
    }

    case "deposit":
    case "starter": {
      await touchAccounts(db, [text(data.account)], context.refreshAccount);
      break;
    }

    default:
      break;
  }
}

export async function accountSpendSince(db: Db, accountId: string, since: Date) {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${trades.total}), 0)` })
    .from(trades)
    .where(and(eq(trades.buyer, accountId), sql`${trades.createdAt} >= ${since}`));
  return BigInt(rows[0]?.total ?? "0");
}
