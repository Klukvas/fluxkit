# packages/ui

Dumb, token-styled components: props in, markup out. No fetching, no API types, no hardcoded user-facing strings (labels and aria texts come from props), semantic Tailwind utilities only (guarded by `packages/theme/src/design-guard.spec.ts`).

- `src/index.ts` - public entry point; other packages import only from here.
- `src/cn.ts`, `src/styles.ts` - class joiner; shared focus ring (`outline-ring`) and form-control classes.
- `src/i18n.ts` - `locales`, `defaultLocale`, `isLocale`, `createTranslator(messages, locale?)` (`t(key, values)` with `{name}` interpolation, `t.plural(key, count, values)` with `<key>.<one|few|many|other>` forms from `Intl.PluralRules`; a missing key, form or placeholder value throws), `messagePlaceholders`.
- `src/button.tsx`, `src/card.tsx`, `src/container.tsx` - primitives.
- `src/input.tsx`, `src/textarea.tsx`, `src/select.tsx`, `src/checkbox.tsx` - form controls (`forwardRef`, native attributes; invalid style follows `aria-invalid`).
- `src/field.tsx` - label, hint and error around a control; passes `id`, `aria-describedby`, `aria-invalid`, `required` to its render-prop child.
- `src/alert.tsx` - `info`/`success`/`warning`/`danger`; `danger` is `role="alert"`, the others `role="status"`.
- `src/badge.tsx`, `src/spinner.tsx` (name from `label`), `src/skeleton.tsx` (decorative, `aria-hidden`), `src/empty-state.tsx`.
- `src/price-text.tsx` - preformatted price plus optional struck-through compare-at with spoken text from props. Must NOT format money.
- `src/quantity-input.tsx` - number input with labelled minus/plus buttons, `min`/`max`, `clampQuantity`.
- `src/pagination.tsx` (`aria-current`, disabled previous/next, `pageItems`), `src/breadcrumbs.tsx` (last item is `aria-current="page"`).
- `src/product-image.tsx` - lazy image with a token-styled placeholder when `src` is missing or fails. The only client component (`"use client"`): the failing-image fallback needs state and `onError`.
- `src/option-picker.tsx` - radio group per product option in a `fieldset`/`legend`; disabled values are struck through, not only dimmed.
- `src/skip-link.tsx`, `src/visually-hidden.tsx` - accessibility helpers.
- `src/*.spec.ts(x)` - Vitest with `renderToStaticMarkup` (no DOM library); `src/test-helpers.ts` (not built) parses the markup. `no-hardcoded-text.spec.tsx` renders every component with sentinel strings and fails on any other text.
- Built with `tsc` to `dist/` (bundler resolution, consumed by Next and Vite).
