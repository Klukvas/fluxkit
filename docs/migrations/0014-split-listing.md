# Migration 0014: split listing assignments

- Apply `0014_split_listing` through the normal API migration runner before starting the updated API. Existing option assignments receive `splits_listing = false`; no shop settings or seeded types are overwritten. The partial unique index permits only one true assignment per type.
- Admin API/client forks gain `splitsListing` in option-assignment responses and may send it in PUT. Omission preserves existing flags (new assignments default false). A second true assignment returns `409 rule_violation`, `rule: split_option_already_set`, `field: splitsListing`; disable the previous one first.
- Step 2 adds opt-in `groupBy=listing` to store list/search; product mode remains the default. Job 14 automatically rebuilds search to document v4 after deploy. Until the locale has live v4 documents and `listingKey` fields, listing search returns `503 search_unavailable`; product search and the SQL listing fallback remain available. Inherited builds with null/incompatible `build_rebuild_key` are deleted and restarted. Before submitting a swap the indexer clears that key durably; an interruption before Postgres completion therefore restarts the build instead of swapping the old index back in. This recovery uses the existing column, without another migration. Deploy the storefront consumer only after this API capability. Admin checkbox and seed activation remain step 4.
- Rollback: stop the updated API/indexer, restore the previous code, then apply `apps/api/drizzle/0014_split_listing.down.sql`. It drops the partial index, the two new columns and only 0014's migration journal row. Saved split choices and recorded build keys are lost; products, variants and media remain. Downgrade listing consumers and API/indexer code before applying down, then rebuild search with the old document rules. Do not run old and new indexer versions concurrently on one prefix; a database rollback alone cannot restore an index format.

## Storefront consumer (step 3)

- Deploy after the listing-capable API; older APIs reject `groupBy=listing`. Catalog/category/search/home reads now opt in;
  sitemap and suggestions remain product-level. All-false assignments keep the existing catalog markup and behavior.
- `ProductCardModel` gains `listingKey` (additive/minor); `id` stays product id. Update fork card-state/DOM keys to `listingKey`,
  retain product ids for product-wide features, and remove any one-card-per-product deduplication. Old summary payloads use `listingKey ?? id`.
- Render the model's `title`, `href` and `image` directly. The title includes the translated value suffix; href merges match options
  with the authoritative split selection. Forward the same href to `CardAddButton` for its server/no-JS link and include the full
  title in accessible action names. Add uses only the group's `defaultVariantId`, never `match.variantId`.
- Audit fork-owned `cards/custom.ts`, registered cards and `product-card.*` slots locally; upstream does not edit them. Product-wide
  actions can still use `card.id`, while sibling card state must use `card.listingKey`.
- Grouping participates in SQL/last-good and shared-search cache keys. Shared search keeps ADR 0040's page-1 bound, 500-entry LRU,
  60 s fresh plus 5 min stale-on-error, with no failures cached. A listing search `503 search_unavailable` uses the existing
  catalog/category SQL fallback and notice. Search result pages retain their existing unavailable state.
- Step 3's E2E creates an isolated type/assignment/product; it restores the flag and archives its product afterwards. It does not
  activate fixture/demo flags or add the step 4 admin control. Existing shops still activate splitting through the assignment API.
