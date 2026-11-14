# Neartropolitan technical requirements

## Proposed stack

Use the existing Next.js and TypeScript app with Tailwind and Lucide. Use GSAP for interface and map transitions with reduced-motion alternatives. Lenis is optional for editorial pages, not the game viewport. Begin with a DOM or SVG neighborhood; select a dedicated game renderer only if measured performance requires it.

Use a Rust NEAR contract for inventory and atomic market settlement, a server worker for NPC decisions, and Neon PostgreSQL for indexed read models and delivery metadata. Neon is selected for the database. Contract tooling and wallet integration remain to be selected and configured. Read installed Next.js documentation before implementation.

## Domain model

Account owns currency and inventory. Building has an owner and production capacity. Recipe specifies consumed and produced goods. Listing specifies seller, good, quantity, price, and expiry. ResidentPolicy specifies needs, price ceiling, and spend limit. Delivery has order, assignee, deadline, and completion state. Upgrade specifies cost and capacity change.

Amounts use integer units. Asset quantities are nonnegative. Each command has an operation identifier. Contract receipt references are retained by the read model.

## Settlement design

For the prototype, use one contract-managed testnet game balance funded through deposits and internal inventory entries. A buy command atomically debits buyer credit, credits seller credit, and transfers goods in the same contract call. This avoids pretending that arbitrary cross-contract transfers are atomic.

Track total internal credit against deposited funds. Withdrawals use an explicit pending state and callback recovery; do not implement them casually as a balance subtraction followed by an unchecked external call. Escrow mechanics and custody limits must be disclosed. Production funds require further review.

## Production and NPC rules

Recipes consume inputs when production starts. Server wall-clock time and contract timestamps, not browser timers, determine eligibility. Each harvest can complete once. NPC decisions use deterministic budget and price rules initially. An LLM is optional flavor, never the authority for balances or arbitrary contract calls.

NPC accounts use limited funded balances and restricted signing authority where supported. Record policy version, decision inputs, and transaction outcome. One worker owns each simulation tick through a durable lease and unique tick identifier.

## Delivery constraints

The first delivery is an in-game action with server-validated route and timing, not proof of physical delivery. Reserve orders atomically. Expired reservations become available again. A completion identifier can be paid once. Do not use browser position alone as trusted evidence.

## Verification targets

Verify conservation of money, inventory creation and destruction rules, zero-budget behavior, double harvest, duplicate delivery, overselling, stale prices, failed receipts, worker restart, and stale read models. Validate contract logic before real-value use. Testnet and simulated events must be labeled separately.

## Status and evidence

Planning draft, 14 November 2026. The repository contains a Next.js starter and installed UI libraries. Product workflows, contracts, storage, authentication, and provider integrations are proposed, not implemented. No user interviews or competitor implementation audits have been completed.

The event website lists a 14 November 2026, 23:59 UTC deadline. Reconfirm eligibility before submission. The plan uses delivery gates rather than promising a schedule. Two independent entries are allowed if each README names the other.

Sources checked during planning:

- [Official tracks, submission requirements, and FAQ](https://nearhackathon.com/)
- [NEAR developer documentation](https://docs.near.org/)

See [Product idea](product%20idea.md), [PRD](PRD.md), [TRD](TRD.md), [Architecture](architecture.md), [Project plan](project%20plan.md), and [Messaging](messaging.md).

## Delivery order and platform decisions

Backend delivery comes first for both projects. Frontend implementation starts only after both backends pass their completion gates. Existing UI packages remain installed for that later phase.

Use Neon PostgreSQL for application data, GitHub for source control and CI, and Vercel for the Next.js application and request handlers. The user reports these services are connected on this machine. Project identifiers, repositories, database branches, credentials, and deployments have not been inspected or provisioned by this documentation change.

Keep each product's database and deployment configuration isolated. Use separate development, preview, and production configuration. Store secrets through platform environment settings, never in Markdown or Git. Select database access and migration tooling during backend setup. Any schema change must follow AGENTS.md: run db:generate and then db:migrate, never drizzle push. Define those scripts before the first schema change.

Durable background processing remains a deployment decision. Do not assume a long-running process can run inside a request handler. Choose a supported scheduled or queued execution model, with bounded jobs, persistent retries, idempotency, and leases where required. Vercel serves the web application; NEAR contracts deploy to NEAR independently.

