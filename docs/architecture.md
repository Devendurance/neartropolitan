# Neartropolitan architecture

## Components and ownership

The city client displays buildings and immediate navigation feedback. The application server authenticates players and exposes read models. The NEAR contract owns game balances, inventory, listings, and settled upgrades. An NPC worker submits bounded economic actions. An indexer projects confirmed contract events into PostgreSQL. The database also stores off-chain delivery reservations and presentation metadata.

Client optimism may animate an action but cannot grant spendable inventory or confirmed money. Confirmed contract state takes precedence over the read model.

## Proposed module map

- src/features/city: map, buildings, and accessible navigation.
- src/features/economy: inventory, offers, and trade feedback.
- src/features/bank: balance and settlement history.
- src/server/game: authenticated commands and delivery rules.
- src/server/indexing: event projection and receipt status.
- src/domain/economy: recipe and policy definitions.
- contracts/city: authoritative settlement and inventory.
- workers/residents: deterministic resident decisions.

This is a target structure, not a description of implemented modules.

## Trade flow

The player selects an offer. The client requests a wallet-approved contract call with its price and quantity limits. The contract checks balance, inventory, listing expiry, and operation identity. It applies payment and ownership changes together. The indexer observes confirmation and refreshes the UI. A timeout remains pending until the receipt resolves.

## Simulation design

A resident tick derives needs from committed state, chooses an affordable offer, and submits a transaction. A failed transaction consumes no simulated goods. Budget exhaustion pauses purchases. Published policy parameters make the same starting state reproducible for the demo.

## Design decisions

Keep deterministic economics separate from animation. Use internal contract inventory for the first version instead of adding NFT standards to every wheat unit. Choose NEP token interoperability later when an external ownership use case justifies it. A map of buildings is a presentation layer; the economy must also work through a plain action interface.

## Failure recovery

Deduplicate events by network, receipt, and event index. Rebuild read models from confirmed history. Lease worker ticks to avoid duplicate NPC actions. Disable affected economic actions if indexing falls behind and show the last confirmed state. Retain simulation seeds and funded-budget records for reproducible demos.

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

