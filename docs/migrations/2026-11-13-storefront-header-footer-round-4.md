# Fork note: new default header and footer look (2026-11-13)

Plan `docs/plans/2026-11-13-storefront-ui-round-4.md` (owner answers: the new look is the owner's own request), PR #270.
Storefront only. Additive configuration (SemVer minor): no API, schema, configuration variable, dependency or token change.
Contract `docs/contracts/header-footer.md`; CHANGELOG, "Storefront (round 4, part A)".

## What changed

The template's default values in the fork-owned `apps/storefront/src/config/header.ts` and `config/footer.ts` changed once:

| File | Before round 4 | Round 4 default |
|---|---|---|
| `config/header.ts` | `controls: ["language", "cart", "account"]`, no `navigation.display` (= `"row"`: categories inline from `xl`, a row that scrolls sideways) | `controls: ["language", "theme", "cart", "account"]`, `navigation.display: "picker"` (a "Categories" / "Категорії" button from `xl` with each category's children in columns; the Light / Dark / System menu in the header) |
| `config/footer.ts` | `blocks: ["navigation", "contacts", "themeSwitch", "copyright"]`, no `layout` (= `"stack"`: one column) | `layout: "columns"`, `blocks: ["navigation", "contacts", "copyright"]` (one column per link group and the contacts; the theme switch moved to the header) |

The header's `blocks`, `navigation.categoryLimit` (6), the header links and the footer's link groups (`shopPages`, `legal`) are
unchanged. Both new options are additive: a config that leaves out `display` or `layout` renders the old look.

## Which forks it affects

- **A fork that never edited `config/header.ts` / `config/footer.ts`** gets the new look with the upstream merge, without a conflict.
- **A fork that edited them** keeps its own values (left-out fields mean the old look) and gets a merge conflict in those two files:
  keep the fork's side, then add `theme`, `display: "picker"` or `layout: "columns"` only where it wants them.
- While `showToggle` of `config/theme.ts` is true, the theme switch must be in the footer (`themeSwitch` block) or in the header
  (`theme` control); both is allowed. Taking the new footer without the new header can leave it nowhere: the storefront tests and
  the first render then fail with `footer block "themeSwitch" is missing ...`.

## Keep the old look

In `apps/storefront/src/config/header.ts`:

```ts
export const headerConfig: HeaderConfig = {
  blocks: ["menu", "logo", "navigation", "search", "controls"],
  controls: ["language", "cart", "account"],
  navigation: {
    categoryLimit: 6,
    links: [{ labelKey: "nav.catalog", href: "/catalog" }],
  },
};
```

In `apps/storefront/src/config/footer.ts`:

```ts
export const footerConfig: FooterConfig = {
  blocks: ["navigation", "contacts", "themeSwitch", "copyright"],
  navigation: {
    groups: [{ kind: "shopPages" }, { kind: "legal" }],
  },
};
```

Then delete the upstream-only, FORK-DELETABLE `apps/storefront/src/components/header-footer-defaults.upstream.spec.tsx` and its
folder `apps/storefront/src/components/header-footer-defaults/` (they pin the template's default markup byte for byte and fail on
any other values; `docs/customization.md`), and run the storefront tests: `pnpm --filter @fluxkit/storefront test`.

## Update 2026-11-15: "Categories" after the logo

Owner's decision, plan `docs/plans/2026-11-15-header-categories-position.md`. No value in `config/header.ts` changed; what
`navigation.display: "picker"` renders did (contract `docs/contracts/header-footer.md`, row `navigation.display`):

| Width | Before | Now |
|---|---|---|
| from `xl` | the `menu` block is the "Categories" button, the `navigation` block renders nothing: "Categories", logo, search, controls | the `navigation` block is the "Categories" button at its own place: logo, "Categories", search, controls |
| below `xl` | the same `menu` disclosure (menu icon) with the flat list | the `menu` block, the flat list as in `row`: unchanged on screen |

- **A fork with the template's `blocks`** gets the new desktop order with the merge.
- **To keep "Categories" before the logo** on a desktop, list `navigation` before `menu` in `config/header.ts`:
  `blocks: ["navigation", "menu", "logo", "search", "controls"]` (a supported order: only `navigation` precedes the menu, and it is
  hidden on a phone). Then regenerate or delete the fork-deletable `header-footer-defaults.upstream.spec.tsx` snapshots as above.
- **A fork that placed `navigation` elsewhere** now sees the "Categories" button there from `xl`; the panel opens towards the start
  when a shown search box precedes it, otherwise towards the end.

## Internal changes (only for a fork that edited the code)

- `footerConfigProblems(config, messageKeys, theme)` and `assertFooterConfig(config, theme)` take `{ showToggle, inHeader }`
  (`ThemeSwitchPlace` in `layout/footer-layout.ts`) as the third argument instead of `showToggle`; pass
  `inHeader: headerHasThemeControl(headerConfig)` (`layout/header-layout.ts`).
- `SiteHeader` (`components/site-header.tsx`) needs a `themeMode` prop.
- 2026-11-15: the `picker` entry of `HeaderBlockView` (`layout/header-layout.ts`) is produced for the `navigation` block and has no
  `withTheme`; `pickerPanelAlign(blocks, searchShown)` gives its panel side.
