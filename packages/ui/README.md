# @fluxkit/ui

Token-based component library shared by storefront and admin. Components are presentational: props in, markup out; every visible or spoken text (labels, `aria-label`s, `alt`) is a prop, so apps pass translated strings.

- Colors, radii and shadows come only from the design tokens (`@fluxkit/theme`); the design guard fails the build otherwise.
- `createTranslator(messages, locale)` returns `t(key, { name })` and `t.plural(key, count)`. Plural forms are separate flat keys (`cart.items.one`, `.few`, `.many`, `.other`; English needs `one` and `other`). A missing key, plural form or placeholder value throws.
- `Field` links label, hint and error to a control: `<Field id="email" label=... error=...>{(control) => <Input {...control} />}</Field>`.
- `ProductImage` is the one client component (failing-image fallback); the rest render on the server or the client.
- Tests: `pnpm --filter @fluxkit/ui test` (Vitest, `renderToStaticMarkup`; interaction tests need a DOM library and are not set up).

File map: `docs/files/ui.md`.
- Inputs, textareas, selects, checkboxes and the quantity field use the `border-input` token (`border-border-input`, at least 3:1 against `background` and `muted`); the plain `border` token is decorative (cards, badges, dividers) and is not enough to identify a control.
