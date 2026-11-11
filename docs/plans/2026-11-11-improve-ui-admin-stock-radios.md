# Admin Stock tab: adjustment mode radios match the admin's other radios

Written against: `b26a02a7` (`main`). Source: finding 1 of `docs/plans/2026-11-11-improve-ui-audit.md`, selected by the owner on 2026-11-11.

## Evidence chain

- Surface: admin product editor, Stock tab, "adjust stock" form (`AdjustmentFormView` in `apps/admin/src/areas/products/stock/stock-tab.tsx`).
  The "mode" fieldset shows when the kind `Select` is set to "adjustment" (`modesFor` in `apps/admin/src/areas/products/stock/stock-adjustment.ts:89-91`
  returns `["delta", "setOnHand"]` only for that kind).
- Problem: the two mode radios (`stock-tab.tsx:327-336`) have no size and no accent classes (`className={focusClass}` only) and sit in a
  `flex items-center gap-2` label with no minimum height. They render at the browser's default radio size and in the browser's default accent
  colour, not the `primary` token, in a row shorter than 44 px.
- Design evidence: every other radio in the admin, and the shared checkbox, uses one pattern: label `inline-flex min-h-11 items-center gap-2`,
  input `size-5 accent-primary` (plus the focus outline):
  - `apps/admin/src/areas/products/tabs/categories-tab.tsx:111-119` (the same product editor, Categories tab)
  - `apps/admin/src/areas/users/user-parts.tsx:121-131`
  - `apps/admin/src/areas/banners/banner-form-view.tsx:121-131`
  - `apps/admin/src/areas/banners/banner-preview.tsx:49-58`
  - `packages/ui/src/checkbox.tsx:19-33` (`Checkbox`: `min-h-11` label, `size-5 ... accent-primary` input)
  `docs/contracts/theme-tokens.md` maps colours to `--fk-*` tokens only; the admin takes `--fk-color-primary` from `tokens.css`, the light rule
  of `brand-overrides.css` and `admin-overrides.css` (section "Admin").
- Owner: `apps/admin/src/areas/products/stock/stock-tab.tsx` (`AdjustmentFormView`).
- Scope and affected surfaces: the two radios of that one fieldset. Nothing else renders this markup.
- Uncertainty: none.

## Design decision

Give the mode radios the admin's existing radio pattern, copied from `users/user-parts.tsx:121-131`. They then share the size, the 44 px row
and the `primary` accent of every other radio in the admin, and a client's admin rebrand (`admin-overrides.css`) recolours them like the rest.
Class-only change: no markup, behaviour, copy or token change.

## Reuse

- Utilities: `inline-flex min-h-11 items-center gap-2` (label), `size-5 accent-primary` (input).
- The local `focusClass` constant already in `stock-tab.tsx:87-88` (keep it on the input).
- Exemplar: `apps/admin/src/areas/users/user-parts.tsx:121-131`.

No new primitive: four call sites already share the pattern inline, and extracting a `Radio` component is out of scope for this fix.

## Changes

1. `apps/admin/src/areas/products/stock/stock-tab.tsx`, the mode fieldset (lines 327-336 at the commit above)
   - Change: the `<label key={mode} ...>` gets `className="inline-flex min-h-11 items-center gap-2"` (was `flex items-center gap-2`). The
     `<input type="radio" name="stock-mode" ...>` gets ``className={`size-5 accent-primary ${focusClass}`}`` (was `className={focusClass}`).
   - Preserve: `name`, `value`, `checked`, `disabled={busy}`, `onChange`, the `legend`, the label text `t(\`products.stock.modeLabel.${mode}\`)`,
     the fieldset's `flex flex-col gap-1`, and the `focusClass` focus outline.
   - Verify: with the kind set to "adjustment", both radios are 20 px, filled in the primary colour when checked, each row at least 44 px high,
     and the keyboard focus outline still shows.

## Scope

- Inherit: the Stock tab's adjustment form only.
- Verify: the other kinds ("receipt", "return", ...) still show no mode fieldset; the form's spacing above the location `Select` still reads
  correctly with the taller rows.
- Exclude: the `legend` typography (admin headings and legends are a documented known limit, `docs/contracts/theme-tokens.md`); the other radio
  call sites (already correct); extracting a shared radio component.

## Validation

- Product: an admin with stock write access opens a product, Stock tab, chooses the "adjustment" kind, switches between "delta" and "set on
  hand", and submits an adjustment as before.
- Interface: the Stock tab at desktop and at a phone width (375 px); radios checked, unchecked, disabled while a write runs (`busy`); keyboard
  focus on each radio.
- System: the four exemplars and this call site now carry the same classes (`grep -rn 'type="radio"' apps/admin/src`); no new component or
  token was added.
- Repository:
  - `pnpm --filter @fluxkit/admin test` → passes.
  - `pnpm --filter @fluxkit/theme test` → passes (the design guard scans `apps/admin`).
  - `pnpm lint` and `pnpm typecheck` → pass.
  - `pnpm format:check` → passes.

## Stop conditions

- Stop if the mode fieldset at `stock-tab.tsx` no longer matches the markup described above (moved, extracted, or already restyled).
- Stop if a shared radio primitive has appeared in `packages/ui` meanwhile: use it instead, which widens the scope to the other call sites.
- Stop if a design-guard or admin test fails on these classes: report it, do not weaken the guard.

## Design documentation

- After acceptance and validation: none required (no contract, token or documented decision changes). A one-line `CHANGELOG.md` entry is
  optional, since the change is visible to admins (AGENTS.md section 8).
