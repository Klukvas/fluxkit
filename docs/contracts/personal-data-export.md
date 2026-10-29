# Contract: personal data export

Status: draft. The document builder is implemented in `packages/core/src/privacy/export.ts` (ADR 0033 decision 7, privacy plan step 3); no route serves it yet (plan steps 6 and 7). Since version: unreleased.

## Format `fluxkit.personal-data-export/v1`

JSON, UTF-8. The top-level keys appear in this order: `format`, `generatedAt`, `subject`, `account`, `orders`, `mail`, `sessions`, `cart`, `processors`.

| Key | Shape |
|---|---|
| `format` | the string `fluxkit.personal-data-export/v1` |
| `generatedAt` | ISO 8601 UTC string |
| `subject` | `{kind: "customer" \| "email"}` |
| `account` | the customer's `email`, `firstName`, `lastName`, `phone`, `isActive`, `emailVerifiedAt`, `lastLoginAt`, `passwordChangedAt`, `createdAt`, `updatedAt`; `null` for a guest subject |
| `orders[]` | `number`, `status`, `locale`, `currency`, amounts (`subtotalAmount`, `shippingTotal`, `discountTotal`, `taxTotal`, `totalAmount`, minor-unit integers), times (`placedAt`, `expiresAt`, `paidAt`, `fulfilledAt`, `cancelledAt`, `expiredAt`), `cancellationReason`, `paymentReference`, `contact` (`email`, `phone`, `firstName`, `lastName`; all `null` on an erased order), `shippingAddress` and `billingAddress` (`countryCode` plus the address fields; only `countryCode` on an erased order), `lines[]`, `adjustments[]`, `shippingMethod`, `shipments[]`, `payments[]` (with `refunds[]`), `statusHistory[]` |
| `mail[]` | `templateKey`, `locale`, `status`, `createdAt`, `sentAt` (no body is stored, so none is exported) |
| `sessions[]` | `createdAt`, `lastSeenAt` |
| `cart` | `{lines: [{sku, title, quantity, seenUnitAmount, seenCurrency}]}` or `null` |
| `processors[]` | `{kind: "email" \| "payment" \| "shipping", name}` of the providers the shop uses; no legal role is stated |

## Rules

- Times are ISO strings; money is a minor-unit integer next to a currency code; absent values are `null`, never omitted (except optional address fields).
- Never present at any depth: password and token hashes, `accessTokenHash`, `requestFingerprint`, idempotency keys, `providerRef`, `providerPaymentId`, `redirectUrl`, admin ids and `createdBy`, lockout counters, any key ending in `Id`. The builder copies only the keys above; `findForbiddenExportKeys` is the scanner the tests (and later the API specs) use.
- A change of an existing key or meaning is a new format version (`v2`) served next to `v1`; adding a key is a minor change.
- TODO(fluxkit): legal review of the content (plan task O4) before an EU launch.
