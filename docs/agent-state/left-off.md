# Left off

- Current task: backend complete, frontend is next.
- Done: contract deployed to `city.geniusendy.testnet`, Neon provisioned with
  both migrations applied, NEP-413 auth, session cookies, validated command API,
  history and state routes, pending indexer, block scanner, and resident worker.
- Verified: `npm test` (projection, auth, 24 command checks), `npm run test:api`
  (17 checks, real testnet harvest through the read model), `npm run test:scan`
  (5 checks, external deposit discovered and projected), `npm run smoke:contract`
  (full economy on testnet). Lint, typecheck, and production build pass.
- Next: write `docs/DESIGN.md`, then build the city interface against this API.
  Create the Vercel project and set runtime environment variables.
- Blockers: none. Withdrawals and the worker runtime are deferred by design.
- Note: the API and integration tests need the funded `geniusendy.testnet` key
  in `.env.local`. Never commit it.
