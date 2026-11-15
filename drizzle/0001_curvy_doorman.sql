CREATE TABLE "auth_challenges" (
	"nonce" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"recipient" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_challenges_account_idx" ON "auth_challenges" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "auth_challenges_expiry_idx" ON "auth_challenges" USING btree ("expires_at");