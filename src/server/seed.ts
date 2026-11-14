import { config } from "dotenv";
config({ path: ".env.local" });

import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { residents } from "./db/schema";
import { getStats, submit } from "./near/client";

const RESIDENTS = [
  {
    accountId: process.env.RESIDENT_A_ID ?? "",
    priceCeiling: "4000000000000000000000",
    spendLimit: "4000000000000000000000",
    good: "bread",
    quantity: 1,
  },
  {
    accountId: process.env.RESIDENT_B_ID ?? "",
    priceCeiling: "3000000000000000000000",
    spendLimit: "3000000000000000000000",
    good: "bread",
    quantity: 1,
  },
  {
    accountId: process.env.RESIDENT_C_ID ?? "",
    priceCeiling: "6000000000000000000000",
    spendLimit: "6000000000000000000000",
    good: "wheat",
    quantity: 2,
  },
].filter((resident) => resident.accountId.length > 0);

async function main() {
  const db = getDb();
  const { NEAR_PRIVATE_KEY, NEAR_ACCOUNT_ID } = process.env;

  for (const resident of RESIDENTS) {
    await db
      .insert(residents)
      .values({
        accountId: resident.accountId,
        policyVersion: 1,
        priceCeiling: resident.priceCeiling,
        spendLimit: resident.spendLimit,
        good: resident.good,
        quantity: resident.quantity,
        active: true,
      })
      .onConflictDoUpdate({
        target: residents.accountId,
        set: {
          priceCeiling: resident.priceCeiling,
          spendLimit: resident.spendLimit,
          good: resident.good,
          quantity: resident.quantity,
          active: true,
        },
      });

    if (NEAR_PRIVATE_KEY && NEAR_ACCOUNT_ID) {
      const existing = await db
        .select()
        .from(residents)
        .where(eq(residents.accountId, resident.accountId))
        .limit(1);
      if (existing[0]) {
        const result = await submit({
          signerId: NEAR_ACCOUNT_ID,
          secretKey: NEAR_PRIVATE_KEY,
          method: "grant_starter",
          args: { account_id: resident.accountId },
        });
        console.log(
          `starter ${resident.accountId} ${result.status} ${result.txHash}`,
        );
      }
    }
  }

  const stats = await getStats();
  console.log(`residents seeded ${RESIDENTS.length}`);
  console.log(`contract stats ${JSON.stringify(stats)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
