import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../src/server/db/schema";
import type { Db } from "../src/server/db/client";
import { applyEvent, parseEvents, type AccountSnapshot } from "../src/server/indexing/project";

const MIGRATIONS = path.join(process.cwd(), "drizzle");

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`  ok  ${message}`);
}

const snapshot = (): AccountSnapshot => ({
  credit: "1000",
  wheat: "2",
  bread: "1",
  cart_capacity: 1,
  harvest_ready_at: 0,
  bake_ready_at: 0,
  starter_granted: true,
});

async function main() {
  const pg = new PGlite();
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  assert(files.length > 0, "migration file present");
  for (const file of files) {
    await pg.exec(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"));
  }
  assert(true, "migrations applied to a fresh Postgres");

  const db = drizzle(pg, { schema }) as unknown as Db;
  const base = {
    db,
    txHash: "tx-1",
    blockHeight: 42,
    eventIndex: 0,
    refreshAccount: async () => snapshot(),
  };

  const created = parseEvents([
    'EVENT_JSON:{"standard":"city","version":"1.0.0","event":"listing_created","data":{"listing_id":1,"seller":"alice","good":"Wheat","quantity":"6","unit_price":"1000","expires_at":9999999999999}}',
  ]);
  assert(created.length === 1, "event parser reads EVENT_JSON lines");
  await applyEvent(base, created[0]);
  const listing = await db.select().from(schema.listings);
  assert(listing[0]?.quantity === "6" && listing[0]?.active, "listing projected");

  const trade = parseEvents([
    'EVENT_JSON:{"standard":"city","version":"1.0.0","event":"trade","data":{"listing_id":1,"buyer":"bob","seller":"alice","good":"Wheat","quantity":"4","unit_price":"1000","total":"4000"}}',
  ]);
  await applyEvent(base, trade[0]);
  const afterTrade = await db.select().from(schema.listings);
  assert(afterTrade[0]?.quantity === "2", "trade decrements listing quantity");

  // Replay the same confirmed receipt and event index.
  await applyEvent(base, trade[0]);
  const trades = await db.select().from(schema.trades);
  const replayListing = await db.select().from(schema.listings);
  assert(trades.length === 1, "duplicate trade event is ignored");
  assert(replayListing[0]?.quantity === "2", "replay does not double decrement");

  const orderCreated = parseEvents([
    'EVENT_JSON:{"standard":"city","version":"1.0.0","event":"order_created","data":{"order_id":1,"bread_required":"2","reward":"500","deadline":9999999999999}}',
  ]);
  await applyEvent({ ...base, eventIndex: 1 }, orderCreated[0]);
  const openOrder = await db.select().from(schema.orders);
  assert(openOrder[0]?.status === "open", "order projected as open");

  const accepted = parseEvents([
    'EVENT_JSON:{"standard":"city","version":"1.0.0","event":"order_accepted","data":{"order_id":1,"assignee":"bob"}}',
  ]);
  await applyEvent({ ...base, eventIndex: 2 }, accepted[0]);
  const assigned = await db.select().from(schema.orders);
  assert(
    assigned[0]?.status === "assigned" && assigned[0]?.assignee === "bob",
    "order assignment projected",
  );

  const completed = parseEvents([
    'EVENT_JSON:{"standard":"city","version":"1.0.0","event":"order_completed","data":{"order_id":1,"assignee":"bob","bread":"2","reward":"500"}}',
  ]);
  await applyEvent({ ...base, eventIndex: 3 }, completed[0]);
  const done = await db.select().from(schema.orders).where(eq(schema.orders.orderId, 1));
  assert(done[0]?.status === "completed", "order completion projected");

  const accountRows = await db.select().from(schema.accounts);
  assert(accountRows.length >= 2, "account snapshots refreshed from the contract");

  console.log("\nDB PROJECTION PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
