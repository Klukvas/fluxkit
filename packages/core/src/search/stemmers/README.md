# Snowball stemmers (vendored)

Ukrainian and English stemmers for the catalog search (ADR 0033 decisions 6 and 7). They turn `сорочки` and `сорочка`, or `batteries` and `battery`, into one stem, so a shopper's inflected word finds the product. The search index stores the stems next to the original text; the query side sends the stems of the shopper's words (`planTextQueries`).

## What is third-party

- **Source:** [Snowball](https://snowballstem.org) 3.2.0, `snowballstem/snowball` commit `6389c79f91cd67ed2de3ebdcf84ec8c2d2d23c11` (2026-10-17): `algorithms/ukrainian.sbl` (added to Snowball on 2026-10-15) and `algorithms/english.sbl`.
- **Licence:** BSD-3-Clause, `snowball/COPYING` (copyright Martin Porter, Richard Boulton, Yoshiki Shibukawa, Olly Betts). AGENTS.md section 16 allows it. The notice stays in the source tree and `pnpm notices` appends it to `THIRD_PARTY_NOTICES.md`; ship that file with every client delivery.
- **Not an npm package:** `snowball-stemmers` 0.6.0 has no Ukrainian algorithm. The `.sbl` files are the algorithms; the TypeScript is generated from them.

## What is ours

- `snowball-runtime.ts` - the runtime (closures for the Snowball commands, `among` tables, backward mode). Semantics follow the reference `javascript/base-stemmer.js` of the same release.
- `scripts/snowball/generate.mjs` (repository root) - translates a `.sbl` file into a module of closures. Supports the subset of the language that these two algorithms use and fails loudly on anything else.
- `index.ts` - which token goes to which stemmer.

## Regenerate

```
node scripts/snowball/generate.mjs packages/core/src/search/stemmers/snowball/ukrainian.sbl \
  packages/core/src/search/stemmers/snowball/ukrainian.generated.ts stemUkrainian "<upstream version>"
node scripts/snowball/generate.mjs packages/core/src/search/stemmers/snowball/english.sbl \
  packages/core/src/search/stemmers/snowball/english.generated.ts stemEnglish "<upstream version>"
pnpm exec prettier --write packages/core/src/search/stemmers
```

A new Snowball release: replace the `.sbl` files and `COPYING`, regenerate, update the version above and in the generated headers, bump `SEARCH_DOCUMENT_VERSION` (every index is rebuilt), and run the checks below.

## Verify

- CI: `stemmers.spec.ts` reproduces the reference stems of a 1-in-100 sample of the `snowball-data` vocabularies (`snowball/*-sample.ts`; BSD-3-Clause word frequency lists).
- By hand, against the full vocabularies (58 021 Ukrainian and 42 649 English words, checked on 2026-10-29 with 0 mismatches):

```
pnpm build
node scripts/snowball/verify-vocabulary.mjs uk voc.txt output.txt   # snowball-data/ukrainian
node scripts/snowball/verify-vocabulary.mjs en voc.txt output.txt   # snowball-data/english
```

- The samples are made with `scripts/snowball/make-vocabulary-sample.mjs`.

## Known limits (pinned by the specs)

The Ukrainian algorithm gives some forms of one word different stems (`сорочка` stems to `сор`, `сорочці` to `сорочц`; `зимові` to `зим`, `зимовий` to `зимов`), which is why the search also sends five-letter prefixes. The English algorithm leaves irregular forms apart (`knife`/`knives`, `mouse`/`mice`); synonym groups cover those.

## Removing it

Delete this folder and the `stems`/`stems5` fields of `document.ts` and `settings.ts`; the rest of the search keeps working on the original text (ADR 0033 decision 6).
