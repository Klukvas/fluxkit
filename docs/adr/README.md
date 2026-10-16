# Architecture Decision Records

`NNNN-title.md`: Context, Decision, Consequences, Status (proposed/accepted/superseded). Never edit accepted ADRs; supersede them.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-own-core.md) | Build our own core | accepted |
| [0002](0002-tech-stack.md) | Technology stack | accepted (versions and tooling fixed at scaffolding) |
| [0003](0003-tooling.md) | Tooling | accepted (versions fixed at scaffolding) |
| [0004](0004-core-data-model.md) | Core data model | accepted (decisions); entity list is a draft, refined by ADR 0006 for the catalog |
| [0005](0005-search-notes.md) | Search notes (Meilisearch spike) | findings recorded; two decisions open (Ukrainian morphology, variant-level facet counts) |
| [0006](0006-catalog-schema.md) | Catalog schema | accepted (2026-10-15); refines the catalog part of ADR 0004 |
| [0007](0007-store-hides-unsellable-option-values.md) | The store hides option values and images that no active variant can sell | accepted (2026-10-16); adds a rule to ADR 0006 section 10 |
| [0008](0008-generated-variants-of-live-products.md) | Generated variants of live products | accepted (2026-10-16); extends ADR 0006 sections 4 and 6 |
| [0009](0009-admin-auth.md) | Admin authentication and roles | accepted (2026-10-16, owner decisions) |
| [0010](0010-admin-lockout-and-recovery.md) | Admin lockout, recovery and the limits of the session design | accepted (2026-10-16, owner decision); extends ADR 0009 |
| [0011](0011-money-and-stock-model.md) | Money and stock model | accepted (2026-10-16, owner decisions); refines the money and inventory parts of ADR 0004 |
| [0012](0012-pricing-inventory-schema.md) | Pricing and inventory schema: journal deletion, SET NULL and cascades | accepted (2026-10-16); implements the data part of ADR 0011 |
| [0013](0013-variants-with-stock-history-are-not-deleted.md) | Variants with stock history are not deleted | accepted (2026-10-16); adds one condition to the delete rule of ADR 0006 sections 3 and 5, supersedes an assumption of ADR 0012 |
| [0014](0014-option-changes-keep-stock-history.md) | Option changes keep stock history | accepted (2026-10-16); adds one condition to the option-change rule of ADR 0006, supersedes the follow-up paragraph of ADR 0013 |
