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
