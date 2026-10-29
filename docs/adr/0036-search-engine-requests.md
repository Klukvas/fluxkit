# 0036. Catalog search: engine requests per search, live facets and engine refusals

Status: accepted 2026-10-29 (fix of the search review `docs/plans/2026-10-29-search-review.md`, findings F1, F3 and F4; PR #182 must not merge without F1). Supersedes in part ADR 0034 decision 3 (the sentence "One federated multi-search" for a results page), decision 4 (the facets are "all filterable fields of the settings"), decision 8 (synonym terms) and decision 10 (the `search` window); ADR 0034 itself is not edited. No schema change, no migration, no dependency, no environment variable.

## Context

- ADR 0034 decisions 3 and 4 and plan section 6 describe one `POST /multi-search` per results page. The implementation sent one federation per planned query (hits, variant facets, price range, one per selected facet group) in parallel, and the whole set again for the relaxed pass: up to 20 engine requests for one store request (review F3, measured with a spy).
- Engine facts (Meilisearch v1.55.0, probed 2026-10-29 with the master key on a scratch index): a request carries at most ONE `federation` (`federations` is `400 bad_request`); the facets of a federation count the union of the matches of ALL its queries (two queries with different filters gave the counts of both). A federation cannot hold the differently filtered facet queries of one page; a non-federated multi-search can (S1, E6), but then each text query is counted on its own, not as a union.
- Meilisearch applies multi-word synonyms of at most three words; a longer term was stored and silently ignored (review F4).
- The store asked the engine for every facet the CURRENT definitions derive, while the live index gets new `filterableAttributes` only when job 13 runs. A new option of a type, a flipped `isFilterable` or a new filterable attribute made the engine refuse every results page (`400 invalid_search_facets`) and the store answered `503 search_unavailable` until job 13 ran (review F1).

## Decision

1. **Engine requests per pass.** With at most one text query (browsing without `q`, or words whose Snowball stems and five-letter prefixes read exactly like the words) every planned query of the page goes in ONE non-federated `POST /multi-search`: one engine request per pass, two with the relaxed pass. With two or three text queries (most Ukrainian words) each planned query stays a federation of the text queries, because only a federation counts the union exactly; one request per planned query, in parallel.
2. **One query fewer.** Without a price selection the price range (`facetStats.price`) comes from the variant-facet query (same filter); a separate price-range query is sent only when a price is selected.
3. **Measured cost** (`store-search.spec.ts` "costs one engine request per pass", spy on the engine client): browse 1, browse with 8 selected groups 1, one text query 1, one text query with 8 groups and the relaxed pass 2, Ukrainian text 2, Ukrainian text with 8 groups (7 non-price) and the relaxed pass 20. The live index's filterable fields add one `settings.get` per index and 30 s.
4. **Rate limit.** The `search` window is 60 a minute per client address (was 120; `searchSuggest` stays 120): at most 1 200 engine requests a minute per address in the worst case above, 60 for browsing and English text. The group cap stays 8.
5. **Live facets.** The facets a request may select and the engine is asked to count are the derived facet specs whose field the LIVE index has in `filterableAttributes` (core `liveFacetSpecs`; read once per index and 30 s). Until job 13 applies a definition change the new key is `unknown_facet_key` and every other search answers as before.
6. **Engine refusals.** An engine `400` (`engine_rejected`) is not an outage: the store answers `500 internal_error`, logs an error with the engine's code (never the query), counts it per process in `GET /admin/search/status` (`engine.rejectedSearches`) and drops its cached live fields so the next request reads them again. Unreachable, slow, unauthorized and missing-index stay `503 search_unavailable`.
7. **Synonym terms** have at most three words (`invalid_term` above), the engine's limit for multi-word synonyms.

## Consequences

- Browsing and filtering cost one engine request per page, as S1 measured (one multi-search, p95 112 ms with three disjunctive queries at 50 000 documents). Ukrainian text searches with many selected groups still fan out; the lower window bounds the worst case per address, not per shop: the server-rendered storefront shares one address (HANDOFF launch blocker) and meets the lower window sooner.
- A new facet appears up to one job 13 run plus 30 s after the definition change; shared URLs that name it answer `400` in that window.
- An engine refusal is visible to the admin and in the error log instead of looking like an outage; the storefront does not fall back to the SQL listing for it (it is a bug to fix).
- Not decided here: a cost-weighted rate limit, fewer text queries per search (a relevance change, needs the S1 corpus again), exact variant-level counts.
