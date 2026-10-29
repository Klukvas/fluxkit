# Architecture Decision Records

`NNNN-title.md`: Context, Decision, Consequences, Status (proposed/accepted/superseded). Never edit accepted ADRs; supersede them.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-own-core.md) | Build our own core | accepted |
| [0002](0002-tech-stack.md) | Technology stack | accepted (versions and tooling fixed at scaffolding) |
| [0003](0003-tooling.md) | Tooling | accepted (versions fixed at scaffolding) |
| [0004](0004-core-data-model.md) | Core data model | accepted (decisions); entity list is a draft, refined by ADR 0006 for the catalog |
| [0005](0005-search-notes.md) | Search notes (Meilisearch spike) | findings recorded; its two open decisions (Ukrainian morphology, variant-level facet counts) are resolved by [ADR 0034](0034-catalog-search.md) |
| [0006](0006-catalog-schema.md) | Catalog schema | accepted (2026-10-15); refines the catalog part of ADR 0004 |
| [0007](0007-store-hides-unsellable-option-values.md) | The store hides option values and images that no active variant can sell | accepted (2026-10-16); adds a rule to ADR 0006 section 10 |
| [0008](0008-generated-variants-of-live-products.md) | Generated variants of live products | accepted (2026-10-16); extends ADR 0006 sections 4 and 6 |
| [0009](0009-admin-auth.md) | Admin authentication and roles | accepted (2026-10-16, owner decisions) |
| [0010](0010-admin-lockout-and-recovery.md) | Admin lockout, recovery and the limits of the session design | accepted (2026-10-16, owner decision); extends ADR 0009 |
| [0011](0011-money-and-stock-model.md) | Money and stock model | accepted (2026-10-16, owner decisions); refines the money and inventory parts of ADR 0004 |
| [0012](0012-pricing-inventory-schema.md) | Pricing and inventory schema: journal deletion, SET NULL and cascades | accepted (2026-10-16); implements the data part of ADR 0011 |
| [0013](0013-variants-with-stock-history-are-not-deleted.md) | Variants with stock history are not deleted | accepted (2026-10-16); adds one condition to the delete rule of ADR 0006 sections 3 and 5, supersedes an assumption of ADR 0012 |
| [0014](0014-option-changes-keep-stock-history.md) | Option changes keep stock history | accepted (2026-10-16); adds one condition to the option-change rule of ADR 0006, supersedes the follow-up paragraph of ADR 0013 |
| [0015](0015-cart-and-checkout.md) | Cart and checkout | accepted (2026-10-17, owner decisions and quiz); refines the cart and checkout parts of ADR 0004 |
| [0016](0016-customer-accounts-and-sessions.md) | Customer accounts and sessions | accepted (2026-10-17, owner decisions and quiz); reuses ADR 0009 and 0010 for a second principal |
| [0017](0017-orders.md) | Orders | accepted (2026-10-17, owner decisions and quiz); refines ADR 0004 decision 4 (one explicit status until the payment plan) |
| [0018](0018-scheduler-domain-events-and-ports.md) | Scheduler, domain events and ports | accepted (2026-10-17, owner quiz); extends ADR 0002 and 0011 |
| [0019](0019-orders-schema.md) | Orders schema: foreign key actions, immutability triggers and known gaps | accepted (2026-10-17); implements the data part of ADR 0015 to 0018, follows ADR 0012 |
| [0020](0020-variants-with-order-lines-are-not-deleted.md) | Variants with order lines are not deleted | accepted (2026-10-17); extends the delete rule of ADR 0013 and the option-change rule of ADR 0014, closes the known gap of ADR 0019 |
| [0021](0021-scheduler-jobs-lock-retry-and-handler-completion.md) | Scheduler jobs: lock, retry and handler completion | accepted (2026-10-17, plan step 5c); fills in what ADR 0018 left open, changes nothing in it |
| [0022](0022-paid-order-cancel-releases-unsold-reservations.md) | Cancelling a paid order releases unsold reservations | accepted (2026-10-17); refines the stock effect "none" of `paid -> cancelled` in ADR 0017 |
| [0023](0023-deterministic-guest-order-tokens.md) | Deterministic guest order tokens | accepted (2026-10-18, owner decision); supersedes in part the random, rotating guest token of ADR 0017  |
| [0024](0024-open-order-limit-and-trusted-proxy.md) | Open-order limit per email and customer, and trusted proxy hops | accepted (2026-10-18, owner decision); extends the checkout lock order of ADR 0015 and the rate limits of ADR 0016 |
| [0025](0025-outbox-claim-lease-and-bounded-jobs.md) | Outbox dispatcher: claim, lease and bounded scheduler jobs | accepted (2026-10-18, review fixes PR C); supersedes in part ADR 0021 (event delivery locks, attempt counting), refines ADR 0004 decision 4 for snapshot texts |
| [0026](0026-storefront-architecture.md) | Storefront architecture: one origin, rendering split and the typed client | accepted (2026-10-18, owner approval of the storefront plan); builds on ADR 0015, 0016, 0023 and 0024, changes none of them |
| [0027](0027-admin-ui-architecture.md) | Admin UI architecture: static SPA under `/admin-ui/` on the storefront origin | accepted (2026-10-19, owner approval of the admin UI plan); builds on ADR 0002, 0009, 0010 and 0026, changes none of them |
| [0028](0028-media-upload-and-storage.md) | Media upload and storage | accepted (2026-10-23, owner's quiz answers on the media upload plan); builds on ADR 0004, 0006, 0007, 0009, 0018, 0025, 0026 and 0027, changes none of them |
| [0029](0029-shipping.md) | Shipping | accepted (2026-10-24, owner's quiz answers on the shipping plan); builds on ADR 0004, 0015, 0017, 0018, 0019, 0025 and 0028, refines one sentence of ADR 0018 (the shipping adjustment comes from core rules, not a plugin) |
| [0030](0030-nova-post-api.md) | Nova Post API for the first carrier plugin | accepted (2026-10-25, owner decision); supersedes in part ADR 0029 (decision 11 and the Nova Poshta specific parts of decisions 7 and 8) |
| [0031](0031-transactional-email.md) | Transactional email | accepted (2026-10-26, owner's quiz answers on the email plan); builds on ADR 0016, 0018, 0023, 0025, 0028 and 0029, changes none of them |
| [0032](0032-online-payments.md) | Online payments | accepted (2026-10-26, owner's quiz answers on the payments plan); builds on ADR 0015, 0017, 0018, 0019, 0025, 0029 and 0031, refines ADR 0004 decision 4, ADR 0017 (one status kept next to a `payment` entity) and one sentence of ADR 0018 (payment routes and `markPaid` in the core payments module) |
| [0033](0033-personal-data.md) | Personal data: inventory, export, erasure, retention and audit | accepted (2026-10-29, owner's standing instruction to take the recommended options on the privacy plan); builds on ADR 0009, 0016, 0017, 0018, 0019, 0023 and 0031, changes none of them |
| [0034](0034-catalog-search.md) | Catalog search | accepted (2026-10-29, owner's standing instruction on the search plan); resolves the two open decisions of ADR 0005, refines ADR 0004 decision 4 for search (a coalescing queue table instead of the event outbox), builds on ADR 0002, 0006, 0007, 0011, 0012, 0018, 0021, 0025, 0026, 0027 and 0031; two items marked CONFIRM (the morphology acceptance, the vendored Snowball code) |
| [0035](0035-privacy-subject-scope.md) | Privacy subject scope: what an export or an erasure reaches | accepted (2026-10-29, privacy review F1 to F3); supersedes in part ADR 0033 decision 6 (the orders and mail rows of a subject) |
| [0036](0036-search-engine-requests.md) | Catalog search: engine requests per search, live facets and engine refusals | accepted (2026-10-29, search review F1, F3 and F4); supersedes in part ADR 0034 decisions 3 (one multi-search per page), 4 (facets of the settings), 8 (synonym terms of at most 3 words), 10 (the `search` window) |
| [0037](0037-search-partial-last-word.md) | Catalog search: a partial last word on the results page | accepted (2026-10-29, storefront e2e finding); supersedes in part ADR 0034 decision 3 (the retry: now also for one word, with the last word prefix-matched), adds to ADR 0036 decision 3 (cost of one word that finds nothing) |
| [0038](0038-storefront-client-address-forwarding.md) | The storefront forwards the client address only when the operator switches it on | accepted (2026-10-29, search UI review F1 and F2); refines ADR 0024 (trusted proxy hops) and ADR 0036 decision 3 |
| [0039](0039-catalog-pages-through-search.md) | Catalog and category pages through search, with the SQL fallback | accepted (2026-10-29, search plan step 10a, rest); builds on ADR 0034, 0036 and 0038, changes none of them |
| [0040](0040-shared-catalog-lists.md) | Catalog pages through search: the shared lists and their misses | accepted (2026-10-29, search finish review F1); supersedes in part ADR 0039 decision 5 (the unfiltered list in the Next data cache) |
