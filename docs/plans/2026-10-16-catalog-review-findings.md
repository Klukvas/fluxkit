# Catalog independent review: findings (plan step 8)

Status: review done 2026-10-16 on `main` at 4c99c67 / 56e5d20. Fixed in PRs #27 (store: S3a, S4, C3), #28 (S1, S2, S3b, S8) and #29 (C1, C2, C4, S5, S6, S7) on 2026-10-16. Still open: C5 (concurrency windows around attribute facts), the information items, and the surviving mutations listed below. ADR 0007 and ADR 0008 record the two rule decisions.
Reviewers: Opus (security and data exposure), Fable (correctness, schema, tests). Authors were Sonnet and Haiku agents; the reviewers did not see the orchestrator's conclusions.
"Confirmed" = the orchestrator reproduced it or re-derived it from the code. "Reported" = reproduced by the reviewer only.

## Fix first (medium)

| # | Finding | Where | Status |
|---|---|---|---|
| S1 | Default deny is a per-controller convention: `UseGuards(AdminGuard)` lives inside `@AdminController`, there is no global guard; a plain `@Controller("admin/...")` (or a feature module, which cannot import the decorator) is open. No test walks the router. | `apps/api/src/auth/admin-controller.decorator.ts`, `auth.module.ts` | Confirmed by code; reviewer showed `POST /admin/coupons` -> 201 with a probe feature |
| S2 | Unhandled DB errors log the full failed query text; control characters from user input reach the logs (log forging). The code comment says only method and path are logged. | `apps/api/src/common/problem.filter.ts` (`describeError`) | Confirmed (log shows the SQL); params reported by reviewer |
| S3 | Cheap malformed public input answers 500 plus an error log: NUL in `/store/products/:slug`, `?brand`; a body over 100 KB on any path (also `/admin/*`, where it answers 500 instead of 401). | `store.schemas.ts` slug pattern, `problem.filter.ts` | Confirmed: 4 of 4 requests answered 500 |
| C1 | Generated slug collisions break for titles whose slug is 160 characters: the taken-set query uses the full slug as prefix, core builds `base158-2`, so the third create with the same title ends in 409. Same in products, categories, brands. | `*.service.ts` `generateSlug`, core `generateUniqueSlug` | Confirmed (core simulation) |
| C2 | `POST /admin/products/:id/options/:optionId/values` on an active product creates ACTIVE variants with empty attributes, even when the type has required variant attributes; the product can then no longer be re-published. ADR 0006 section 4 says required attributes are enforced on every write to an active product. | `variants/variant-generation.service.ts`, `product-options.service.ts` | Reported (reviewer probe), code path matches |

## Fix soon (low)

- S4 (confirmed): the store returns option values and images of deactivated variants (`options` offers a colour no variant has). Decide the rule explicitly in ADR 0006 section 10.
- S5: NUL in `barcode` answers 500 (admin). S6: lone surrogates in `logoUrl`, media `url`, `unit`, `barcode` are silently replaced with U+FFFD instead of 400. S7: a deeply nested `attributes` value overflows the stack in `JSON.stringify` (500, admin).
- S8: seed production guard is exact-match and case-sensitive on `NODE_ENV`, and the API never reads `NODE_ENV`; seeding then publishes demo products using generic attribute codes.
- C3: list index `(status, published_at DESC NULLS LAST, id DESC NULLS LAST)` does not match the store `ORDER BY` (`DESC` = NULLS FIRST), so the planner sorts (verified with EXPLAIN). Performance only.
- C4: retry loops treat every unique violation on a generated slug/SKU as a race and repeat identical work; surviving mutations show it is untested.
- C5 (reasoned only): attribute unit/level/option-code changes read "values exist" under a lock on the attribute or type row, but product/variant attribute writes do not take that lock, so a stale fact is possible.

## Information

- Swagger UI and `/docs-json` are public in production; `X-Powered-By` is sent; no rate limiting on `/store/*` (needs a dependency, red zone).
- `requiredText` in the store serializer turns a missing required title into `""` with a warning (AGENTS.md section 9).
- Docs and ADR drift: `variant.title` column is not writable and not emitted; `catalog.md` says variants are ordered by position (code: position, sku, id) and slugs come from the `uk` title (code: `DEFAULT_LOCALE`); `docs/files/core.md` lists core helpers the API does not import (`promotePrimaryAfterRemoval`, `validateTree`, ...); ADR 0006 section 5 variant-RESTRICT path is unreachable through the API; page-size default differs (ADR 24, admin 50); admin `?categoryId` ignores descendants.
- Surviving mutations (code broken, no test failed): SKU prefix truncation for slugs over 60 characters; retry on an explicit client slug; `MAX_SKU_ATTEMPTS = 1`; manual-create and generated variant `position`; sort of variant `optionValues` in the store.

## Checked and found sound (both reviewers)

- Store: internal and non-visible attributes never leave (values and definitions); draft/archived hidden; inactive variants/categories hidden; strict query parsing; allowlist serializer; fixed query count.
- Admin: all routes on `main` deny under the production authenticator; no write routes outside `/admin`; nested resources are scoped to their parent.
- Schema and migration: all ADR 0006 constraints exist and are tested by constraint name; the down migration is complete and removes its journal row.
- Core: signatures, generation, validation, lifecycle, slug and SKU rules sound.
- Injection: all SQL fragments are parameterised; no prototype pollution; no new third-party dependencies; 14 other mutations were caught.

## Not verified by the reviewers

Postgres 17 (local 16), concurrency windows beyond the lock-wait tests, load behaviour, Meilisearch (spike).
