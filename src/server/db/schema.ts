import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Read models projected from confirmed NEAR contract events. The contract is
 * authoritative. Every table here is rebuildable from confirmed history.
 */

export const accounts = pgTable(
  "accounts",
  {
    id: serial("id").primaryKey(),
    accountId: text("account_id").notNull(),
    credit: numeric("credit", { precision: 78, scale: 0 }).notNull().default("0"),
    wheat: numeric("wheat", { precision: 78, scale: 0 }).notNull().default("0"),
    bread: numeric("bread", { precision: 78, scale: 0 }).notNull().default("0"),
    cartCapacity: integer("cart_capacity").notNull().default(1),
    starterGranted: boolean("starter_granted").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("accounts_account_id_idx").on(table.accountId)],
);

export const listings = pgTable(
  "listings",
  {
    listingId: bigint("listing_id", { mode: "number" }).primaryKey(),
    seller: text("seller").notNull(),
    good: text("good").notNull(),
    quantity: numeric("quantity", { precision: 78, scale: 0 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 78, scale: 0 }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    active: boolean("active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("listings_active_idx").on(table.active, table.good)],
);

export const trades = pgTable(
  "trades",
  {
    id: serial("id").primaryKey(),
    listingId: bigint("listing_id", { mode: "number" }).notNull(),
    buyer: text("buyer").notNull(),
    seller: text("seller").notNull(),
    good: text("good").notNull(),
    quantity: numeric("quantity", { precision: 78, scale: 0 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 78, scale: 0 }).notNull(),
    total: numeric("total", { precision: 78, scale: 0 }).notNull(),
    txHash: text("tx_hash").notNull(),
    blockHeight: bigint("block_height", { mode: "number" }).notNull(),
    eventIndex: integer("event_index").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("trades_tx_event_idx").on(table.txHash, table.eventIndex),
    index("trades_buyer_idx").on(table.buyer),
    index("trades_seller_idx").on(table.seller),
  ],
);

export const orders = pgTable(
  "orders",
  {
    orderId: bigint("order_id", { mode: "number" }).primaryKey(),
    breadRequired: numeric("bread_required", { precision: 78, scale: 0 }).notNull(),
    reward: numeric("reward", { precision: 78, scale: 0 }).notNull(),
    status: text("status").notNull().default("open"),
    assignee: text("assignee"),
    deadline: bigint("deadline", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("orders_status_idx").on(table.status)],
);

export const operations = pgTable(
  "operations",
  {
    id: serial("id").primaryKey(),
    accountId: text("account_id").notNull(),
    opId: text("op_id").notNull(),
    kind: text("kind").notNull(),
    amount: numeric("amount", { precision: 78, scale: 0 }).notNull().default("0"),
    txHash: text("tx_hash").notNull(),
    status: text("status").notNull().default("pending"),
    blockHeight: bigint("block_height", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("operations_account_kind_op_idx").on(table.accountId, table.kind, table.opId),
    index("operations_tx_idx").on(table.txHash),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    txHash: text("tx_hash").primaryKey(),
    signerId: text("signer_id").notNull(),
    method: text("method").notNull(),
    status: text("status").notNull().default("pending"),
    blockHeight: bigint("block_height", { mode: "number" }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [index("receipts_status_idx").on(table.status)],
);

export const residents = pgTable("residents", {
  accountId: text("account_id").primaryKey(),
  policyVersion: integer("policy_version").notNull().default(1),
  priceCeiling: numeric("price_ceiling", { precision: 78, scale: 0 }).notNull(),
  spendLimit: numeric("spend_limit", { precision: 78, scale: 0 }).notNull(),
  good: text("good").notNull().default("bread"),
  quantity: integer("quantity").notNull().default(1),
  active: boolean("active").notNull().default(true),
});

export const ticks = pgTable(
  "ticks",
  {
    tickId: text("tick_id").primaryKey(),
    worker: text("worker").notNull(),
    status: text("status").notNull().default("running"),
    decisions: integer("decisions").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("ticks_lease_idx").on(table.status, table.leaseUntil)],
);

export const indexerCursor = pgTable("indexer_cursor", {
  network: text("network").primaryKey(),
  contractId: text("contract_id").notNull(),
  lastBlockHeight: bigint("last_block_height", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AccountRow = typeof accounts.$inferSelect;
export type ListingRow = typeof listings.$inferSelect;
export type TradeRow = typeof trades.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
