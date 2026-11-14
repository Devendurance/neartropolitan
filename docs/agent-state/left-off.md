# Left off

- Current task: finish the Neartropolitan backend and verify the full economy
  on NEAR testnet.
- Done: Rust contract with atomic settlement and idempotent operations, Drizzle
  schema and migrations, replay-safe event indexer, deterministic resident
  worker, seed script, deploy and smoke scripts, README, lint, typecheck, build,
  and database projection tests.
- Verified: `npm run test:db` passes. `npx tsc --noEmit`, `eslint .`, and
  `next build` pass. The contract deployed and initialized on testnet, harvest
  and listing creation confirmed on chain before the test account was deleted.
- Next: fund the testnet deployer, run `npm run deploy:contract` then
  `npm run smoke:contract`, capture transaction hashes, update the README, and
  commit.
- Blocker: the official testnet faucet IP rate limited this machine for 12 hours
  after several redeploys, and the previous funded account was deleted during a
  fresh redeploy. A replacement keypair is in `.env.local` waiting for funds.
- Neon `DATABASE_URL` is still missing, so `db:migrate` has not run against Neon.
