# Email templates (extension point)

How a feature or a plugin adds a transactional mail, or replaces a built-in one (ADR 0031 decision 14, email plan step 5). Status: stable from the first release that contains it (unreleased, pre-1.0). The types are in `@fluxkit/core` (`packages/core/src/email/template.ts`); the API side is `apps/api/src/email/templates/`.

## Registering a template

A template is a Nest provider in any module of the application (a feature's own module, so it disappears with the feature):

```ts
@Injectable()
@SetMetadata(EMAIL_TEMPLATE_METADATA, emailTemplateMetadata("wishlist.back_in_stock"))
export class BackInStockTemplate {
  readonly template: EmailTemplate<BackInStockVariables> = { key, version: 1, category: "order", variablesSchema, sampleVariables, render };
  readonly catalogs = { uk: { "wishlist.back_in_stock.subject": "..." }, en: { "wishlist.back_in_stock.subject": "..." } };
}
```

| Member | Rule |
|---|---|
| metadata | `EMAIL_TEMPLATE_METADATA` (`"fluxkit:email-template"`) with `emailTemplateMetadata(key, { override? })`; the key equals `template.key` |
| `template.key` | `EMAIL_TEMPLATE_KEY_PATTERN` (`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`), at most 64 characters; a feature uses its own first segment |
| `template.version` | whole number from 1; raise it whenever the output for the same variables changes (also after reformatting an `html` literal: Prettier changes its bytes). A queued mail renders only with the version it was enqueued with; a mail of another version fails `template_unavailable` (an admin resends it) |
| `template.category` | `account` or `order`: chooses the footer text and the provider tag |
| `template.variablesSchema` | an object with `safeParse` (a strict zod object fits); checked when the mail is enqueued and again when it is rendered |
| `template.sampleVariables` | pass the schema; rendered at startup in every required locale and by the admin preview (plan step 9) |
| `template.render(variables, context)` | pure, synchronous, deterministic (the same input gives the same bytes: the provider refuses another body under the same idempotency key); returns `{subject, html, text}`: `html` built with the core `html` tag (`SafeHtml`), a non-blank plain-text `text`, a subject (sanitized by the API: header-safe, at most 200 code points) |
| `catalogs` | locale to texts; at least `uk` and `en`; every locale has the same keys; every key is `<template key>.<name>` with lower-case segments; no text is blank |

`context` (`EmailRenderContext`): `locale` (the mail's), `messages` (the template's texts of the resolved locale plus the layout's `layout.*` texts), `theme` (`EmailTheme`: the resolved `emailTheme` values of `@fluxkit/theme`), `links` (`storefront`, and `action` or `null`: built by the API from `STOREFRONT_PUBLIC_URL`), `shopName` (the display name of `EMAIL_FROM`, or `null`).

## What the API does with it

- **Startup** (`EmailTemplateRegistry`, `DiscoveryService`): every marked provider is checked (the rules above, core `checkEmailTemplateDefinition`, the sample variables rendered twice in `uk` and `en` with and without a shop name, core `checkEmailRenderOutput`). Any problem, a second template of a key without `override: true`, two overrides of one key, or an override of a key nobody registers stops the startup with the provider's class name.
- **Override:** `emailTemplateMetadata(key, { override: true })` replaces the template of that key (a built-in or a feature's). Use it in a client fork instead of editing a built-in.
- **Layout:** the API wraps `html` in the built-in table layout (header with the shop name, footer saying why the person got the mail, a link to the storefront) and appends the footer to `text`. The layout takes colors, fonts, sizes and spacing from `emailTheme` only; a rebrand changes the tokens and the catalogs, never a template.
- **Locale:** the requested locale's texts when the template and the layout have them, else `DEFAULT_LOCALE`'s, else the first in sorted order.
- **Escaping:** every value printed through the `html` tag is escaped; `unsafeRawHtml` is for fixed markup of the template itself, never a variable (the built-in sources do not use it at all, `template-sources.spec.ts`).

## Built-in keys

| Key | Category | Variables | Link (`context.links.action`) | Sent when |
|---|---|---|---|---|
| `admin.test` | account | `{providerCode}` | none | the admin test send (plan step 9) |
| `customer.password_reset` | account | `{tokenId}` (the token row id; never the token) | `{STOREFRONT_PUBLIC_URL}/{locale}/account/reset-password#t=<token>`, the token derived at render time | `POST /store/account/password-reset` for an active account (email plan step 7) |
| `customer.password_changed` | account | `{}` | none | a successful reset confirmation |
| `customer.verify_email` | account | `{tokenId}` | `{STOREFRONT_PUBLIC_URL}/{locale}/account/verify-email#t=<token>` | registration and `POST /store/account/verify-email/resend` |

An override of `customer.password_reset` or `customer.verify_email` must print `context.links.action` (the page the token is for) and must not print `tokenId`.

### Order and shipment mails (email plan step 8)

Category `order`. The variables are frozen when the mail is enqueued: ids, the order number, minor units with the currency code, and texts already resolved for the order's locale (cut to 100 code points). Money is formatted at render time (`1234.56 UAH`, `1500 JPY`, `12.345 KWD`: the exact decimal of the currency's exponent plus the ISO code, no symbol, no float math); times as `YYYY-MM-DD HH:mm UTC`. An override keeps the variable shape (the same schema) and may restyle or reword everything else.

| Key | Variables | Link (`context.links.action`) | Sent when |
|---|---|---|---|
| `order.placed` | `orderNumber`, `currency`, `lines` (at most 12 of `{title, variantTitle, quantity, lineTotal}`), `moreLines`, `subtotal`, `shipping`, `discount` (the amount taken off, 0 when none), `total`, `delivery` `{methodTitle, pickupPoint {number, city, description}, city}`, `payBefore` (ISO instant while the order awaits payment, else `null`) | guest: `{STOREFRONT_PUBLIC_URL}/{locale}/order/{number}#t=<token>`, the token derived at render time from `ORDER_TOKEN_SECRET`, the order id and the order's stored idempotency key (ADR 0023; never stored in the outbox); customer: `{STOREFRONT_PUBLIC_URL}/{locale}/account/orders/{number}`; `null` for an order whose account was deleted | domain event `order.placed` |
| `order.paid` | `orderNumber`, `currency`, `total` | as `order.placed` | `order.paid` |
| `order.cancelled` | `orderNumber` | none | `order.cancelled` |
| `order.expired` | `orderNumber` | none | `order.expired` |
| `shipment.created` | `orderNumber`, `carrierTitle` (the shipping method's title of the order snapshot, or `null`), `trackingNumber` | as `order.placed` | `shipment.created` (the carrier accepted the waybill) |

Rules for all of them:
- **One row per event and template:** `dedupe_key = <eventId>:<template key>`, so a redelivered event makes no second mail. `order.fulfilled`, `shipment.status_changed` and `shipment.cancelled` send nothing in v1.
- **Recipient** is the order's contact email (a guest's or a customer's; an order of a deactivated or deleted account still gets its mails), `recipient_kind` is `guest` when the order has a guest token and `customer` otherwise, the locale is the order's. An order without an address, an address no mail header can carry (non-ASCII) and `EMAIL_PROVIDER=none` enqueue nothing (a code-only log).
- **Guest link:** the API derives it while rendering and checks that the derived token's hash equals the order's stored hash; a mismatch (the secret changed since checkout) fails the mail `render_failed` instead of sending a link that opens nothing. A temporary database failure while reading the order retries the mail (it is not recorded `failed`).
- An override of an order template must print `context.links.action` when it is not `null` and must not print any variable the schema does not list.

## Not part of the contract

The outbox (`email_message`), the sender, the jobs and the provider port are internal (ADR 0031 decision 3); a feature enqueues mail through the API's `EmailOutbox` only once a public enqueue hook is listed here.
