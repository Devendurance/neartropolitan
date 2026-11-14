# Neartropolitan product requirements

## Outcome

A new player completes the wheat-to-bread-to-delivery loop and understands how one decision affects the city.

## Required behavior

| ID | Requirement | Acceptance condition |
| --- | --- | --- |
| N1 | Navigate one neighborhood | Mouse, touch, and keyboard users can select buildings and open actions |
| N2 | Produce wheat | A funded production action yields inventory once after its timer |
| N3 | Trade goods | A purchase transfers payment and inventory together or neither changes |
| N4 | Produce and consume bread | Bakery consumes wheat; resident purchase consumes bread and budget |
| N5 | Deliver orders | One player accepts and completes a delivery; duplicate completion cannot pay twice |
| N6 | Upgrade capacity | Buying a cart changes delivery capacity with a visible explanation |
| N7 | Show economic consequences | A shortage changes offers according to documented rules and player supply changes the next outcome |
| N8 | Inspect settlement | Bank history links confirmed trades to transaction references and distinguishes pending actions |

## First session

Introduce a bakery wheat shortage. Give the player a clearly labeled testnet starter allocation. Guide one harvest, sale, delivery, and upgrade. Let the player repeat with a different choice. No wallet confirmation should be required for navigation.

## Economy constraints

All residents have finite funded balances. Goods have documented creation and consumption rules. NPCs cannot spend more than their available budget. No guaranteed cash returns or infinite reward emissions. The MVP models one currency and two goods, wheat and bread.

## Experience requirements

Use an isometric or top-down illustrated neighborhood with a persistent inventory and balance panel. Provide an accessible list of buildings alongside the map. Respect reduced motion. Show why a trade failed and preserve the user's inventory. Keep simulation speed and testnet status visible.

## Success criteria

Observe three new players. Target completion of the first loop within five minutes as a design goal, not a measured result. Each player should explain a price change and identify the benefit of a cart. Verify that a zero-budget resident cannot buy and that concurrent buyers cannot oversell stock.

## Deferred scope

A full open world, combat, custom cars, private bank transfers, speculative land markets, real-money launch, and complex AI dialogue are outside the first build.

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

