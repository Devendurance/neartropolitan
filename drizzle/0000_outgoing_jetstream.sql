CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"credit" numeric(78, 0) DEFAULT '0' NOT NULL,
	"wheat" numeric(78, 0) DEFAULT '0' NOT NULL,
	"bread" numeric(78, 0) DEFAULT '0' NOT NULL,
	"cart_capacity" integer DEFAULT 1 NOT NULL,
	"starter_granted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_cursor" (
	"network" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"last_block_height" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"listing_id" bigint PRIMARY KEY NOT NULL,
	"seller" text NOT NULL,
	"good" text NOT NULL,
	"quantity" numeric(78, 0) NOT NULL,
	"unit_price" numeric(78, 0) NOT NULL,
	"expires_at" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"op_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(78, 0) DEFAULT '0' NOT NULL,
	"tx_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"block_height" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"order_id" bigint PRIMARY KEY NOT NULL,
	"bread_required" numeric(78, 0) NOT NULL,
	"reward" numeric(78, 0) NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee" text,
	"deadline" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "residents" (
	"account_id" text PRIMARY KEY NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"price_ceiling" numeric(78, 0) NOT NULL,
	"spend_limit" numeric(78, 0) NOT NULL,
	"good" text DEFAULT 'bread' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticks" (
	"tick_id" text PRIMARY KEY NOT NULL,
	"worker" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"decisions" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" bigint NOT NULL,
	"buyer" text NOT NULL,
	"seller" text NOT NULL,
	"good" text NOT NULL,
	"quantity" numeric(78, 0) NOT NULL,
	"unit_price" numeric(78, 0) NOT NULL,
	"total" numeric(78, 0) NOT NULL,
	"tx_hash" text NOT NULL,
	"block_height" bigint NOT NULL,
	"event_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"tx_hash" text PRIMARY KEY NOT NULL,
	"signer_id" text NOT NULL,
	"method" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"block_height" bigint,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_account_id_idx" ON "accounts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "listings_active_idx" ON "listings" USING btree ("active","good");--> statement-breakpoint
CREATE UNIQUE INDEX "operations_account_kind_op_idx" ON "operations" USING btree ("account_id","kind","op_id");--> statement-breakpoint
CREATE INDEX "operations_tx_idx" ON "operations" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ticks_lease_idx" ON "ticks" USING btree ("status","lease_until");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_tx_event_idx" ON "trades" USING btree ("tx_hash","event_index");--> statement-breakpoint
CREATE INDEX "trades_buyer_idx" ON "trades" USING btree ("buyer");--> statement-breakpoint
CREATE INDEX "trades_seller_idx" ON "trades" USING btree ("seller");--> statement-breakpoint
CREATE INDEX "receipts_status_idx" ON "transactions" USING btree ("status");