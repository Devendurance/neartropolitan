# Left off

- Current task: backend complete and deployed. Frontend is next.
- Done: contract on `city.geniusendy.testnet`, Neon provisioned with three
  migrations, NEP-413 auth, session cookies, validated command API, state and
  history routes, inline transaction confirmation, pending indexer, shard-aware
  block scanner, resident worker, and three seeded residents.
- Deployed: https://neartropolitan.vercel.app on Vercel production.
  Deployment protection is disabled so the API is public.
- Verified: `npm test` (projection, auth, 24 command checks), `npm run test:api`
  against both local and production (18 checks, real testnet harvest projected
  through the read model), `npm run test:scan` (external discovery),
  `npm run smoke:contract` (full economy). Worker tick produced two confirmed
  trades and the read model matched. Lint, typecheck, and build pass.
- Next: write `docs/DESIGN.md`, then build the city interface against the API.
  Consider a Pro plan or an external scheduler for the worker and indexer.
- Blockers: none. Withdrawals, worker runtime, and the frontend are the
  remaining product work.
- Note: `.env.local` holds the funded testnet keys and resident keys. Never
  commit it. Runtime Vercel env vars exclude all private keys.
