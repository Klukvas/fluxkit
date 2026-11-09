# Fork note: storefront messages split into area files, plus overrides (2026-11-08)

Plan `docs/plans/2026-11-08-design-changeability.md`, WP3 (M1, M2). Storefront only. No API, schema, configuration variable or
dependency change; every message key and text is unchanged (checked 1:1 against the old files, PR description).

## What moved

| Before | After |
|---|---|
| `apps/storefront/src/messages/uk.json` | `apps/storefront/src/messages/uk/<area>.json` (13 files) |
| `apps/storefront/src/messages/en.json` | `apps/storefront/src/messages/en/<area>.json` (13 files) |
| (none) | `apps/storefront/src/messages/areas.ts`: the one namespace map (area file and client flag per namespace) |
| `CLIENT_MESSAGE_PREFIXES` list in `apps/storefront/src/lib/client-messages.ts` | derived from `client: true` in `messages/areas.ts` |
| (none) | `apps/storefront/src/messages-overrides/uk.json`, `en.json` (fork-owned, `{}` upstream) |

Areas (by key namespace): `shell` (site, skip, nav, footer, locale, theme, loading, error, notFound, seo, breadcrumbs, trust,
funnel), `home`, `catalog`, `product` (product, availability, productReady, productChoice), `search` (search, searchBox,
searchForm), `cart` (cart, cartDelivery), `checkout`, `order`, `payment`, `account`, `errors`, `legal` (legal, notice), `pages`
(shopPages, contacts). Keys stay flat (`"site.name"`), so code and `t("...")` calls are unchanged. Code that imported
`messages/uk.json` or `en.json` directly now uses `messagesByLocale` from `src/messages` (the 46 spec imports did).

## How to migrate a fork

1. Before merging upstream, keep the fork's current flat files and upstream's old ones (the merge base):
   `git show HEAD:apps/storefront/src/messages/uk.json > /tmp/fork-uk.json` and
   `git show "$(git merge-base HEAD upstream/main)":apps/storefront/src/messages/uk.json > /tmp/upstream-uk.json` (same for `en`).
2. Merge upstream. On a conflict on `messages/uk.json` or `en.json`, take upstream's side: the files are deleted.
3. Write the changed texts as overrides (after the merge, so `--messages` sees the new area files):
   `node scripts/messages-extract-overrides.mjs --fork /tmp/fork-uk.json --upstream /tmp/upstream-uk.json --messages apps/storefront/src/messages/uk --out apps/storefront/src/messages-overrides/uk.json`
   (same for `en`). The script reports on stderr, and leaves out:
   - keys the fork ADDED: an override cannot add a key; since 2026-11-09 they go in `src/messages-extra/<locale>.json` under
     `custom.` (see "Adding keys" below), not in an upstream area file;
   - keys the fork REMOVED: an override cannot remove a key; upstream's text stays;
   - changed keys upstream renamed or removed since: port them by hand.
4. Run `pnpm --filter @fluxkit/storefront test`: `message-files.spec.ts` (key in the file of its namespace, no duplicate, parity
   per area), `messages.spec.ts` (parity, placeholders, plurals on the merged result) and the overrides checks.
5. From now on change upstream texts only in `src/messages-overrides/<locale>.json`; upstream never edits those files, so they
   do not conflict.

## Behaviour to know

- An override key without a base message (a typo, or a key upstream renamed) FAILS `next build` and every page, naming the key
  and the file. So does a value that is not a non-empty string.
- A flat `uk.json` or `en.json` left in `src/messages` is no longer read by the app; the release check
  (`STOREFRONT_REQUIRE_LEGAL_TEXT=true`) refuses the build while one is there.
- The release check reads the MERGED messages: a legal text replaced through an override counts as replaced; an override that
  still carries the placeholder marker is named as `messages-overrides/<locale>.json: <key>`.
- A fork that added a client namespace to `CLIENT_MESSAGE_PREFIXES` now sets `client: true` for it in `messages/areas.ts`.

## Adding keys (2026-11-09)

Owner decision 2026-11-09: a fork adds its own message keys without editing an upstream file. Storefront only; no API, schema,
configuration variable or dependency change.

- New fork-owned `apps/storefront/src/messages-extra/uk.json` and `en.json` (`{}` upstream, never edited by upstream), flat key
  -> text. Every key is in the reserved namespace `custom.` (`custom.deliveryKyiv`); upstream never ships a `custom.` key.
- Merge order: area files, then extras, then overrides. An override may replace a `custom.` key too.
- Refused, naming the key and the file (`next build` and every page fail; the release check refuses the same): a key outside
  `custom.` (it could shadow an upstream key), a key the base already has (replace texts with an override), a value that is
  not a non-empty string. A missing extras file fails the release check.
- uk and en need the same keys (plural groups by group), the same `{placeholders}` and complete plural forms, like the base
  (`messages.spec.ts`).
- `custom` is a client namespace: a fork's client component can use the keys through `useI18n()`; every `custom.` text is
  serialized into each page for the browser, so keep the extras small.

How to migrate a fork that put its own keys into upstream area files (or into `messages/areas.ts`):

1. Move each own key to `src/messages-extra/<locale>.json` with a `custom.` name (`promo.kyiv` -> `custom.promo.kyiv`) and
   rename its uses in the fork's code.
2. Take upstream's side for the area files and `areas.ts` (drop the fork's namespace entries there).
3. Run `pnpm --filter @fluxkit/storefront test`.
