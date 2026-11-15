# Review follow-ups (catalog and pricing reviews of 2026-10-16)

- Status: APPROVED by the owner on 2026-11-14: PRs A, B, C and E below; D deferred. Not started.
- Source: `docs/HANDOFF.md` section 2 item 8; `docs/plans/2026-10-16-catalog-review-findings.md`, `docs/plans/2026-10-16-pricing-review-findings.md`.
- Checked against `main` at 779328fe (2026-11-14). Item numbers are those of the catalog findings file ("6x" = docs drift, "7x" = surviving mutations).

## Still open on `main`

| Item | State | Evidence |
|---|---|---|
| C5 attribute-fact lock | open | attribute and product-type changes lock their own rows; product/variant attribute writes lock only the product row |
| X-Powered-By | partly | the edge proxies strip it (`edge-proxy-config.spec.ts`); the API never disables it |
| `requiredText` returns `""` | partly | `apps/api/src/catalog/store/store.serializer.ts`: falls back across locales, then `""` with a warning |
| 6b admin variant order | partly | `docs/api/catalog.md` admin row says "position"; code orders by position, sku, id |
| 6c slug locale | open | `catalog.md` says the `uk` title; code uses the default locale |
| 6d core helpers | open | `docs/files/core.md` lists `validateTree`, `promotePrimaryAfterRemoval`; the API imports neither |
| 6e, 6f, 6g ADR 0006 vs code | open | variant-RESTRICT path unreachable; admin page size 50 vs ADR 24; admin `?categoryId` direct assignments only |
| 7a SKU prefix truncation | partly | covered for product create, not for manual variant create or generation |
| 7d variant `position` | open | no test for max+1 (manual) or firstPosition+index (generated) |
| 7e store `optionValues` sort | open | fixtures always have option position = code order |
| R5 `reserved` upper bound | open | `inventory_level_reserved_check` is `reserved >= 0` only; core `MAX_RESERVED` = 1 000 000 000 |
| R11 TRUNCATE trigger | done | migration `0011` (`stock_movement_no_truncate`); HANDOFF and HISTORY still listed it as open |
| Swagger, catalog rate limits | elsewhere | the `launch-blockers` session |
| 6a `variant.title` | not now | not writable; changing it is a public contract change |

## PRs

| PR | Scope | Red zone |
|---|---|---|
| A `docs/catalog-review-drift` | 6b, 6c, 6d in `docs/`; a new ADR reconciling ADR 0006 with the code for 6e, 6f, 6g (old ADRs are not edited); stale R11 lines in HANDOFF | no |
| B `test/catalog-surviving-mutations` | tests for 7a (manual variant create and generation with long slugs), 7d, 7e; each shown to fail with the mutation | no |
| C `fix/store-required-text` | owner decision: a product (or category, brand) without a usable required text is left out of the storefront answer and an error is logged with its id only (no `""`, no `500`); plus `app.disable("x-powered-by")` in the API | no (store behaviour; documented in `docs/api/catalog.md`) |
| E `feature/reserved-upper-bound` | migration `0014`: `inventory_level_reserved_check` becomes `reserved >= 0 AND reserved <= 1000000000`, with `.down.sql` (restores `reserved >= 0`, deletes its journal row); refuses with a clear error if a row already exceeds the bound; test up, down, up, down on a `_test` database; CHANGELOG | yes, approved |
| D C5 lock | deferred by the owner | - |

C and the X-Powered-By change could be split; they are kept in one PR only if the reviewer agrees they are one concern ("store answers never carry masked data or framework banners"); otherwise two PRs.

## Verification

Each PR: `pnpm lint`, `pnpm typecheck`, `pnpm test` (real services), `pnpm check:docs`; E also `pnpm db:migrate` up/down/up/down on a `_test` database and the schema drift check.
