# Neartropolitan

A small city economy on NEAR testnet. One player harvests wheat, sells it, buys bread ingredients, bakes, upgrades a cart, and completes delivery orders. Every balance change settles in one authoritative Rust contract.

This repository currently contains the backend: the contract, the PostgreSQL read model, the event indexer, and the resident worker. The city interface is not built yet, per the backend-first delivery rule in `AGENTS.md`.

## What is real

| Piece | Status |
| --- | --- |
| Rust contract with atomic trades | Live on testnet |
| Testnet deployment | `city.geniusendy.testnet` |
| PostgreSQL schema and migrations | Written, applied against a fresh Postgres in tests |
| Event indexer and projection | Written, replay-safe, covered by `npm run test:db` |
| Resident worker | Written, deterministic policy |
| Next.js frontend | Starter page only |

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
src/server/db         Drizzle schema, migrations, connection
src/server/near       RPC client, view calls, signed submissions
src/server/indexing   EVENT_JSON parsing and replay-safe projection
src/server/worker     Deterministic resident tick
scripts/              Deploy, contract smoke test, database test
drizzle/              Generated SQL migrations
```

The contract is authoritative. PostgreSQL is a rebuildable read model. The client never grants inventory.

Every write is submitted through the server or the worker, so each submission is recorded in `transactions` and polled to finality by the indexer. The indexer parses `EVENT_JSON` logs, writes read models idempotently, and deduplicates trades by transaction hash and event index. Block-scan discovery for transactions submitted outside the server is deferred.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in values
npm run db:generate          # after any schema change
npm run db:migrate           # applies migrations to DATABASE_URL
```

Environment variables:

| Name | Purpose |
| --- | --- |
| `NEAR_NETWORK` | `testnet` |
| `NEAR_RPC_URL` | Defaults to `https://test.rpc.fastnear.com` |
| `NEAR_ACCOUNT_ID` | Contract account |
| `NEAR_PRIVATE_KEY` | Owner key, used for starter grants and orders |
| `DATABASE_URL` | Neon pooled connection string |
| `NEAR_RESIDENT_KEYS` | JSON map of resident account id to secret key |
| `WORKER_ID` | Lease owner for the worker |

## Commands

```bash
npm run deploy:contract   # deploy wasm to NEAR_ACCOUNT_ID
npm run smoke:contract    # full economy check against testnet
npm run test:db           # migrations and projection against PGlite
npm run indexer           # poll pending transactions to finality
npm run worker -- --once  # one deterministic resident tick
npm run seed              # register residents and grant starters
npm run lint && npx tsc --noEmit && npx next build
```

## Contract build note

The wasm build requires `--cfg near`. Without it near-sdk falls back to local stubs and every panic becomes a bare `unreachable` trap with no message. This repository sets it in `.cargo/config.toml`.

```bash
cargo build --manifest-path contracts/city/Cargo.toml \
  --target wasm32-unknown-unknown --release
```

## Verification

- `npm run test:db` applies the generated migrations to a fresh Postgres and checks projection, deduplication, and replay.
- `npm run smoke:contract` exercises harvest, listing, oversell rejection, price ceiling rejection, purchase, baking, cart upgrade, order acceptance, delivery, and duplicate operation replay against testnet.
- `npm run lint`, `npx tsc --noEmit`, and `npx next build` pass.

## Status and limitations

Withdrawals are intentionally not implemented. Credit is held by the contract and there is no exit path yet, which is disclosed rather than hidden. Authentication, the HTTP command layer, and the city interface are next. The contract has not been audited. The resident worker runs as a plain process and should move to a scheduled or queued runtime before any real deployment.

See `docs/` for the PRD, technical requirements, architecture, and delivery plan.
