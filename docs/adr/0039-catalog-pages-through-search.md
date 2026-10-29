# 0039. Catalog and category pages through search, with the SQL fallback

Status: accepted 2026-10-29 (search plan step 10a, the rest of the row; owner answer 3 taken as recommended). Builds on ADR 0034 (decision 11: "the catalog and category pages fall back to the SQL listing"), 0036 (decision 6: an engine refusal is not an outage) and 0038 (the forwarded client address); changes none of them. No schema change, no migration, no new route, environment variable or dependency.

## Context

- Plan section 9: with `search` true the catalog and category pages read `GET /store/search` with the category as a filter (facets and sort); on `503` they fall back to `GET /store/products` (newest first, no facets) "with a small notice"; with `search` false they stay as today. Canonical URLs of filtered pages point to the unfiltered page.
- The results page `/{locale}/search` already has a URL state (`f`, `price`, `sort`, `page`), a facet panel and its states (step 10a, first part). The product pages and shared links use `/catalog?brand=<slug>`.
- The API's `search` window is 60 a minute per client address (ADR 0036). Without `STOREFRONT_FORWARD_CLIENT_ADDRESS=true` (ADR 0038, off by default) every server read of the storefront counts as the Next server's one address.
- `next start` writes every cached fetch answer to disk and never deletes one; Next caches only `200` answers.

## Decision

1. **One URL state.** With search on, `/catalog` and `/c/<slug>` take the results page's parameters (`f`, `price`, `sort`, `page`) with the same values and canonical form on their own path (`apps/storefront/src/lib/catalog-search.ts`), and share its facet panel, chips, sort and pages (`FacetedResults`). Words are not part of a catalog address: a `q` with text is a 404. Non-canonical forms (a script-less form submit, `page=1`) redirect to the short address on the same path.
2. **`?brand=` stays.** `brand=<slug>` is accepted as an alias of `f=brand:<slug>` without a redirect, so product page links, shared links and the address of a shop that switches search off again keep working. Links the page writes use `f=brand:<slug>`.
3. **The category is the path.** A category page adds `category:<its id>` to the request and does not offer the category facet; a `category:` facet in its address is a 404 (the API ORs the values of one key, so it would widen the page).
4. **Fallback with a notice.** The page falls back to the SQL listing for every answer that means "search cannot serve this now": `503 search_unavailable` or an API that cannot be reached, `429` (the window, which a storefront without the forwarded address shares between all shoppers), and `404` (the cached config still said on). The SQL listing applies the category, one brand and the page; a notice above the list says filters are unavailable and, when the address asked for more (another facet, several brands, a price, a sort), that those were not applied. "Try again" and the page links keep the address, so the filters come back with search. A selection the API refuses (`400`) is explained with a link that clears it, never silently listed without it; an engine refusal (`500`) or anything unexpected renders the error page (ADR 0036 decision 6).
5. **Caching.** The unfiltered list (no facet, no price; category, page and sort are bounded) is read through the Next data cache for the catalog's 60 seconds, without a forwarded address (the header would be part of the cache key); every filtered read is `no-store` and forwards the address like the results page. So plain browsing costs at most one engine search per locale, category, page and sort a minute, whatever the traffic; filtered pages count against the shopper's window (or the Next server's, without the forwarding).
6. **One read per view.** `generateMetadata` never reads the search: a filtered or sorted view is `noindex, follow` and its canonical is the plain list of the page (as the brand filter of the SQL listing).
7. **Demo synonyms through an extension point.** The seed runner writes the demo synonym groups (ADR 0034 decision 8) only with search on, through the token `SEARCH_SYNONYM_SEEDER` in `apps/api/src/common/search-port.ts` (provided by the search module with the admin search service's rules), so `src/seed/` still never imports `src/search/` and a seed with search off writes nothing to the search tables.

## Consequences

- With search on, catalog browsing survives an engine outage or a used-up window as the plain SQL list, and the shopper is told; with search off nothing changes.
- A storefront without `STOREFRONT_FORWARD_CLIENT_ADDRESS=true` serves filtered catalog pages from one shared window of 60 a minute; beyond it shoppers see the fallback notice. The operator switch of ADR 0038 removes that (the production example sets it).
- Heading levels differ by mode: with search on, the result count is an `h2` and the product titles `h3` (as on the results page); the SQL listing keeps `h2` titles.
- Two addresses (`?brand=x` and `?f=brand:x`) show the same list; both are `noindex` with the same canonical.
- Not decided here: per-category facet order (`category_filter`, a later plan), exact variant counts, a cost-weighted rate limit.
