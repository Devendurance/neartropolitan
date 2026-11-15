# Project state

- Project: neartropolitan. Backend complete, frontend not started.
- Contract: `contracts/city` (Rust, near-sdk 5.30), live at
  `city.geniusendy.testnet`. Builds to wasm with `--cfg near`.
  Methods: deposit, grant_starter, set_paused, harvest, bake, upgrade_cart,
  create_listing, cancel_listing, buy, create_order, accept_order,
  complete_order, plus views and stats.
- Money is yoctoNEAR. Goods are wheat and bread. Every mutation takes an op id
  and is idempotent.
- Database: Neon project `neartropolitan` (`snowy-rain-49497423`), region
  aws-us-east-2. Both migrations applied. Runtime uses the pooled URL.
- API: NEP-413 sign-in with single use nonces, HMAC session cookies, origin
  checks, and rate limits. Routes in `src/app/api`.
  - POST /api/auth/challenge, POST /api/auth/verify, GET/DELETE /api/auth/session
  - GET /api/state, GET /api/history
  - POST /api/commands, POST /api/transactions
- Command layer: `src/server/commands/plan.ts` validates actions against live
  contract state and returns prepared calls. The server never holds player keys.
- Indexing: pending poller for API submissions plus block scanner for wallet
  submissions. Both share a replay-safe projector.
- Worker: deterministic resident tick with database leases.
- Delivery order: both backends before either frontend. Backend gate passed.
- Platforms: Neon, GitHub, and Vercel connected. API deployed at
  `https://neartropolitan.vercel.app`. Deployment protection disabled.
- Confirmation: `/api/transactions` confirms inline, the indexer retries, and
  the block scanner is shard aware. The worker has three seeded residents.
