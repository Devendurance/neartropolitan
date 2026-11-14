# Memory

- Complete both backends before either frontend.
- Keep Markdown in docs/, except root AGENTS.md and README.md.
- DESIGN.md is not created yet; establish it before UI work.
- Schema workflow: db:generate then db:migrate. Never drizzle push.

## Contract gotchas

- near-sdk 5.30 needs `--cfg near` for wasm builds. Without it the host-call
  shims fall back to local stubs, `panic_str` disappears, and every failure
  becomes a bare `unreachable` trap with no logs. Set in `.cargo/config.toml`.
- u128 struct fields are serialized as decimal strings. Method parameters and
  return values use `near_sdk::json_types::U128` so JavaScript never loses
  precision above 2^53.
- `near_sdk::require!` takes a single message argument. Use `format!` when the
  message needs values.
- Do not delete the only funded testnet account. The official faucet is IP rate
  limited (12 hours per batch), so recovery is not immediate.

## Infrastructure gotchas

- `rpc.testnet.near.org` is deprecated and returns 429. Use
  `https://test.rpc.fastnear.com`.
- `near-api-js` 7 uses `new Account(id, provider, secret)` and object-form
  `provider.callFunction({ contractId, method, args })`. `connect` and
  `keyStores` no longer exist.
- `.env.local` is gitignored. `.env.example` is force-included.
- Vercel team: `endy-s-winning-szn`. GitHub account: `Devendurance`.

## Verification

- `npm run test:db` runs migrations and projection against PGlite. It caught a
  real replay bug: deduplicating a trade row is not enough, the listing
  decrement needs the insert guard too.
- `npm run smoke:contract` is the testnet end-to-end check.
