# 0001. Build our own core

Status: accepted

## Context
We sell a white-label e-commerce template plus a team that customizes design and features per client.
Considered: Saleor (BSD-3, Python/GraphQL), Medusa (MIT, TS), Vendure (GPLv3, rejected by license allowlist), own core.
Checked in docs: Saleor has typed attributes and ProductType out of the box; Medusa has options only, attributes would be custom;
neither has ready Ukrainian payment/shipping plugins; neither provides faceted filters with counts (needs a search index either way).

## Decision
Build our own core on TypeScript. Reasons: full control of the data model (Product/Variant, data-driven attributes), no dependency on
an external roadmap or license, a single admin/storefront design system, modules and feature flags designed for our removal/CI rules.

## Consequences
- We own cart, orders, pricing, inventory, payments abstraction. High-risk areas: money logic is TDD (AGENTS.md section 13).
- Slower first release than adopting an engine. Mitigate with a small core scope and strong module boundaries.
- We must maintain security, upgrades, and docs ourselves.
- Revisit if: time to first sellable version exceeds plan, or money-logic defects keep appearing despite TDD.
