# 0037. Catalog search: a partial last word on the results page

Status: accepted 2026-10-29 (fix of a storefront e2e finding: `GET /store/search?q=screw` found nothing while the suggest route offered "Demo Screwdriver"). Supersedes in part ADR 0034 decision 3 (the second bullet: the retry only for two or more words, with the same federation) and adds to ADR 0036 decision 3 (the measured cost of one word that finds nothing); ADR 0034 and 0036 themselves are not edited. No schema change, no migration, no dependency, no environment variable, no new request parameter.

## Context

- ADR 0034 decision 3 sends the words of a results page with a trailing space, so the engine does not prefix-match the last word (spike S1, E8): complete words keep their precision. A shopper who presses Enter on a word they did not finish ("screw", "ножиц", "клав") gets "Nothing found", although the suggest route (no trailing space) offered the product a moment earlier.
- The 5-letter prefix query on `stems5` already finds most Ukrainian words cut at five letters or more; English has no such query, and Ukrainian words cut at three or four letters are found by nothing.
- Measured on the S1 harness (`apps/api/src/spikes/search-morphology.spec.ts`, real Meilisearch v1.55.0, real core document builder, settings and text planner), both passes of the store as they run. Corpora: the 90 Ukrainian complete-word queries of S1; 30 Ukrainian partial queries (the 10 S1 suggest prefixes and 20 new `partial` queries: a noun cut to 3 to 6 letters, alone or after a complete adjective, `search-corpus.ts`); the 80 English singular and plural forms on 160 English titles; 93 English nouns cut to 3 to 6 letters. Cells: recall@100 / P@10 / queries without results.

| Strategy for the last word | uk complete (90) | uk partial (30) | uk typos (10), recall | en complete (80) | en partial (93) | `screw` finds the screwdrivers |
|---|---|---|---|---|---|---|
| (a) before: trailing space, retry `last` only for 2+ words | 98.9 / 95.7 / 1 | 63.3 / 51.5 / 11 | 100 | 96.3 / 100 / 0 | 13.4 / 18.3 / 76 | no |
| (b) no trailing space on the original words in the strict pass | 98.9 / **95.4** / 1 | 98.9 / 98.7 / 0 | 100 | 97.8 / **99.4** / 0 | 100 / 100 / 0 | yes |
| **(c) prefix only in the second pass, run whenever the strict pass finds nothing (`last` for 2+ words, `all` for one)** | **98.9 / 95.7 / 1** | **100 / 88.2 / 0** | **100** | **96.3 / 100 / 0** | **95.1 / 100 / 0** | **yes** |
| (c') as (c), but the second pass always `all` | 96.7 / 95.3 / 3 | 98.9 / 98.7 / 0 | 100 | 96.3 / 100 / 0 | 95.1 / 100 / 0 | yes |
| (d) prefix in the strict pass when the last word has fewer than 4 letters | 98.9 / 95.7 / 1 | 66.7 / 65.3 / 10 | 100 | 96.3 / 99.4 / 0 | 49.4 / 53.8 / 43 | no |
| (d) fewer than 5 letters | 98.9 / 95.7 / 1 | 98.9 / 98.7 / 0 | 100 | 96.3 / 99.4 / 0 | 78.4 / 82.8 / 16 | no |
| (d) fewer than 6 letters | 98.9 / 95.4 / 1 | 98.9 / 98.7 / 0 | 100 | 97.8 / 99.4 / 0 | 92.9 / 94.6 / 5 | yes |
| (d) fewer than 7 letters | 98.9 / 95.4 / 1 | 98.9 / 98.7 / 0 | 100 | 97.8 / 99.4 / 0 | 100 / 100 / 0 | yes |

- (b) and (d) lower P@10 on complete words (a short complete word also matches longer words that start with it); a length rule cannot tell a complete short word from a cut one. (c') loses the ADR 0034 retry of several words (zero results 1 to 3). (c) answers every complete-word query exactly as before (the spec compares every query of both flows) and finds every partial query.

## Decision

1. **Prefix only in the second pass.** The strict pass stays as ADR 0034 decides (complete words, trailing space, `matchingStrategy: all`). When it finds nothing and `q` has at least one word, ONE second pass runs with the text queries of core `planTextQueries(query, locale, "relaxed")`: the original words WITHOUT the trailing space (the last word is prefix-matched), the stems and 5-letter prefix queries unchanged (with the space: the stem of a cut word is no stem). `matchingStrategy` is `last` for two or more words (ADR 0034's retry) and `all` for one word. One retry at most, as before.
2. **Same queries, same cost per pass.** The relaxed plan has exactly the text queries of the strict plan (a stems query is left out by comparing with the strict original words), so a pass keeps the request count of ADR 0036 decision 1. New measured cost (`store-search.spec.ts`, spy): one English word that finds nothing, with 8 selected groups, 2; one Ukrainian word that finds nothing, with 8 groups (7 non-price), 20. Both are within the documented worst case of ADR 0036 decision 3 (2 and 20); the other numbers are unchanged.
3. **`relaxed: true`** now means "the second pass answered": the products match the last word only as a prefix, or (two or more words) only some of the words. It stays `false` on an empty page. The storefront shows these results as partial matches, as before.
4. **The suggest route is unchanged** (the typed text, no stems).

## Consequences

- "screw", "клав", "ножиц" and similar unfinished words find their products from the results page; complete words answer exactly as before, so precision and recall of complete words are unchanged.
- A one-word query that finds nothing now costs a second pass (one engine request in English, one per planned query in Ukrainian); the `search` window of ADR 0036 decision 4 still bounds it per address.
- In the second pass a cut word cannot use stems (Ukrainian partial P@10 88.2% against 98.7% for option (b)); accepted, because (b) costs precision on every complete word.
- A partial word that already matches something in the strict pass (by a typo or the 5-letter prefix query) is not prefix-matched; the shopper sees the strict results.
- `search-morphology.spec.ts` pins the table's numbers for (c) and the "before" flow; `feature-matrix.sh search-on` checks `q=screw` on the seeded catalog.
