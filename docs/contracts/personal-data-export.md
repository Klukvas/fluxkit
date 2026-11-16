# Contract: personal data export

Status: draft. The document builder is implemented in `packages/core/src/privacy/export.ts` (ADR 0033 decision 7, privacy plan step 3); `GET /store/account/data-export` and `POST /admin/privacy/requests/{id}/export` serve it (plan step 6, `docs/api/privacy.md`). Since version: unreleased.

## Format `fluxkit.personal-data-export/v1`

JSON, UTF-8. The top-level keys appear in this order: `format`, `generatedAt`, `subject`, `account`, `orders`, `mail`, `emailSuppressions`, `sessions`, `cart`, `processors`.

| Key | Shape |
|---|---|
| `format` | the string `fluxkit.personal-data-export/v1` |
| `generatedAt` | ISO 8601 UTC string |
| `subject` | `{kind: "customer" \| "email"}` |
| `account` | the customer's `email`, `firstName`, `lastName`, `phone`, `isActive`, `emailVerifiedAt`, `lastLoginAt`, `passwordChangedAt`, `createdAt`, `updatedAt`; `null` for a guest subject |
| `orders[]` | `number`, `status`, `locale`, `currency`, amounts (`subtotalAmount`, `shippingTotal`, `discountTotal`, `taxTotal`, `totalAmount`, minor-unit integers), times (`placedAt`, `expiresAt`, `paidAt`, `fulfilledAt`, `cancelledAt`, `expiredAt`), `cancellationReason`, `paymentReference`, `contact` (`email`, `phone`, `firstName`, `lastName`; all `null` on an erased order), `shippingAddress` and `billingAddress` (`countryCode` plus the address fields; only `countryCode` on an erased order), `lines[]`, `adjustments[]`, `shippingMethod`, `shipments[]`, `payments[]` (with `refunds[]`), `statusHistory[]` |
| `mail[]` | `templateKey`, `locale`, `status`, `createdAt`, `sentAt` (no body is stored, so none is exported) |
| `emailSuppressions[]` | `reason`, `sourceProvider`, `firstSeenAt`, `lastSeenAt` in verified address scope only; no repeated address, entry ID, receipt or event key |
| `sessions[]` | `createdAt`, `lastSeenAt` |
| `cart` | `{lines: [{sku, title, quantity, seenUnitAmount, seenCurrency}]}` or `null` |
| `processors[]` | `{kind: "email" \| "payment" \| "shipping", name}` of every currently configured primary/fallback email provider in chain order and configured payment/shipping providers; no legal role, account identity or credential is stated |

## Rules

- Times are ISO strings; money is a minor-unit integer next to a currency code; absent values are `null`, never omitted (except optional address fields).
- Never present at any depth: password and token hashes, `accessTokenHash`, `requestFingerprint`, idempotency keys, `providerRef`, `providerPaymentId`, `redirectUrl`, admin ids and `createdBy`, lockout counters, any key ending in `Id`. The builder copies only the keys above; `findForbiddenExportKeys` is the scanner the tests (and later the API specs) use.
- A change of an existing key or meaning is a new format version (`v2`) served next to `v1`; adding a key is a minor change.
- TODO(fluxkit): legal review of the content (plan task O4) before an EU launch.

- Shared email suppression is address-scoped (ADR 0056): verified customer address or an operator email-subject request only. An unverified account exports an empty `emailSuppressions` list and cannot erase the global block. No webhook receipt is exported. This additive field retains v1.

- `processors` enumerates the complete configured email chain even if a fallback has not accepted this subject's mail. Configuration is not a per-message delivery history; removed historical processors cannot be reconstructed from this list. Actual accepting provider, pins/routes, cooldown/probe tokens, usage comparisons, account identities and secrets are not added to `mail` or the export. The advisory retained usage meter never changes subject scope, erasure or retention.
