# Improve UI audit: storefront and admin (2026-11-11)

Commit audited: `b26a02a7` (`main`). Source-only audit: no rendered evidence was provided or captured, so hierarchy, density, prominence and
usability were not judged. Accessibility and HTML/ARIA semantics were out of scope (not requested). No product source was changed.

Status: both findings selected by the owner (2026-11-11). Plans: finding 1 `docs/plans/2026-11-11-improve-ui-admin-stock-radios.md`,
finding 2 `docs/plans/2026-11-11-improve-ui-uk-cart-checkout-label.md`. Not implemented yet.

Two surfaces were selected, one per deployable app, each a primary product task:

- **Storefront:** the purchase funnel: product page buy block (`apps/storefront/src/components/product-purchase.tsx`, `sticky-buy-bar.tsx`),
  cart (`cart-page.tsx`), checkout (`checkout-page.tsx`, `checkout-steps.tsx`, `delivery-section.tsx`), and their `uk`/`en` messages.
- **Admin:** the product editor (`apps/admin/src/layout/product-editor.ts` and its eight tab panels under `apps/admin/src/areas/products/`).

## Design language

- Audited surface: storefront purchase funnel (product buy block, cart, checkout) and admin product editor (all eight tabs).
- Design sources: `docs/contracts/theme-tokens.md` (token contract, design kit rules, radius and heading roles, admin section),
  `packages/ui/README.md`, `packages/theme/README.md`, `packages/ui/src/styles.ts` (`controlBase`, `focusRing`, `textStyles`),
  `AGENTS.md` section 2.2 (tokens only, i18n, default locale `uk`). No `DESIGN.md` exists.
- Documented decisions: colours, radii, shadows, type sizes and spacing only through `--fk-*` tokens and their Tailwind utilities; radii by
  role (`control|card|panel|overlay|media`); headings in `packages/ui` and the storefront use `textStyles` roles; text controls use
  `controlBase` (`border-border-input`, 44 px `min-h-11`); all strings through i18n, default locale `uk`, plus `en`.
- Governing owners and consumers: `@fluxkit/theme` (`tokens.css`, `tailwind.css`, guarded by `design-guard.spec.ts` and `contrast.spec.ts`)
  feeds `@fluxkit/ui` (`Button`, `Field`, `Input`, `Select`, `Checkbox`, `QuantityInput`, `StepIndicator`, ...), consumed by both apps.
  Storefront copy: `apps/storefront/src/messages/{uk,en}/*.json`. Admin copy: `apps/admin/src/messages/{uk,en}/*.json`.
- Explicit exceptions: the admin's headings do not use `textStyles` and are not scanned by the heading-role guard
  (`docs/contracts/theme-tokens.md`, "Known limit", heading roles and Admin sections); the six `rounded-sm` uses listed in `radiusExceptions`
  of `packages/theme/src/design-guard.spec.ts`; the `LocaleCard` of the admin search status stays `rounded-card`.

## Findings

| # | Problem | Evidence | Proposed change | Scope | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | The "stock adjustment mode" radios in the product editor's Stock tab render as unsized browser-default radios with the browser's own accent colour and a label without the 44 px row, while every other radio of the admin (including the Categories tab of the same editor) is `size-5 accent-primary` in a `min-h-11` label. | Contract: direct contradiction in presentation within the same task (editing a product; both tabs are panels of `PRODUCT_EDITOR_TABS`, `apps/admin/src/layout/product-editor.ts:36-60`). `apps/admin/src/areas/products/stock/stock-tab.tsx:327-336`: label `flex items-center gap-2`, input `className={focusClass}` only. Siblings: `apps/admin/src/areas/products/tabs/categories-tab.tsx:111-119`, `banners/banner-form-view.tsx:121-131`, `banners/banner-preview.tsx:49-58`, `users/user-parts.tsx:121-131`: label `inline-flex min-h-11 items-center gap-2`, input `size-5 accent-primary` (plus `focusClass`). `packages/ui/src/checkbox.tsx:19-33` uses the same `min-h-11` / `size-5 accent-primary` pair for checkboxes. Runtime: `AdjustmentFormView` renders the fieldset when `modesFor(kind).length > 1`, i.e. for the "adjustment" kind (`stock/stock-adjustment.ts:89-91`), chosen in the visible "kind" `Select` above it. | In `stock-tab.tsx:327-336`, give the label `inline-flex min-h-11 items-center gap-2` and the input `size-5 accent-primary` next to the existing `focusClass`, exactly as `users/user-parts.tsx:121-131` does. | Admin product editor, Stock tab, adjustment form (two radios, "delta" and "set on hand"). | High |
| 2 | In the default locale `uk`, the cart's "go to checkout" action and the checkout's "place the order" action carry the same label, "Оформити замовлення", so the shopper sees one label for two different steps of the same funnel. | Contract: direct contradiction in user-facing copy within one task. `apps/storefront/src/messages/uk/cart.json:48` `"cart.checkout": "Оформити замовлення"` and `apps/storefront/src/messages/uk/checkout.json:36` `"checkout.submit": "Оформити замовлення"`. The `en` copy separates them (`en/cart.json:46` `"Checkout"`, `en/checkout.json:36` `"Place the order"`), and `en` `cart.checkout` equals `en` `funnel.checkout` (`en/shell.json:58`, `"Checkout"`), whose `uk` value is `"Оформлення"` (`uk/shell.json:60`). `uk` `checkout.submitting` ("Оформлюємо замовлення") pairs with `checkout.submit`, so the cart label is the divergent one. Runtime: `cart-page.tsx:564` and `:573` render `t("cart.checkout")` (the checkout link and its disabled state); `checkout-page.tsx:728` renders `t("checkout.submit")`; `uk` is the default locale (`AGENTS.md` section 4). | Set `uk` `cart.checkout` in `apps/storefront/src/messages/uk/cart.json` to `"Оформлення"`, the existing `uk` name of the checkout step (`funnel.checkout`), mirroring `en`, where `cart.checkout` equals `funnel.checkout`. | Storefront cart page: the checkout link, its disabled state and the phone sticky bar that shares the key; `uk` only. | Medium |

Candidates rejected in vetting (kept so a later audit does not repeat them):

- The phone buy bar's hand-rolled stepper and add button (`sticky-buy-bar.tsx:63-124`) differ slightly from `QuantityInput` and `Button`
  (glyph size, no hover). The bar is hidden from assistive technology and shows only while the inline block is off screen, the `Button` `lg`
  size it could use is not used anywhere, and no contract pins the bar's look: no binding contract, correction not determined.
- Admin heading and `legend` typography varies (`font-medium` vs `font-semibold`, with or without `text-lg`): covered by the documented known
  limit (admin headings outside `textStyles`).
- The admin file-picker label (`catalog-dictionaries/upload-panel.tsx:83-91`) uses `border-border`: it is styled as a secondary button, not a
  text control, and matches `Button` `secondary`.

## Improve first

Finding 1: it has the strongest evidence (four admin exemplars plus `Checkbox` agree, one call site diverges), the correction is a
class-only change that copies an existing exemplar, and it brings the radios onto the `primary` token, so an admin rebrand
(`admin-overrides.css`) reaches them like every other radio. Finding 2 has higher user reach (default locale, every purchase) but is a copy
decision with Medium confidence; confirm the wording with the owner before planning it.

## Not checked

- Rendered pages (no screenshots or browser run): visual hierarchy, spacing rhythm, dark mode, responsive behaviour beyond class reading.
- Storefront surfaces outside the funnel (home, catalog and search, account, legal) and admin areas outside the product editor (orders,
  banners, dictionaries, users, shipping, email, search, help), except where sibling call sites were used as evidence.
- Accessibility and ARIA semantics (out of scope unless requested).
