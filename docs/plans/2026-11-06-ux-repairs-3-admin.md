# UX repairs, batch 3B: admin texts and UI (2026-11-06)

Branch `fix/ux-repairs-3-admin` from `origin/main` `a482fe6`. Source: the second round of simulated-user UX tests of 2026-11-06 (shop manager Olena,
items 1 to 9; shop manager Taras, items 10 to 16). Admin app and `@fluxkit/ui` only. Batch 3A (storefront and seeds) runs in parallel: nothing in
`apps/storefront/**`, `seeds/**` or `apps/api/**` is touched. No new dependency, environment variable, permission, DB schema or API shape.
One commit per item, specs with each; bug fixes with failing-first evidence.

Out of scope (need a new API or schema, or an owner decision): sales summary, shop contacts in settings, buyer name and phone in the orders list and a
wider order search, a "simple product" product type, payment code, the order lookup limit. Later (Taras, recorded only): a tracking-number field for
self-delivery (needs an API field), screenshots in help articles, softening "Create all variants again?", the stock tab vocabulary, the category-tab message.

## Found (existing functionality)

- Texts: `apps/admin/src/messages/{uk,en}/*.json` (`messages.spec.ts` keeps both languages' keys equal); help articles are typed data in
  `apps/admin/src/areas/help/content/*.ts` (`help-content.spec.ts`); the "Help for this page" map is `apps/admin/src/layout/context-help.ts`.
- Delete dialogs: `ConfirmDelete` in `areas/catalog-dictionaries/form-dialog.tsx`; the option value and attribute option rows in `items-section.tsx`
  (body `{code}`), options/attributes/product types (`{code}` in the title), brands/categories (`{slug}` in the title).
- Order dialogs: `areas/orders/order-dialogs.tsx` (mark paid, fulfil, cancel); refund in `areas/payments/payment-dialogs.tsx`. `order.dialog.cancel`
  says "Закрити"/"Close" for three cancel buttons (mark paid, fulfil, refund); every other form dialog says "Скасувати"/"Cancel".
- Order status model (`docs/api/orders.md`): `awaiting_payment -> paid` commits the reservations (sold); nothing moves an order back from `paid`;
  `paid -> cancelled` (admin, with a reason) refunds nothing and restocks nothing. After mark-paid a store payment create answers `order_not_payable`, and
  an `awaiting_customer` attempt is closed with a later success refunded automatically (`docs/api/payments.md`), so a mark-paid never makes a double
  card payment through the shop. `paid -> fulfilled` commits the reservations still held (backordered lines) and is refused `awaiting_stock` while one is
  not on hand.
- Shipment snapshot payer `shop_charge` (ADR 0029): the shop's delivery price was charged in the order.
- Freshness after publish: the storefront reads search-backed lists through a 60 s cache (ADR 0040) and the search index is fed by job 13 on every scheduler
  tick (`SCHEDULER_INTERVAL_SECONDS`, default 60 s); so "within a minute" is not guaranteed: a minute or two is.
- Media tab: `areas/products/tabs/media-tab.tsx`, model `media-list.ts`; each row already has a preview (`BrandLogoPreview`); an uploaded row shows the
  same required "Адреса*" field as a typed one.
- `DataTable` (`packages/ui/src/data-table.tsx`) shows the app's scroll hint above every table below `md` (provided by `layout/shell.tsx`). Measured at
  390 px (orders, `vite dev`): the hint IS rendered, but as a plain grey line right under the grey "Дні читаються…" note, so it reads as part of the filter
  text; the table squeezes its columns (wrapped dates) so the cut-off column is not obvious.
- Mobile header (`layout/shell.tsx`, `language-switch.tsx`, `user-menu.tsx`): at 390 px name + Menu, then the language buttons, the signed-in line and
  account/sign-out take about 200 px.
- Date fields: `lib/date-input-echo.ts` `dateHint` (the echo "Обрано: …") in orders, audit, email messages and the banner form. Chromium draws the field in
  the BROWSER's language (measured: a `uk-UA` page context still shows mm/dd/yyyy), so a hint must not claim the field shows дд.мм.рррр.
- Banner form: `areas/banners/banner-form-view.tsx` (`LocaleText`, `PictureSlotView`), `banner-form.ts` (`validateBannerForm`, `pictureField`), the
  focus helper `firstInvalidBannerField` (`lib/first-invalid.ts`); `useFocusAfterCommit` for focus moves.
- Product create: `product-pickers.tsx` `ProductTypePicker` (label "{name} ({code})", hint already says it cannot change); product type options:
  `areas/catalog-dictionaries/product-type-assignments.tsx` (rows carry `optionCode` only; the picker label is "code - name").
- Search status screen: `areas/search/*`, texts `messages/*/search.json`.

## Findings -> changes

| # | Finding | Change | Files |
| - | ------- | ------ | ----- |
| 1 | "Slug", "SKU" are jargon | uk: "Адреса сторінки" (product, brand, category labels and list column), "Артикул" for SKU in product texts; list search "за адресою сторінки або артикулом"; en: "Page address", SKU stays; help "Адресу (slug)" -> "Адресу сторінки". Code and API names unchanged; e2e labels updated | `messages/*/products.json`, `catalog-dictionaries.json`, `help/content/catalog.ts`, e2e |
| 2 | Delete dialogs show codes; "Закрити" for cancel | Option value / attribute option body and the option, attribute, product type, brand, category titles name the item by its label in the UI language (code only when it has no label). `order.dialog.cancel` -> "Скасувати"/"Cancel" (all three uses are cancels) | `items-section.tsx`, the five pages, messages, e2e |
| 3 | Mark paid irreversible, plainer labels | Warning in the dialog (cannot be undone; stock is written off as sold; a mistake can only be cancelled, money returned outside the shop); "Номер переказу або квитанції"; payer label "Хто платить за доставку" / "Доставку оплачено разом із замовленням" | `order-dialogs.tsx`, `orders.json`, e2e |
| 4 | No word on when a published product shows | Success notice: catalog and search within a minute or two (see "Found") | `products.json` |
| 5 | Upload shows a required "Адреса*" | Rows from an upload (unsaved): an info line "Натисніть «Зберегти зображення», щоб фото з'явилося в магазині"; the address is read-only, labelled "Адреса завантаженого файлу", not required; the preview stays. Typed rows unchanged | `media-list.ts`, `media-tab.tsx`, specs |
| 6 | Hint not seen; header too tall | The hint becomes a visible callout (icon + text, token colours) directly above the table; header below `md`: one row (name + Menu), language and user controls move into the menu panel (same single instances) | `packages/ui/src/data-table.tsx`, `layout/shell.tsx`, specs |
| 7 | mm/dd/yyyy | `dateHint` always gives a format line in the UI language (uk "Формат: дд.мм.рррр…", honest that the browser decides the order) plus the echo | `lib/date-input-echo.ts`, `common.json`, specs |
| 8 | Translating banner texts | "Скопіювати з основної мови ({language})" button under each empty non-default title/text/alt with default text; copies, then focuses the filled field | `banner-form-view.tsx`, `banners.json`, specs |
| 9 | "Client says they paid" | New section in the `orders` article; the order card's help link goes there; mark-paid steps say the field name and that it cannot be undone | `help/content/sales.ts`, `context-help.ts` |
| 10 | Product type on a new product | Link "Немає потрібного типу? Створити тип товару" (the unsaved-changes guard asks before leaving; values are not kept: the text says so); hint reworded; type options: option NAME in the table and picker (names read with `GET /admin/options/{id}`, as the product editor does), hint on shared values | `product-pickers.tsx`, `product-type-assignments.tsx`, messages |
| 11 | Banner main picture | Caption reworded; the missing-main-picture error on the slot: `aria-invalid` on the slot's control, message, focus (failing-first spec) | `banner-form-view.tsx`, `banners.json` |
| 12 | Mark paid on an online order not started | Warning in the dialog only when online payment is on and the order has no payment attempt; worded to the real behaviour (after it the shopper can no longer pay by card; no double charge through the shop) | `order-detail-page.tsx`/`order-dialogs.tsx`, `orders.json` |
| 13 | Fulfil dialog text | Plain, accurate words (when to use it; stock usually already written off at payment; backordered goods written off now or refused) | `orders.json` |
| 14 | Search page jargon | uk/en plain words ("пошукова служба", "ліміт одночасних запитів"), technical names kept in hints; rebuild dialog: one plain sentence of when to use it | `search.json` |
| 15 | Unpublish | Notice and the unpublish dialog: the product page goes at once, catalog lists and search drop it within a minute or two (list cache and index) | `products.json` |
| 16 | Help wording | product-types steps name the buttons; orders: "Номер переказу або квитанції"; shipping/payments/email: developer detail moved to a short "Для розробника" note at the end | `help/content/*.ts` |

## Risks

- Item 6 changes the shell on small screens (desktop unchanged) and the `DataTable` hint markup used by both apps (the storefront does not provide a hint).
- Items 1, 2, 3 change English labels used by the admin e2e (`Slug`, `Payment reference`, `Close`): updated deliberately; the e2e cannot run here.
- Item 10's option names cost one read per allowed option on the product type screen (a handful).
- Item 7: Firefox and Safari may draw date fields differently; the hint says the browser decides.

## Verification

`pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:docs`, `check:env`, `pnpm --filter @fluxkit/theme test`, ui and admin unit tests;
browser checks and screenshots (390 and 1366, uk) under `vite dev` with mocked `/admin/*` answers. Admin e2e: only if services can run here.

## Results

Environment: no Docker; Postgres could not be started (the agent sandbox refuses the switch to the `postgres` user), so the admin e2e and
API integration tests were NOT run (left to CI). Browser checks ran against the admin under `vite dev` (port 3390) with `/admin/*` answered by
Playwright route mocks (a harness outside the repository). Screenshots (uk, 390 and 1366): `repairs-3b-shots/` in the session scratchpad; no
"before" shot of the mark-paid dialog (the first mock of the order was malformed).

| # | Done | Evidence |
| - | ---- | -------- |
| 1 | Labels, hints, list search, help; e2e labels `Slug`/`Slug (part of the address)` -> `Page address` | messages spec, unit tests |
| 2 | `itemName`; seven delete texts use `{name}`; `order.dialog.cancel` "Скасувати"/"Cancel"; e2e `Close` -> `Cancel` | failing first: `dictionary-messages.spec.ts` failed on `Опцію {code}…` before the message change; browser: "Значення «Olena2 Короткий» буде видалено" |
| 3 | Irreversible warning, reference label, payer texts, help steps; e2e `Payment reference` -> `Transfer or receipt number` | failing first: `orders-screen.spec.tsx` failed with the dialog change set aside, passed with it |
| 4, 15 | Publish, unpublish notices and the unpublish dialog: "within a minute or two" | the storefront's product page is also cached 60 s (`CATALOG_REVALIDATE_SECONDS`), so the old "disappears at once" was wrong too |
| 5 | `MediaRow.uploaded`, `markMediaSaved`; read-only address, save hint | specs |
| 6 | Callout hint; header one row below `md` | spec; 390 px: header 61 px instead of about 200 px, no horizontal page scroll on the shot screens |
| 7 | `dateHint` always gives the format line | failing first (new behaviour): `date-input-echo.spec.ts` |
| 8 | Copy button, focus to the filled field | spec; browser: copied, focus on `banner-title-en`, button gone |
| 9 | Help section `customer-says-paid`, order card link | `help-content.spec.ts` |
| 10 | Create-type link (with the not-kept note), hint, option names (`use-option-names.ts`), shared-values hint | specs. (b) the type picker already showed "name (code)"; unchanged |
| 11 | Caption; slot input `aria-invalid` + description, danger frame | failing first: `banner-screens.spec.tsx` failed on the missing `aria-invalid` |
| 12 | `showOnlineNotStartedNote` and the dialog note | failing first: `mark-paid-form.spec.ts` (function missing); browser shot |
| 13 | Fulfil text | messages |
| 14 | Search screen words; e2e `The engine answers` -> `The search service answers` | unit tests |
| 16 | Button names, developer notes at the end (shipping, payments) | `help-content.spec.ts` |

Commands (each exit code read on its own): `pnpm lint` 0, `pnpm format:check` 0, `pnpm typecheck` 0, `pnpm check:boundaries` 0 (2147 modules, 0
violations), `pnpm check:env` 0, `pnpm --filter @fluxkit/theme test` 0 (97), `pnpm --filter @fluxkit/ui test` 0 (220), `pnpm --filter @fluxkit/admin
test` 0 (1914, after `pnpm --filter @fluxkit/admin build`), `pnpm check:docs` 0.

### Decisions outside the plan

- Admin initial JavaScript raw budget 440 000 -> 445 000 (`build-output.spec.ts`): main measured 439 651 raw / 131 228 gzip (349 bytes left), this
  branch 440 412 / 131 421 after trimming the hint icon to a glyph and shortening the date texts. The gzip budget (135 000) is unchanged.
- Item 12 wording differs from the request: "the payment would be double" is not what the shop does (after mark-paid a card payment is refused and
  a late success of an open attempt is refunded automatically), so the note says the customer can no longer pay by card.
- Item 7: the format line does not claim the field shows дд.мм.рррр (Chromium draws it in the browser's language: measured mm/dd/yyyy in a `uk-UA`
  page); it says that in mm/dd/yyyy the month comes first.
- Item 15 also corrects item 4's first wording (the product page is cached 60 s too).
- Item 16 also moved the Monobank simulator note of the payments article; the email article's Resend note is unchanged.
- Brand and category slug labels changed with the product's (item 1) for one word across the admin.

### Review fixes (independent review of PR 235: no blocker) and the first CI e2e run

| Finding | Fix |
| ------- | --- |
| M1 the payer text claimed delivery was paid (also on unpaid orders) | "Доставка входить у суму замовлення" / "Delivery is part of the order total" |
| m1 HANDOFF state | PR 235 entry, "Last updated", the gzip headroom note |
| m2 the card note hid after failed or expired attempts | `showNoCardPaymentNote`: online payment on and no attempt `succeeded`, `creating`, `processing` or `create_unknown`; "no card payment has succeeded"; spec failed first (function missing, and the old rule hid it after a failed attempt) |
| m3 copy button name (WCAG 2.5.3) | visible text first, the field in a visually hidden part, no `aria-label`; spec |
| m4 duplicate option names hook | `use-option-definitions.ts` moved to `catalog-dictionaries/` and used by the product type screen and the product editor; a failed read shows a note and Retry; `use-option-names.ts` deleted |
| m5 one callout per table | only the first marked hint of the page is shown (`isFirstScrollHint`, a layout effect); 390 px order page: 2 tables, 1 callout |
| m6 date format texts | "Порядок задає ваш браузер, наприклад мм/дд/рррр: спочатку місяць." / "Dates use your browser's format, for example mm/dd/yyyy (month first)." |
| m7 docs | `docs/files/admin.md` (`ACCOUNT_PANEL_ID`, the moved hook), e2e README |
| m8 `{code}` carried names | `{name}` in the three option assignment labels |
| m9 error read twice | the slot group refers to the message only when it has no upload input; uk "Відмовлено" for both refused-search lines |
| CI e2e `dictionaries.e2e.ts` | the picker label is now "name (code)" on purpose (item 10): the test selects "Finish <u> (finish_<u>)"; the select was disabled only while its list loaded (as before; spec shows it enabled once loaded) |
| CI e2e `search.e2e.ts` | "The search service answers" is also in the intro: matched with `exact: true` (two places) |

Admin initial JavaScript after the fixes: 440 712 raw, 131 534 gzip (budgets 445 000 and 135 000).
