# packages/ui

Dumb, token-styled components: props in, markup out. No fetching, no API types, no hardcoded user-facing strings (labels and aria texts come from props), semantic Tailwind utilities only (guarded by `packages/theme/src/design-guard.spec.ts`).

- `src/index.ts` - public entry point; other packages import only from here.
- `src/cn.ts`, `src/styles.ts` - class joiner; shared focus ring (`outline-ring`) and form-control classes.
- `src/i18n.ts` - `locales`, `defaultLocale`, `isLocale`, `createTranslator(messages, locale?)` (`t(key, values)` with `{name}` interpolation, `t.plural(key, count, values)` with `<key>.<one|few|many|other>` forms from `Intl.PluralRules`; a missing key, form or placeholder value throws), `messagePlaceholders`.
- `src/button.tsx`, `src/card.tsx`, `src/container.tsx` - primitives.
- `src/input.tsx`, `src/textarea.tsx`, `src/select.tsx`, `src/checkbox.tsx` - form controls (`forwardRef`, native attributes; invalid style follows `aria-invalid`). Their border is `border-border-input` (3:1, WCAG 1.4.11), not the decorative `border-border`; the quantity field uses it too.
- `src/field.tsx` - label, hint and error around a control; passes `id`, `aria-describedby`, `aria-invalid`, `required` to its render-prop child.
- `src/alert.tsx` - `info`/`success`/`warning`/`danger`; `danger` is `role="alert"`, the others `role="status"`.
- `src/badge.tsx`, `src/spinner.tsx` (name from `label`), `src/skeleton.tsx` (decorative, `aria-hidden`), `src/empty-state.tsx`.
- `src/price-text.tsx` - preformatted price plus optional struck-through compare-at with spoken text from props. Must NOT format money.
- `src/quantity-input.tsx` - number input with labelled minus/plus buttons, `min`/`max`, `clampQuantity`.
- `src/pagination.tsx` (`aria-current`, disabled previous/next, `pageItems`), `src/breadcrumbs.tsx` (last item is `aria-current="page"`).
- `src/product-image.tsx` - lazy image with a token-styled placeholder when `src` is missing or fails. A client component (`"use client"`): the failing-image fallback needs state and `onError`. `Dialog` and `Tabs` are the other two.
- `src/option-picker.tsx` - radio group per product option in a `fieldset`/`legend`; disabled values are struck through, not only dimmed.
- `src/skip-link.tsx`, `src/visually-hidden.tsx` - accessibility helpers.
- Admin components (admin UI plan step 4a; props in, markup out, no fetching, labels and aria texts from props):
  - `src/data-table.tsx` - generic `DataTable<Row>`: caption (optionally visually hidden), `th scope="col"` headers from props, a row header (`th scope="row"`, first column or `rowHeaderColumnId`) per row, one empty-state row spanning the table, skeleton rows with `aria-busy` while `loading`, optional actions column. No sorting, paging or fetching; throws for an unknown row header column.
  - `src/dialog.tsx` - `Dialog`: native `<dialog>` opened with `showModal()` from an effect (client component, like `ProductImage`); controlled by `open`; Escape calls `onClose` (the native cancel is prevented, the state stays the source of truth); a backdrop click does nothing; title through `aria-labelledby`, optional description through `aria-describedby`; never renders the `open` attribute.
  - `src/dialog-focus.ts` - pure `openModal(dialog, opener)` (show once, focus `[data-autofocus]`, return a closer that closes and returns the focus to a still-connected opener), unit tested with fakes, no DOM.
  - `src/confirm-dialog.tsx` - `ConfirmDialog`: `alertdialog` with cancel and confirm buttons (labels from props), `tone="danger"`, `busy` (both buttons disabled, `aria-busy`, Escape ignored); focus starts on cancel.
  - `src/tabs.tsx` - `Tabs`: WAI-ARIA tabs (`tablist`, `tab`, one `tabpanel`), controlled, roving tabindex, arrows/Home/End select (client component). Only the selected panel is rendered, so only the selected tab has `aria-controls`.
  - `src/tab-navigation.ts` - pure `nextTabIndex(current, key, disabled)` (wrap-around, disabled tabs skipped, `null` for other keys).
  - `src/description-list.tsx` - `DescriptionList` (`dl`/`dt`/`dd` pairs from `items`).
  - `src/filter-bar.tsx` - `FilterBar`: a labelled `form` region (not `role="toolbar"`, which promises arrow-key navigation); native form attributes pass through except `method`, which is always `post` (the storefront source guard requires it for every `<form>` in the repository).
  - `src/side-nav.tsx` - `SideNav`: labelled `nav`, groups with optional headings (`ul` labelled by the heading), `aria-current="page"` on the current item, links through `renderLink` (the app passes its router's link; no router dependency).
  - `src/locale-text-field.tsx` - `LocaleTextField`: one `Field` + `Input` or `Textarea` per content locale in a `fieldset`/`legend`, `lang` per control, per-locale hint and error through `aria-describedby`, `required` only where the props say (the default locale), `readOnly`.
  - `src/status-badge.tsx` - `StatusBadge` (tone + visible text, on `Badge`); `src/live-region.tsx` - `LiveRegion` (`role="status"`, `aria-live="polite"`, `aria-atomic`, optional visually hidden; render it before its content changes).
- `src/button.tsx` also has a `danger` variant (outlined with the danger token; the theme has no on-danger text color).
- `src/*.spec.ts(x)` - Vitest with `renderToStaticMarkup` (no DOM library); `src/test-helpers.ts` (not built) parses the markup. `no-hardcoded-text.spec.tsx` renders every component (the admin ones included, with loading, empty, busy and multiline variants) with sentinel strings and fails on any other text. Admin component specs: `admin-data.spec.tsx`, `admin-nav.spec.tsx`, `dialog.spec.tsx`, `tabs.spec.tsx`, `locale-text-field.spec.tsx`, `tab-navigation.spec.ts`, `dialog-focus.spec.ts`.
- Built with `tsc` to `dist/` (bundler resolution, consumed by Next and Vite).
