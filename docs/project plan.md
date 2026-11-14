# Neartropolitan project plan

## Phase 1: Establish backend infrastructure

- Identify the connected GitHub, Neon, and Vercel projects and create or select isolated resources.
- Configure source control, CI, environment settings, database access, and migration scripts.
- Define API commands, authentication, read models, and the NEAR contract deployment workflow.

## Phase 2: Implement and verify the economy

- Define recipes, inventory, finite budgets, price rules, production timers, and upgrade effects.
- Run a deterministic headless simulation of shortage, replenishment, and consumption.
- Implement testnet balances, atomic trades, and authoritative inventory in the NEAR contract.
- Verify conservation, overselling, duplicate operations, insufficient funds, and withdrawal recovery if withdrawals are included.

## Phase 3: Complete the backend

- Implement receipt indexing, resident execution, delivery reservations, completion validation, and payouts.
- Persist worker progress, deduplicate events, and recover from failed transactions and restarts.
- Exercise the full production-to-delivery loop using API clients and test wallets.
- Publish API contracts, deployment identifiers, seed procedure, and observed test results.

Backend exit gate: a reproducible headless game loop with actual testnet settlement, finite NPC budgets, atomic ownership changes, failure recovery, and passing lint, type checks, build, and relevant backend and contract tests.

## Phase 4: Build the frontend after both backends are complete

- Establish docs/DESIGN.md before creating the city interface.
- Build the neighborhood, building actions, inventory, bank history, and accessible navigation.
- Connect presentation to the completed backend without moving authoritative economy rules into the browser.
- Playtest the first session and demonstrate why shortages, resident purchases, and upgrades occur.

## Phase 5: Package the product

- Record a truthful demo with visible testnet labels and transaction references.
- Reconfirm event eligibility and submission timing before publishing an entry.
- Name the independent Harpex entry in the README if submitting both.

Extra neighborhoods, AI dialogue, private transfers, and speculative assets remain deferred.

## Delivery order and platform decisions

Backend delivery comes first for both projects. Frontend implementation starts only after both backends pass their completion gates. Existing UI packages remain installed for that later phase.

Use Neon PostgreSQL for application data, GitHub for source control and CI, and Vercel for the Next.js application and request handlers. The user reports these services are connected on this machine. Project identifiers, repositories, database branches, credentials, and deployments have not been inspected or provisioned by this documentation change.

Keep each product's database and deployment configuration isolated. Use separate development, preview, and production configuration. Store secrets through platform environment settings, never in Markdown or Git. Select database access and migration tooling during backend setup. Any schema change must follow AGENTS.md: run db:generate and then db:migrate, never drizzle push. Define those scripts before the first schema change.

Durable background processing remains a deployment decision. Do not assume a long-running process can run inside a request handler. Choose a supported scheduled or queued execution model, with bounded jobs, persistent retries, idempotency, and leases where required. Vercel serves the web application; NEAR contracts deploy to NEAR independently.

