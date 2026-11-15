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

## Internal changes (only for a fork that edited the code)

- `footerConfigProblems(config, messageKeys, theme)` and `assertFooterConfig(config, theme)` take `{ showToggle, inHeader }`
  (`ThemeSwitchPlace` in `layout/footer-layout.ts`) as the third argument instead of `showToggle`; pass
  `inHeader: headerHasThemeControl(headerConfig)` (`layout/header-layout.ts`).
- `SiteHeader` (`components/site-header.tsx`) needs a `themeMode` prop.
