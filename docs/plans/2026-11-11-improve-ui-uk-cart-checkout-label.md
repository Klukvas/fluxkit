# Storefront uk: the cart's checkout button names the step, not the final order action

Written against: `b26a02a7` (`main`). Source: finding 2 of `docs/plans/2026-11-11-improve-ui-audit.md`, selected by the owner on 2026-11-11.
The owner's selection approves the wording "Оформлення".

## Evidence chain

- Surface: storefront cart page in the default locale `uk` (`/uk/cart`), the summary block with the checkout link (`apps/storefront/src/components/cart-page.tsx:557-574`).
  Below `md` that block is the sticky bottom bar (`fk-sticky-bottom fk-bottom-bar ... max-md:sticky`), so the label shows there too.
- Problem: in `uk`, the cart's checkout link and the checkout page's final submit button carry the same label, "Оформити замовлення":
  - `apps/storefront/src/messages/uk/cart.json:48` `"cart.checkout": "Оформити замовлення"`
  - `apps/storefront/src/messages/uk/checkout.json:36` `"checkout.submit": "Оформити замовлення"`
  The shopper presses "Оформити замовлення" in the cart, lands on a form, and must press "Оформити замовлення" again to actually place the order.
- Design evidence (copy is the contract; strings live in messages, AGENTS.md 2.2, default locale `uk`, AGENTS.md 4):
  - `en` keeps the two actions apart: `en/cart.json:46` `"cart.checkout": "Checkout"`, `en/checkout.json:36` `"checkout.submit": "Place the order"`.
  - In `en`, `cart.checkout` equals the funnel's name of the step, `en/shell.json:58` `"funnel.checkout": "Checkout"`.
  - The `uk` name of that step is `uk/shell.json:60` `"funnel.checkout": "Оформлення"`.
  - `uk` `checkout.submit` matches its pending text `uk/checkout.json:37` `"checkout.submitting": "Оформлюємо замовлення"`, so the submit label is
    consistent and the cart label is the divergent one.
- Owner: `apps/storefront/src/messages/uk/cart.json` (key `cart.checkout`).
- Scope and affected surfaces: every render of `t("cart.checkout")`: the enabled checkout link (`cart-page.tsx:564`) and the disabled button
  shown while a line blocks the checkout (`cart-page.tsx:573`). No test, e2e spec or override file references the `uk` string (checked with
  `grep -rn "Оформити замовлення"` over `apps/storefront/src`, `apps/storefront/e2e` and `apps/storefront/src/messages-overrides`).
- Uncertainty: none for the wording (approved). The `visual` CI job compares storefront screenshots; a changed `uk` cart label may show as a
  screenshot difference if a `uk` cart page is captured.

## Design decision

Change the `uk` value of `cart.checkout` to "Оформлення", the existing `uk` name of the checkout step. The cart button then names the step it
leads to (as `en` "Checkout" does), and "Оформити замовлення" stays reserved for the action that places the order.

## Reuse

- Message `funnel.checkout` (`apps/storefront/src/messages/uk/shell.json:60`): reuse its exact value, "Оформлення".
- Exemplar: the `en` pair `en/cart.json:46` / `en/shell.json:58` (same value for both keys).

No new key, no component change.

## Changes

1. `apps/storefront/src/messages/uk/cart.json`
   - Change: `"cart.checkout": "Оформити замовлення"` → `"cart.checkout": "Оформлення"`.
   - Preserve: the key name; `cart.checkout.saving` ("Зберігаємо зміни…"), `cart.checkout.blocked`, `cart.checkout.stockBlocked*` and
     `cart.checkout.firstLine`; every `en` message; `uk` `checkout.submit` and `checkout.submitting`; `cartDelivery.note`.
   - Verify: `/uk/cart` with items shows "Оформлення" on the checkout link (and on the disabled button when a line blocks it); `/uk/checkout`
     still shows "Оформити замовлення" on the submit button.

## Scope

- Inherit: the `uk` cart page, desktop summary and the phone sticky bar (same element).
- Verify: the `en` cart still shows "Checkout"; the `uk` checkout page title ("Оформлення замовлення") and submit button are unchanged.
- Exclude: the `en` copy; the checkout page's own copy; the account, order and payment pages; a fork's `messages-overrides/uk.json` (a fork
  that overrides `cart.checkout` keeps its value).

## Validation

- Product: a shopper in `uk` adds a product, opens the cart, presses "Оформлення", lands on the checkout, and places the order with
  "Оформити замовлення".
- Interface: `/uk/cart` at desktop and at 375 px (sticky bar), in the normal state, while saving ("Зберігаємо зміни…") and in the blocked state
  (disabled button); `/en/cart` unchanged.
- System: one string changed; no component, key or test edited; no second message key added for the same meaning.
- Repository:
  - `pnpm --filter @fluxkit/storefront test` → passes (message files and overrides specs).
  - `pnpm lint` and `pnpm format:check` → pass.
  - Optional: `pnpm test:e2e` → passes (the e2e suite asserts the `en` labels only).

## Stop conditions

- Stop if `uk` `cart.checkout` or `funnel.checkout` no longer hold the values quoted above (changed meanwhile).
- Stop if a test or e2e spec turns out to assert the `uk` string "Оформити замовлення" for the cart: report it rather than weakening it.
- Stop if the owner asks for wording other than "Оформлення": the plan's evidence covers that value only.

## Design documentation

- After acceptance and validation: one line in `CHANGELOG.md` (user-visible copy change: the `uk` cart button reads "Оформлення"). No contract
  or design document changes.
