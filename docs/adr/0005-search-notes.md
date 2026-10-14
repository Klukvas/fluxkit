# 0005. Search notes (Meilisearch spike, plan step 6)

Status: findings recorded; two decisions open (see bottom). Evidence: `apps/api/src/spikes/search.spec.ts` (runs against a real Meilisearch).
Tested on Meilisearch v1.55.0 (official Linux binary locally; CI will use the `getmeili/meilisearch:v1.55.0` image) with client `meilisearch@0.62.0`.

## What works well
- Typo tolerance, prefix search (`футб`), Latin vs Cyrillic brand names (`stanley`), Ukrainian apostrophe variants (`м'ясо`, `мʼясо`, `мясо`) all match.
- Close inflections match through typo tolerance (`футболки`, `футболку`, `сорочку`, `рукавичок`).
- Range filters (`length 120 TO 200`), sorting by price, filters on `inStock`.

## Variant model (confirms ADR 0004 and AGENTS.md section 2.3)
- Index **one document per variant** with product-level fields copied onto it, and set `distinctAttribute: "productId"`. Filters then apply to the same variant:
  `size = M AND price < 3000` does not match a product whose M variant costs 3500 while its L variant costs 2800.
- Do NOT index a product with a nested `variants` array: filters match across different variants (the same query wrongly returns that product).

## Problems found
1. **No Ukrainian lemmatization.** Fails (zero hits) for `сорочці`, `книзі`, `ноги`/`нозі`, `рукавиці`, and adjective forms such as `зимовий` (indexed `зимові`) or `класичний чоловічий` (indexed `класична чоловіча`).
   Shoppers type such forms all the time. Russian queries (`рубашка`) find nothing without synonyms. `викрутка` and `відвертка` are different words (synonyms needed).
   Setting `localizedAttributes` with locale `ukr` did not change these results in the spike.
2. **Facet counts and variants do not combine well.**
   - With `distinctAttribute`, facet counts only see the representative variant of each product: sizes S and L (and color чорний) disappear from the facets of products that have them.
   - Without distinct, counts are per variant, not per product (inflated).
   - Product-level facets (brand) are correct with distinct because the value is identical on all variants.
   Options for variant-level facets (size, color): (a) index product-level arrays for facet display and a variant-level index for filtering, accepting approximate counts;
   (b) compute facet counts for variant attributes in Postgres per request; (c) display facet values without counts. Not decided.

## Open decisions (need the owner)
1. **Ukrainian morphology.** Candidates (none verified for license or quality yet):
   - Synonym and word-form lists managed in the admin (cheap, manual, partial coverage).
   - Our own normalization/stemming step applied to indexed text and queries (needs a library with an allowed license; not yet identified).
   - A different engine with a real Ukrainian analyzer (e.g. OpenSearch, Apache-2.0; heavier infrastructure).
   - Accept the limitation for the first release and rely on typo tolerance.
2. **Variant-level facet counts** (options above).

## Environment notes
- The Meilisearch binary was downloaded from the official GitHub release (v1.55.0, ~357 MB), checksum not verified. The official binary includes Enterprise Edition code (BUSL); we use only Community features (no sharding).
  Production and CI use the Docker image from `infra/docker-compose.yml`.
- Env vars for the spike test: `MEILI_URL`, `MEILI_MASTER_KEY` (missing values fail the test, not skip it).
