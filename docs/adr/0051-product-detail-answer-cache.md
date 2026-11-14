# 0051. The product detail outside the Next data cache: a per-process answer cache that keeps 404s

Status: accepted 2026-11-14 (owner's request to fix the stale product page found during the blog work; independent review of `fix/storefront-stale-404`). Builds on ADR 0026 decision 2 (product pages from API answers cached for 60 seconds: the 60 s stay) and follows ADR 0040 decision 2 (the storefront's own process cache for the shared lists). No API, schema, configuration or dependency change.

## Context

- The storefront read `GET /store/products/{slug}` through the Next data cache with `revalidate: 60`. That cache stores `200` answers only: once a product was unpublished, archived or deleted, the revalidation's `404` was never stored and the old page was served indefinitely (measured on the e2e stack: still `200` 160 s after the unpublishing, while the API answered `404`).
- The blog met the same limit and reads its posts `no-store` (plan `docs/plans/2026-11-13-blog.md`). For products that would cost one API read per product view.
- A "not found" kept in the Next data cache (`unstable_cache`) would write one file per unknown slug a visitor types, and `next start` never deletes them (the reason ADR 0040 left the data cache for the lists).

## Decision

1. `getProduct` (`apps/storefront/src/lib/store-data.ts`) reads `no-store` and keeps the answer, found or `404`, in the storefront's own process cache (`apps/storefront/src/lib/fresh-answer-cache.ts`): key = locale and slug (never a header or cookie: the read sends neither), fresh for `CATALOG_REVALIDATE_SECONDS` (60 s), at most 500 answers with the least recently used dropped first, concurrent misses of one product share one read, nothing written to disk.
2. Only a `200` and a `404` are kept. A `400`, `429`, `5xx`, a timeout or a thrown read is never kept as "not found".
3. A `404` also drops the in-memory last-good copy of that read (for every read with a last-good copy), so an API outage cannot bring an unpublished product, list or category back. A stale last-good answer served during an outage is not kept.

## Consequences

- An unpublished product's page becomes a real `404` (and a republished one comes back) at most 60 s after that storefront process last read it from the API. Each process holds its own cache and obeys the same bound.
- During an API outage a product with a last-good copy is re-read on every view (up to the read timeout) instead of being served stale while revalidating in the background: slower in outages only.
- More than 500 distinct unknown slugs can push real products out of the cache; each such miss costs one API read, as an uncached read did before.
- Next tag or path revalidation no longer reaches the product detail; the storefront calls neither today.
- E2E `apps/storefront/e2e/tests/unpublished-product.e2e.ts` proves the bound on the real stack (about 2 minutes, bounded by the 60 s window).
