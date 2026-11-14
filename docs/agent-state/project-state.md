# Project state

- Project: neartropolitan. Backend-first NEAR testnet city economy.
- Contract: `contracts/city` (Rust, near-sdk 5.30). Builds to wasm with `--cfg near`.
  Methods: deposit, grant_starter, set_paused, harvest, bake, upgrade_cart,
  create_listing, cancel_listing, buy, create_order, accept_order,
  complete_order, plus views and stats.
- Money is yoctoNEAR. Goods are wheat and bread. Every mutation takes an op id
  and is idempotent.
- Read model: Drizzle schema in `src/server/db/schema.ts`, migrations in `drizzle/`.
  Tables: accounts, listings, trades, orders, operations, transactions,
  residents, ticks, indexer_cursor.
- Indexer: `src/server/indexing` polls pending transactions to finality and
  projects `EVENT_JSON` logs. Replay-safe.
- Worker: `src/server/worker` runs a deterministic resident tick with leases.
- Auth, HTTP command layer, and frontend are not implemented.
- Delivery order: both backends before either frontend (AGENTS.md).
- Platforms: Neon PostgreSQL, GitHub, Vercel. GitHub and Vercel are connected.
  Neon credentials are not available on this machine yet.
