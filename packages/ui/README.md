# @fluxkit/ui

Token-based component library shared by storefront and admin. Components are presentational: props in, markup out; every visible or spoken text (labels, `aria-label`s, `alt`) is a prop, so apps pass translated strings.

- Colors, radii and shadows come only from the design tokens (`@fluxkit/theme`); the design guard fails the build otherwise.
- Radii name a role: `rounded-control` (buttons, fields, chips, `Pagination`, `OptionPicker`, `QuantityInput`, `SideNav`, `Disclosure`), `rounded-card` (`Card`, `BannerCard`, `Hero`), `rounded-panel` (`Alert`, the `TrustBar` list container, the `DataTable` scroll hint, the `MarkdownView` code block), `rounded-overlay` (`Dialog`), `rounded-media` (`ProductImage`, `Skeleton`); `rounded-full` for round shapes (`Spinner`, step numbers). `Checkbox`, `Badge` and the `PriceText` discount badge (0.25rem) keep `rounded-sm`: listed exceptions of the design guard.
- `createTranslator(messages, locale)` returns `t(key, { name })` and `t.plural(key, count)`. Plural forms are separate flat keys (`cart.items.one`, `.few`, `.many`, `.other`; English needs `one` and `other`). A missing key, plural form or placeholder value throws.
- `Field` links label, hint and error to a control: `<Field id="email" label=... error=...>{(control) => <Input {...control} />}</Field>`.
- `ProductImage`, `Dialog`, `Tabs` and the opt-in `SideNavTooltip` are the client components (failing-image fallback; `showModal()` and focus return; roving tabindex keys); the rest render on the server or the client.
- Admin components (props in, markup out; no fetching, no API types, no router, no hardcoded text): `DataTable`, `Dialog`, `ConfirmDialog`, `Tabs`, `DescriptionList`, `FilterBar`, `SideNav`, `LocaleTextField`, `StatusBadge`, `LiveRegion`. File map: `docs/files/ui.md`.
  - `DataTable<Row>`: `caption`, `columns` (`header`, `cell(row)`), `rows`, `rowKey`, `emptyMessage`, `loading`, optional `actions`; the first column is the row header.
  - `Dialog`/`ConfirmDialog`: controlled by `open`; Escape calls `onClose`; the backdrop does not close. Mark the control that gets the first focus with `data-autofocus`. Focus returns to the opener.
  - `Tabs`: `tabs`, `selectedId`, `onChange`; `children` is the selected panel. `SideNav`: `renderLink` lets the app use its router's link.
  - Not verified in a real browser yet (the tests render static markup and test the logic as pure functions): native dialog focus trap and Escape, tab key handling, screen reader announcements.
- Tests: `pnpm --filter @fluxkit/ui test` (Vitest, `renderToStaticMarkup`; interaction tests need a DOM library and are not set up).

File map: `docs/files/ui.md`.
- Inputs, textareas, selects, checkboxes and the quantity field use the `border-input` token (`border-border-input`, at least 3:1 against `background` and `muted`); the plain `border` token is decorative (cards, badges, dividers) and is not enough to identify a control.

## Navigation icons and collapsed SideNav

`icons.tsx` exports 22 named decorative line icons and `IconProps` (`className` only). Replace that file to change the family in a fork. SVG geometry is 24×24; colour and size follow the existing tokens.

`SideNavItem.icon?: ReactNode`, `SideNav.collapsed?: boolean` (default `false`) and `currentTone?: "solid" | "muted"` (default `"solid"`) are additive. Existing no-icon callers keep their markup and appearance. Icon links retain their real label as visually hidden text when collapsed; items without icons keep visible text. Headings remain associated with lists through instance-specific ids, with separators in the collapsed view. `renderLink` still forwards all link props and children.

Collapsed icon links alone use the small client tooltip: a native manual popover in the top layer, opened on hover/focus, dismissed with Escape, positioned at the logical inline end and clamped to the viewport. No portal or additional dependency. Browser interactions are specified by the admin `shell.e2e.ts`; browser execution is pending orchestrator verification.
