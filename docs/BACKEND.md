# Backend reference

## Contract interface

All mutating methods take an operation id where money or goods move. Replaying an id returns the original amount and applies nothing.

| Method | Access | Effect |
| --- | --- | --- |
| `new(owner)` | init | Sets the owner and empty state |
| `deposit()` | payable | Converts attached yoctoNEAR into caller credit |
| `grant_starter(account_id)` | owner | One time 0.05 NEAR credit and 4 wheat |
| `harvest(op_id)` | player | Adds 6 wheat, 90 second cooldown |
| `bake(quantity, op_id)` | player | Consumes 2 wheat per bread, 30 second cooldown |
| `upgrade_cart(op_id)` | player | Costs 0.025 NEAR, capacity 1 to 3 |
| `create_listing(good, quantity, unit_price, ttl_secs)` | player | Escrows goods into a listing |
| `cancel_listing(listing_id)` | seller | Returns remaining goods |
| `buy(listing_id, quantity, max_unit_price, op_id)` | player | Atomic payment and goods transfer |
| `create_order(bread_required, reward, ttl_secs)` | owner | Funds from escrow |
| `accept_order(order_id)` | player | Claims an open order before its deadline |
| `complete_order(order_id, op_id)` | assignee | Consumes bread, pays reward once |
| `set_paused(paused)` | owner | Halts economic actions |

Views: `get_account`, `get_listing`, `get_listings(offset, limit)`, `get_order`, `get_orders(offset, limit)`, `get_stats`, `get_owner`.

Amounts are decimal strings in JSON. `u128` parameters use the `U128` wrapper so JavaScript clients keep exact values.

## HTTP API

Cookie sessions are issued after a NEP-413 signature and a chain check that the signing key still has full access to the account.

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /api/auth/challenge` | none | Issues a 32 byte nonce, recipient, and message |
| `POST /api/auth/verify` | none | Verifies the signature and sets the session cookie |
| `GET /api/auth/session` | cookie | Returns the signed-in account |
| `DELETE /api/auth/session` | cookie | Clears the cookie |
| `GET /api/state` | none | Live contract state plus indexer position |
| `GET /api/history` | cookie | Confirmed trades and operations for the caller |
| `POST /api/commands` | cookie | Validates an action and returns a prepared contract call |
| `POST /api/transactions` | cookie | Queues a wallet-submitted transaction for confirmation |

### Sign-in flow

1. Client requests a challenge for its account id.
2. Wallet signs the NEP-413 payload over `message`, `nonce`, and `recipient`.
3. Server checks the nonce is unused and unexpired, verifies the ed25519 signature, then queries `view_access_key` to confirm the key has FullAccess.
4. Server marks the challenge used and sets an HMAC-signed, HttpOnly session cookie.

Challenges last five minutes and are single use. Sessions last seven days. Mutating requests without an `Origin`, or with a mismatched one, are rejected.

### Command flow

The server never holds player keys. `POST /api/commands` reads live contract state, validates the action against the same rules the contract enforces, and returns:

```json
{
  "call": {
    "contractId": "city.geniusendy.testnet",
    "method": "buy",
    "args": { "listing_id": 1, "quantity": "2", "max_unit_price": "1000", "op_id": "..." },
    "gas": "30000000000000",
    "deposit": "0"
  },
  "operationId": "...",
  "summary": "Buy 2 wheat for 2000 yocto"
}
```

The wallet signs and sends that call. The client then posts the transaction hash to `/api/transactions`, which queues it for the indexer and records the operation as pending.

Validation is advisory. The contract remains authoritative, so a stale read can never grant goods or money.

## Events

Each confirmed log line is `EVENT_JSON:` followed by:

```json
{ "standard": "city", "version": "1.0.0", "event": "trade", "data": { } }
```

Events: `deposit`, `starter`, `harvest`, `bake`, `upgrade`, `listing_created`, `listing_cancelled`, `trade`, `order_created`, `order_accepted`, `order_completed`, `paused`.

## Indexing

Two paths feed the read model:

- **Pending poller.** Every transaction registered through `/api/transactions` sits in `transactions` as pending and is polled to finality.
- **Block scanner.** Wallet transactions that skip the API are discovered by scanning finalized blocks. The block endpoint omits transaction lists, so each chunk is fetched and filtered by receiver. This runs on the same loop as the poller.

Both paths share one projector. Trades are deduplicated by `(tx hash, event index)`, and the insert guard also gates the listing decrement, so replay cannot move inventory twice. Confirmed transactions also update their operation row to confirmed with the settled amount.

## Tables

| Table | Role |
| --- | --- |
| `accounts` | Credit, goods, cart capacity per account |
| `listings` | Open and historical listings |
| `trades` | Confirmed trades, unique per transaction and event index |
| `orders` | Delivery orders and assignment |
| `operations` | Operation ids, status, and confirmed amount |
| `transactions` | Submission queue polled to finality |
| `residents` | NPC policy, price ceiling, spend limit |
| `ticks` | Worker lease and decision count |
| `auth_challenges` | Single use NEP-413 nonces |
| `indexer_cursor` | Last scanned block per network |

## Escrow accounting

Credit in circulation equals `total_deposited` plus starter grants, minus cart spend moved to escrow, minus delivery rewards paid from escrow. Cart purchases and delivery rewards both touch `escrow`, so the contract never pays a reward it cannot fund. Withdrawals are not implemented and that is disclosed.

## Deferred

Withdrawals and withdrawal recovery, a durable queue for the worker, and the city interface. The worker currently runs as a plain process with database leases.
