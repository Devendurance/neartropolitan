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

## Events

Each confirmed log line is `EVENT_JSON:` followed by:

```json
{ "standard": "city", "version": "1.0.0", "event": "trade", "data": { } }
```

Events: `deposit`, `starter`, `harvest`, `bake`, `upgrade`, `listing_created`, `listing_cancelled`, `trade`, `order_created`, `order_accepted`, `order_completed`, `paused`.

The indexer only trusts events from the contract receipt and records each `(tx hash, event index)` once.

## Tables

| Table | Role |
| --- | --- |
| `accounts` | Credit, goods, cart capacity per account |
| `listings` | Open and historical listings |
| `trades` | Confirmed trades, unique per transaction and event index |
| `orders` | Delivery orders and assignment |
| `operations` | Operation ids with their confirmed amount |
| `transactions` | Submission queue polled to finality |
| `residents` | NPC policy, price ceiling, spend limit |
| `ticks` | Worker lease and decision count |
| `indexer_cursor` | Last projected block per contract |

## Write path

1. Server or worker signs a contract call and records it in `transactions` as pending.
2. Indexer polls `tx` until the receipt is final.
3. For a successful receipt, each `EVENT_JSON` log is applied inside one database transaction per event.
4. Account rows are refreshed from contract views, so the read model never drifts from authoritative state.
5. Failed receipts are stored with their error and never projected.

Trade rows carry a unique constraint on `(tx_hash, event_index)`. The insert guard also gates the listing decrement, which is what makes replay safe.

## Escrow accounting

Credit in circulation equals `total_deposited` plus starter grants minus cart spend moved to escrow, minus delivery rewards paid from escrow. Cart purchases and delivery rewards both touch `escrow`, so the contract never pays a reward it cannot fund. Withdrawals are not implemented and that is disclosed.

## Deferred

Authentication, the HTTP command layer, block-scan discovery for external transactions, withdrawal recovery, and the city interface.
