# Plan: promotional banners on the storefront home page

Status: implemented on `feature/home-banners` (from `origin/main` `49a9c95`), see "Results"; not independently reviewed; no PR opened.
Owner request 2026-11-05. Storefront only: no API, schema, dependency, environment variable, theme token or public contract change.

## Goal

A new home section kind `banners`: 1 to 3 promotional cards in a responsive row (1 column on phones, up to 3 on desktop), each a
local picture, a title and a short text (message keys, uk and en), one link (an internal path or an `https` address) and an optional
tone. Added to the default home config between the hero and the categories, with demo copy marked `TODO(fluxkit)`.

## What exists (reused, not reinvented)

- `apps/storefront/src/config/home.ts`: the typed section list (`hero`, `categories`, `productRow`, `trust`, `richText`) and `LocalImage`
  (`src`, `width`, `height`, `altKey`); `config/home.spec.ts` checks ids, message keys, limits, link paths and that pictures exist with
  their real size and load nothing.
- `components/home-sections.tsx`: one renderer per `kind`; a `switch` with a `never` check, so an unknown `kind` fails `tsc`.
  `SectionShell`, the visually hidden `h2` of the trust section, the tile card classes and `focusRing`.
- `components/local-picture.tsx` (`LocalPicture`: `next/image` for files under `public/` only, `width`/`height`, `eager` or `lazy`).
- `lib/locale-path.ts` `localizedHref`: the hero CTA's check (plain site path, no `//`, `\`, `..`), reused for internal banner links.
- An `https` check exists twice (`lib/payment-redirect.ts`, `lib/image-source.ts`), each tied to its own purpose (the one module allowed
  to assign the location; the image host allow-list). A small banner-specific check is written instead of coupling banners to payments.
- Tokens: there are no `surface`/`accent` tokens. The tones map onto existing ones: `surface` = `background` + `border` (like the
  category tiles), `accent` = `primary` + `primary-foreground` (like the primary button). No new token (that would be a contract change).
- Test helpers: `sentinelTranslator`, `leftoverText`, `textAttributes` (no hardcoded text); the design guard (`packages/theme`).
- E2E: `e2e/tests/design-b.e2e.ts` (section order, h1, CLS, 4 widths, dark contrast walk of `/en` and `/uk`).

## Scope check

Core storefront presentation config, like the hero and the trust bar: not a feature module, no flag (an empty list or removing the
entry hides it). Product/Variant rules untouched. Theming: tokens only.

## Design

- **Config** (`config/home.ts`): `BannersSection { kind: "banners"; id; titleKey (visually hidden h2); items: BannerList }`,
  `Banner { id; titleKey; textKey; href; image: LocalImage; tone?: "surface" | "accent" }`. `BannerList` is a tuple type of 0 to 3
  items, so a fourth banner fails the TypeScript build; `MAX_BANNERS = 3` is also checked at run time (a value built by a cast).
- **Validation** (`lib/home-banners.ts`, pure): `bannerLink(locale, href)` returns `{ href, external }`: a path goes through
  `localizedHref` (refused like the hero's link otherwise); an absolute address must be `https`, with a host, no credentials, no
  whitespace or control characters and at most 2048 characters; `http:`, `javascript:`, `data:`, `//host`, `\` are refused (throws).
  `checkBannersSection(section)` throws on more than 3 items, duplicate ids or a bad id. The renderer calls both, so a bad config fails
  loudly on the first render in development (and in the config spec in CI), never silently.
- **Rendering** (`home-sections.tsx`, `BannersView`): `<section aria-labelledby>` with a visually hidden `h2`, a `<ul>` grid:
  1 item = 1 column, 2 items = `md:grid-cols-2`, 3 items = `md:grid-cols-3` (one column below 768 px). Each `<li>` holds ONE link (the
  whole card): `next/link` for an internal path, a plain `<a>` for `https` (same window, no `target`). The link's accessible name is
  the banner's title (`aria-labelledby` = the card's `h3`), its description the text (`aria-describedby`), so a screen reader does not
  read the picture's alt and the text as the name. The picture is `LocalPicture` with its `width`/`height` (`h-auto w-full`, no layout
  shift), `lazy` unless the banners section is the FIRST section of the page (then `eager`). Hover: raised shadow and underlined title;
  focus: the shared `focusRing`. Empty `items` renders nothing (no heading, no list).
- **Pictures**: three neutral generated SVGs `public/home/banner-1.svg` ... `banner-3.svg` (640 x 320), each with its own light
  background like `hero.svg`, so they read the same in dark; no script, no external reference.
- **Default config**: three demo banners after the hero (`home.banners.*` messages in uk and en; links `/catalog`, `/catalog`,
  `/account/register`; tones `accent`, `surface`, `surface`), marked `TODO(fluxkit)`; the config comment says how a fork replaces
  them (edit `items` and the `home.banners.*` messages, replace the SVGs, or empty the list / remove the entry).

### Why no carousel

- Accessibility: an auto-rotating carousel needs a pause control (WCAG 2.2.2), moves content under the reader and keyboard focus, and
  hides slides from people who never reach them; a static row shows every offer at once with no extra controls.
- Layout stability: slides of different heights or late-loaded slides shift the page (CLS); fixed cards with intrinsic picture sizes do not.
- No autoplay, no JavaScript: the cards are server components (plain links) and add nothing to the client bundle; a carousel would need a
  client island or a new dependency (red zone). (The home page as a whole still needs its script, because React's streaming outlines it;
  that is unchanged by this plan, storefront README "Keep the header small".)
- 1 to 3 cards fit one row on desktop and stack on phones, so there is nothing to rotate.

## Files

- `apps/storefront/src/config/home.ts`, `config/home.spec.ts`
- `apps/storefront/src/lib/home-banners.ts`, `lib/home-banners.spec.ts` (new)
- `apps/storefront/src/components/home-sections.tsx`, `components/home-sections.spec.tsx`
- `apps/storefront/src/messages/uk.json`, `en.json` (`home.banners.*`)
- `apps/storefront/public/home/banner-1.svg`, `banner-2.svg`, `banner-3.svg` (new)
- `apps/storefront/e2e/tests/home-banners.e2e.ts` (new), `e2e/tests/design-b.e2e.ts` (section order and headings now include the banners)
- Docs: `apps/storefront/README.md` ("Home banners"), `docs/files/storefront.md`, `CHANGELOG.md`, `docs/HANDOFF.md` (own lines only)

## Risks

- A config typo in a link breaks the home page render: intended (fail loudly); the config spec catches it in CI first.
- External links leave the shop in the same window; the referrer policy of the pages is unchanged.
- The default demo copy reads like an offer: marked `TODO(fluxkit)`, listed for the owner; not covered by `STOREFRONT_REQUIRE_LEGAL_TEXT`.

## Verification

`pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:docs`, `check:env`, storefront and theme unit tests, the e2e files
`design-b` and `home-banners` against native Postgres, Redis and Meilisearch; screenshots before and after (uk and en, light and dark,
390 and 1280).

## Later option (NOT built)

Banners managed in the admin: an admin area to create, order, schedule and translate banners with uploaded pictures. It needs a table
(migration with `down`, personal-data inventory entry), admin and store API endpoints (public contract), media uploads and storefront
caching: a red-zone decision (AGENTS.md section 14) with its own plan. Until then a fork edits `config/home.ts` and the messages.

## Results (2026-11-05)

Verified in the sandbox with native Postgres 16, Redis and Meilisearch 1.55.0 (no Docker), the built API and `next start` through the e2e
proxy (Chromium):

- `pnpm lint`, `format:check`, `typecheck`, `check:boundaries` (0 violations), `check:env`, `check:docs`: exit 0.
- Unit: storefront 107 files / 1829 tests and `@fluxkit/theme` 96 tests pass (design guard, token contrast pairs); the compile-time checks
  were mutated (an assertion flipped makes `tsc` fail).
- E2E: `design-b.e2e.ts` (12, incl. the dark contrast walk of `/en` and `/uk` with the banners on the page) and `home-banners.e2e.ts` (6)
  pass; the other specs that open the home page (`guest-purchase`, `navigation-focus`, `search`, `ui-polish`): 28 passed, 4 skipped (their
  own conditional skips).
- Screenshots before and after, uk and en, light and dark, 390 and 1280 (16 files): scratchpad `banner-shots/before-*.png`, `after-*.png`.
  At 1280 the three cards are one row under the hero; at 390 one column; dark pictures keep their light background, the accent
  card is the dark `primary` fill with dark text.
- Found during the work: the theme contrast scanner reads a class string without `bg-*` as text on `background`, so the accent card's text
  inherits its colour instead of naming `text-primary-foreground` again.
- Not verified: iOS Safari, a real screen reader (the name and description were checked through Playwright's accessibility tree), the
  home page without a script (outlined before this change).

## Open decisions for the owner

1. Default copy and links of the three demo banners (now "New this season" -> catalog, "Gift ideas" -> catalog, "Create an account" ->
   registration); they read like offers and are not covered by `STOREFRONT_REQUIRE_LEGAL_TEXT`.
2. How many banners the template shows by default (now 3; 0 to 3 allowed).
3. Tones (now the first `accent`, the others `surface`); a third tone would need a new token (theme contract, red zone).
