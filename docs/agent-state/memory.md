# Memory

- Complete both backends before either frontend.
- Keep Markdown in docs/, except root AGENTS.md and README.md.
- DESIGN.md is not created yet; establish it before UI work.
- Schema workflow: db:generate then db:migrate. Never drizzle push.

## Contract gotchas

- near-sdk 5.30 needs `--cfg near` for wasm builds. Without it the host-call
  shims fall back to local stubs, `panic_str` disappears, and every failure
  becomes a bare `unreachable` trap with no logs. Set in `.cargo/config.toml`.
- u128 struct fields are decimal strings. Parameters and returns use
  `near_sdk::json_types::U128`.
- `near_sdk::require!` takes a single message argument. Use `format!` for values.
- Do not delete the only funded testnet account. The faucet is IP rate limited
  for 12 hours.

## Web and API gotchas

- Next 16 has `cacheComponents: true` in `next.config.ts`. Route segment configs
  (`runtime`, `dynamic`, `revalidate`) are rejected. Do not add them.
- `near-api-js` 7 uses object-form `provider.callFunction({ contractId, method, args })`
  and `new Account(id, provider, secret)`. `KeyPair.sign` returns
  `{ signature, publicKey }`, not raw bytes.
- NEP-413 wire format: u32 prefix 2147484061, borsh struct
  `{message, nonce[32], recipient, callbackUrl?}`, then sha256. Verify the
  signature and also query `view_access_key` to confirm FullAccess.
- The `block` RPC omits transaction lists on testnet. Use `chunk` with
  `chunk_hash` to read transactions. Calls execute in the contract shard, so
  learn the shard once per epoch and scan one chunk per block after that.
- The Vercel team is on the Hobby plan. Cron is limited to daily, so do not
  add per-minute schedules to `vercel.json`. Player actions confirm inline.
- Project transactions immediately in `/api/transactions`, with the indexer as
  a retry backstop. Reconcile operation rows from transaction rows each pass so
  a crash between the two writes self heals.
- Neon credentials live in `~/.config/neon/credentials.vps.json`. Use the API
  key with `npx neonctl`. Runtime uses the pooled connection string.
- Vercel team: `endy-s-winning-szn`. GitHub account: `Devendurance`.

## Verification

- `npm test` runs migrations and projection against PGlite plus auth and
  command validation.
- `npm run test:api` is the end to end check. It needs the app running and the
  funded testnet account.
- `npm run test:scan` proves external transaction discovery.
