# Left off

- Current task: finish the Neartropolitan backend and verify the full economy
  on NEAR testnet.
- Done: Rust contract with atomic settlement and idempotent operations, deployed
  to `city.geniusendy.testnet`. Drizzle schema and migrations, replay-safe event
  indexer, deterministic resident worker, seed script, deploy and smoke scripts,
  README, lint, typecheck, build, and database projection tests.
- Verified: `npm run test:db` passes. `npx tsc --noEmit`, `eslint .`, and
  `next build` pass. `npm run smoke:contract` passed on testnet against
  `city.geniusendy.testnet`, including oversell rejection, price ceiling
  rejection, atomic buy, bake, cart upgrade, delivery payout, duplicate replay,
  and the credit conservation check. Transaction hashes are in the README.
- Next: provision Neon, run `db:migrate`, add the authenticated HTTP command
  layer, then start the frontend.
- Blocker: Neon `DATABASE_URL` is missing, so migrations have not run against a
  managed Postgres. The read model is verified against PGlite only.
