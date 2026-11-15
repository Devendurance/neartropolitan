# Neartropolitan

A small city economy on NEAR testnet. One player harvests wheat, sells it, buys ingredients, bakes bread, upgrades a cart, and completes delivery orders. Every balance change settles in one authoritative Rust contract.

The backend is complete: contract, Neon PostgreSQL read model, NEP-413 authenticated API, event indexer, block-scan discovery, and a deterministic resident worker. The city interface is the remaining phase, per the backend-first rule in `AGENTS.md`.

## Live resources

| Resource | Value |
| --- | --- |
| Contract | `city.geniusendy.testnet` |
| Database | Neon project `neartropolitan`, `aws-us-east-2` |
| Source | https://github.com/Devendurance/neartropolitan |

## What is real

| Piece | Status |
| --- | --- |
| Rust contract with atomic trades | Live on testnet |
| NEP-413 sign-in and sessions | Implemented, verified end to end |
| Validated command API | Implemented, verified end to end |
| PostgreSQL schema and migrations | Applied to Neon |
| Event indexer and projection | Implemented, replay-safe, verified |
| Block-scan discovery | Implemented, verified against a wallet transaction |
| Resident worker | Implemented, deterministic policy |
| Next.js city interface | Not built yet |

## Economy rules

Amounts are integers. Credit is denominated in yoctoNEAR.

- Harvest yields 6 wheat with a 90 second cooldown per player.
- Baking 1 bread consumes 2 wheat with a 30 second cooldown.
- A cart costs 0.025 NEAR and raises delivery capacity from 1 to 3.
- New players receive 0.05 NEAR credit and 4 wheat once, from the contract owner.
- Listings escrow the goods. Buying debits the buyer, credits the seller, and moves the goods in the same call.
- Every mutating call takes an operation id. Replaying the same id returns the original result and changes nothing.
- Delivery orders are funded from contract escrow. Completion consumes bread and pays the reward once.

The contract rejects overselling, expired listings, purchases above the caller's price ceiling, self trades, and unaffordable orders.

## Verified on testnet

Contract `city.geniusendy.testnet`, 14 November 2026.

| Step | Transaction |
| --- | --- |
| Harvest | `FxYMsWQwQab6FJhYiVJhtGTWdY1FVehJkf3tni9cgUAk` |
| Listing | `bH237RJfWvLQWN5dixECxsrTnH1xgB4kSHoF2HVE38j` |
| Atomic buy | `2BzvhmLS7m7BMiNq9Yp9vBhamuTxPmMuswbjSqGiW7gP` |
| Bake | `AUXzw9LfgUffs7DUq5DGUEoDUxAbJA6qzWrvosNKyguh` |
| Cart upgrade | `xWDdYFdAPqXGhZ8n4LFY6ck3TitKeayNswxd5tJiMkr` |
| Order creation | `Ayt9oaZ4WLvmv8wHJkBAr7V86CeKDqWWjyRnpUQ74ZFQ` |
| Delivery | `4hpiWVKoNQCFKdioCt5prX744ABZxVr3TJ7C5qdt1FT5` |

The same run rejected an oversell and a purchase above the caller's price ceiling, paid a delivery once, and returned the original amount without a second charge when the buy and delivery operation ids were replayed.

## Architecture

```
contracts/city        Rust contract, authoritative state and EVENT_JSON logs
src/app/api           Auth, state, history, commands, transaction registration
src/server/auth       NEP-413 verification and HMAC session cookies
src/server/commands   Pure action validation and prepared contract calls
src/server/db         Drizzle schema, migrations, connection
src/server/near       RPC client, view calls, signed submissions
src/server/indexing   Pending poller, block scanner, replay-safe projection
src/server/worker     Deterministic resident tick
scripts/              Deploy, contract smoke, database, auth, API, and scan tests
drizzle/              Generated SQL migrations
```

The contract is authoritative. PostgreSQL is a rebuildable read model. The server never holds player keys.

## HTTP API

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /api/auth/challenge` | none | Issues a NEP-413 nonce and message |
| `POST /api/auth/verify` | none | Verifies the signature and sets the session cookie |
| `GET/DELETE /api/auth/session` | cookie | Reads or clears the session |
| `GET /api/state` | none | Live contract state plus indexer position |
| `GET /api/history` | cookie | Confirmed trades and operations for the caller |
| `POST /api/commands` | cookie | Validates an action and returns a prepared contract call |
| `POST /api/transactions` | cookie | Queues a wallet-submitted transaction for confirmation |

Sign-in verifies the ed25519 signature, then checks on chain that the key still has FullAccess. The server returns the exact contract call for the wallet to sign, so custody stays with the player.

Full details are in [docs/BACKEND.md](docs/BACKEND.md).

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in values
npm run db:generate          # after any schema change
npm run db:migrate           # applies migrations to DATABASE_URL_DIRECT
```

Environment variables:

| Name | Purpose |
| --- | --- |
| `NEAR_NETWORK` | `testnet` |
| `NEAR_RPC_URL` | Defaults to `https://test.rpc.fastnear.com` |
| `NEAR_ACCOUNT_ID` | Contract account |
| `NEAR_PRIVATE_KEY` | Owner key, used for starter grants and orders |
| `NEAR_DEPLOYER_ID` | Named account that creates the contract sub-account |
| `NEAR_DEPLOYER_PRIVATE_KEY` | Deployer key |
| `DATABASE_URL` | Neon pooled connection string, used at runtime |
| `DATABASE_URL_DIRECT` | Neon direct connection string, used by migrations |
| `AUTH_SECRET` | At least 32 characters, signs session cookies |
| `NEAR_AUTH_RECIPIENT` | NEP-413 recipient, defaults to `neartropolitan` |
| `NEAR_RESIDENT_KEYS` | JSON map of resident account id to secret key |
| `WORKER_ID` | Lease owner for the worker |

## Commands

```bash
npm run deploy:contract   # deploy wasm to the contract sub-account
npm run smoke:contract    # full economy check against testnet
npm run test              # database projection and command validation
npm run test:api          # end to end auth, command, indexer, history
npm run test:scan         # external transaction discovery
npm run indexer           # pending poller plus block scanner
npm run indexer:once      # a single indexing pass
npm run worker:once       # one deterministic resident tick
npm run seed              # register residents and grant starters
npm run lint && npx tsc --noEmit && npx next build
```

`test:api` expects the app on `http://127.0.0.1:3100` by default. Set `API_BASE` to override. Both integration tests use the funded testnet account in `.env.local`.

## Contract build note

The wasm build requires `--cfg near`. Without it near-sdk falls back to local stubs and every panic becomes a bare `unreachable` trap with no message. This repository sets it in `.cargo/config.toml`.

```bash
cargo build --manifest-path contracts/city/Cargo.toml \
  --target wasm32-unknown-unknown --release
```

## Status and limitations

Withdrawals are intentionally not implemented. Credit is held by the contract and there is no exit path yet, which is disclosed rather than hidden. The contract has not been audited.

The indexer and worker run as plain processes. Before a real deployment they should move to a scheduled or queued runtime with the same leases and idempotency keys. The block scanner fetches every chunk per block, so it is sized for low volume.

The city interface is next. `docs/DESIGN.md` must be established first, then the neighborhood, building actions, inventory, and bank history connect to this API without moving authoritative rules into the browser.

See `docs/` for the PRD, technical requirements, architecture, and delivery plan.
