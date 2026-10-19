# @fluxkit/ui

Token-based component library shared by storefront and admin. Components are presentational: props in, markup out; every visible or spoken text (labels, `aria-label`s, `alt`) is a prop, so apps pass translated strings.

- Colors, radii and shadows come only from the design tokens (`@fluxkit/theme`); the design guard fails the build otherwise.
- `createTranslator(messages, locale)` returns `t(key, { name })` and `t.plural(key, count)`. Plural forms are separate flat keys (`cart.items.one`, `.few`, `.many`, `.other`; English needs `one` and `other`). A missing key, plural form or placeholder value throws.
- `Field` links label, hint and error to a control: `<Field id="email" label=... error=...>{(control) => <Input {...control} />}</Field>`.
- `ProductImage`, `Dialog` and `Tabs` are the client components (failing-image fallback; `showModal()` and focus return; roving tabindex keys); the rest render on the server or the client.
- Admin components (props in, markup out; no fetching, no API types, no router, no hardcoded text): `DataTable`, `Dialog`, `ConfirmDialog`, `Tabs`, `DescriptionList`, `FilterBar`, `SideNav`, `LocaleTextField`, `StatusBadge`, `LiveRegion`. File map: `docs/files/ui.md`.
  - `DataTable<Row>`: `caption`, `columns` (`header`, `cell(row)`), `rows`, `rowKey`, `emptyMessage`, `loading`, optional `actions`; the first column is the row header.
  - `Dialog`/`ConfirmDialog`: controlled by `open`; Escape calls `onClose`; the backdrop does not close. Mark the control that gets the first focus with `data-autofocus`. Focus returns to the opener.
  - `Tabs`: `tabs`, `selectedId`, `onChange`; `children` is the selected panel. `SideNav`: `renderLink` lets the app use its router's link.
  - Not verified in a real browser yet (the tests render static markup and test the logic as pure functions): native dialog focus trap and Escape, tab key handling, screen reader announcements.
- Tests: `pnpm --filter @fluxkit/ui test` (Vitest, `renderToStaticMarkup`; interaction tests need a DOM library and are not set up).

File map: `docs/files/ui.md`.
- Inputs, textareas, selects, checkboxes and the quantity field use the `border-input` token (`border-border-input`, at least 3:1 against `background` and `muted`); the plain `border` token is decorative (cards, badges, dividers) and is not enough to identify a control.
