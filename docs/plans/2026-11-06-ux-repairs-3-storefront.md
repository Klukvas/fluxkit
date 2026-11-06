# UX repairs, batch 3A: storefront and seed (2026-11-06)

Branch `fix/ux-repairs-3-storefront` from `origin/main` `a482fe6`. Source: the second round of simulated-user UX tests (shopper Iryna, round 2,
2026-11-06). Storefront app and seed data only (`apps/storefront`, `seeds`; the API seed spec only if an expectation needs it). Batch 3B (admin texts
and UI, another agent) owns `apps/admin/**` and `packages/ui/**`. No new dependency, environment variable, permission, DB schema or public API shape.
One commit per item, tests with each; bug fixes get failing-first evidence. New i18n keys go into NEW namespaces (`cartDelivery.*`, `productReady.*`,
`productChoice.*`).

Out of scope (owner approval pending, not touched): payment code and the test payment provider page, the order lookup rate limit, order/account
linking by e-mail, Nova Poshta/pickup/cash on delivery, discount badges on cards.

## Found (existing functionality)

- Cart summary: `apps/storefront/src/components/cart-page.tsx` (`CartPageView`: summary `dl` with items and subtotal, the sticky bar with "Total"). The
  cart API has no shipping estimate or free-delivery threshold (`CartLine`/`Cart` of `@fluxkit/api-client`); the only threshold is a shipping
  method's `free_over` pricing, known at checkout only (`GET /store/checkout/shipping-methods` needs the address). So the cart states that delivery
  is calculated at checkout and invents no number.
- Shop pages: `config/shop-pages.ts` (delivery table rows `branch`, `courier`, `pickup`), messages `shopPages.delivery.*`, demo flags
  `config/demo-content.json` (`delivery-and-payment` listed as demo copy: stays listed, the copy is still the template's). Seeded methods
  (`seeds/src/shipping.ts`): `demo_courier` (address), `demo_pickup_point` (test-only `fake` provider, never in production), `demo_store_pickup`, all
  inactive after a seed; the review's demo stack had only the courier active. Payment: online by card on the order page (ADR 0032); no cash on delivery.
- Seed banner "Gift ideas": `seeds/src/banners.ts` links `/c/demo-clothing`; the config demo banner (`config/home.ts`, `gifts`) links `/catalog`
  (not the same link: unchanged). The catalog's price filter in the address is `price=<min>..<max>` in MINOR units (`lib/search-query.ts`,
  `PRICE`; e2e `match-and-stock-hints` uses `/en/catalog?price=60000..70000`); `priceMin`/`priceMax` are the script-less form's major-unit boxes and
  are redirected to the canonical `price=`. Demo products at or under 500.00: screwdriver 189, e-book 199, hammer 349, wrench 429 (sold out),
  template pack 499. Core `checkBannerLink` accepts a query (`/catalog?price=..50000`: no dot segment).
- Seed runner: banners with a fixed id and synonym groups that share a term with an existing group are left alone (`seeds/README.md`,
  `apps/api/src/seed/catalog-seeder.ts`), so existing databases keep the old link and the old groups.
- Synonyms: `seeds/src/synonyms.ts` (`викрутка/відвертка`, `сорочка/рубашка`, `худі/толстовка`, ...). Demo titles: футболка, худі, лляна сорочка,
  викрутка, молоток, розвідний ключ, електронна книга, набір шаблонів.
- Order page: `lib/payment-model.ts` `paymentSection` (payment code, out of scope) returns a model for every order with an attempt, so a cancelled
  order shows its last attempt's "expired ... start a new payment" text. Both pages call it: `components/guest-order-page.tsx`,
  `components/account-orders.tsx`; the status model is `lib/order-model.ts` (`ORDER_STATUSES`, `canCancel`).
- Cart focus: the page keeps a live region (`cart.announce.removed`) and moves the focus to the blocked-checkout reason (`focusCheckoutReason`), but
  nothing when the last line goes (the empty state replaces the focused button: focus on `<body>`).
- Product page: `components/product-purchase.tsx` (form `method="post"`, submit button enabled in the server HTML; before hydration a tap posts the
  form natively and the page reloads with nothing added). `selectionSummary` (`lib/mobile-ux.ts`) already names the chosen values for the phone buy
  bar. No option-code convention exists in the storefront (nothing reads `size` or `color`); the size guide page is `size-guide` in
  `config/shop-pages.ts` (`shopPagePath` gives `null` when it is not enabled).

## Findings -> changes

| # | Finding | Change | Files |
| - | ------- | ------ | ----- |
| 1 | Cart shows "Total 698 ₴", checkout adds delivery | A line under the total: "Доставка розраховується при оформленні замовлення" (`cartDelivery.note`, uk/en, client namespace); no estimate (none exists without a new API) | `components/cart-page.tsx`, `lib/client-messages.ts`, messages, `cart-page.spec.tsx` |
| 2 | Delivery page promises branch/parcel locker and pickup; checkout offers the courier only | Delivery table: one row, courier (the rows' messages for branch and pickup removed); payment text: card online on the order page (already); config comment: rows must match the enabled shipping and payment methods, a fork adds rows. Demo flag stays (still demo copy). e2e: the table has the courier row and no pickup/branch | `config/shop-pages.ts`, messages, `shop-pages.spec.tsx`, `e2e/tests/shop-pages.e2e.ts` |
| 3a | "Gift ideas" banner links to Clothing | Seeded link `/catalog?price=..50000` (up to 500.00), text "Товари до 500 ₴ ..." ; e2e expects the new href and that the link lands on a filtered list; README: existing databases keep the old link (an admin edits it) | `seeds/src/banners.ts`, `seeds/README.md`, `catalog-seed.spec.ts`, `e2e/tests/home-banners.e2e.ts` |
| 3b | Russian queries miss demo products | Russian terms for demo words: `отвертка` (screwdriver group), `худи` (hoodie group), new `молоток/молоточек`, `розвідний/разводной`, `лляна/льняная`, `електронна/электронная`. Nothing for "gift". Existing databases keep their groups (runner rule) | `seeds/src/synonyms.ts`, `catalog-seed.spec.ts`, `seeds/README.md` |
| 4 | Cancelled order shows "payment link expired, start a new payment" | `orderPaymentSection(order, onlinePayment)` in `lib/order-model.ts`: no payment block for `cancelled` and `expired`; for `paid`/`fulfilled` only a `paid` attempt (a confirmation), never an expired or failed one; `awaiting_payment` unchanged. Both order pages use it. `paymentSection` itself is not changed (payment code). Spec per status, failing first | `lib/order-model.ts`, `guest-order-page.tsx`, `account-orders.tsx`, `orders.spec.tsx` |
| 5 | Removing the last cart line drops the focus on `<body>` | The `h1` gets `id` and `tabIndex={-1}`; when the cart goes from lines to none and the focus was lost, it moves to the heading (the live region still says "removed"). Pure helper + spec, e2e | `cart-page.tsx`, `lib/cart-model.ts`, specs, `e2e/tests/cart-changes.e2e.ts` |
| 6 | Early tap on "Add to cart" before hydration does nothing | Smaller robust option: until the island mounted, the button is `type="button"` with `aria-disabled="true"` (dimmed by the existing `aria-disabled:opacity-50`) and `data-ready="false"`, so a tap neither reloads the page nor looks usable; a script-less page keeps working as today (the page renders, options and links work; adding never worked without a script) and shows a one-line hint in `<noscript>`. Documented in the storefront README | `product-purchase.tsx`, messages (`productReady.*`), spec, `e2e/tests/pre-hydration-forms.e2e.ts` |
| 7 | Pre-selected options are silent; no size guide link | "Обрано: Чорний, S" (`productChoice.selected`, values joined with ", ", no plural) above the option pickers, only when the product has a picker. Size guide: rule = products that have an option picker (any option; no option code is read) get a link to the shop page named by `productOptionGuide` in `config/shop-pages.ts` (default `size-guide`), only when that page is enabled (`shopPageLinks`); the label is the page title, rendered on the server and passed in | `product-purchase.tsx`, `config/shop-pages.ts`, `lib/shop-pages.ts`, product page route, messages, specs, e2e |

## Risks

- Item 6: e2e tests that click "Add to cart" right after `goto` now wait for hydration (Playwright treats `aria-disabled="true"` as not enabled);
  that is the intended behaviour. A shopper with a script that never loads sees a dimmed button and the `noscript` hint only when scripts are off.
- Item 7: the size guide link shows on every product with options, also a colour-only product (no option code is read, AGENTS 2.3). A fork with
  a better rule changes `productOptionGuide` or sets it to `null`.
- Item 3: existing databases keep the old banner link and synonym groups (documented). Merge conflicts with 3B only in `CHANGELOG.md`/`docs/HANDOFF.md`.

## Verification

`pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:docs`, `check:env`, `pnpm --filter @fluxkit/theme test`, storefront unit tests,
seeds tests, the API seed spec and the storefront e2e if Postgres, Redis and Meilisearch run natively on the reserved ports (5580, 6480, 7880,
3380-3389); screenshots (390 and 1280, uk) of the cart, a cancelled order's page and the product page into the scratchpad.

## Results

(filled in after the work)
