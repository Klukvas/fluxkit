# packages/core

Pure TypeScript domain logic of the catalog (ADR 0006, AGENTS.md section 2.3), of admin authentication rules (ADR 0009) of money and price rules (ADR 0011), of stock (ADR 0011), of the cart (ADR 0015) and of orders (ADR 0017). Rules only: no Nest, no Drizzle, no database, no network, no filesystem, no clock (time is a parameter). Enforced by dependency-cruiser (`core-must-not-import-infrastructure`). The one runtime dependency is `zod`, used only by `attribute-values.ts`.
The API (`apps/api`) reads facts from the database, calls these functions inside a transaction, and maps the results to HTTP problems. Core never decides HTTP status codes.

- `package.json` - `@fluxkit/core`, private; runtime dependency `zod` only; devDependencies typescript and vitest.
- `src/index.ts` - public entry; re-exports `./auth/index.js`, `./cart/index.js`, `./catalog/index.js`, `./inventory/index.js`, `./orders/index.js` and `./pricing/index.js`. Must not export anything else.
- `src/catalog/index.ts` - barrel of the catalog modules below. Add new modules here.

## Entities and shared types

- `src/catalog/types.ts` - plain data shapes (`I18nText`, `AttributeDefinition`, `ProductTypeDefinition`, `OptionDefinition`, `VariantSnapshot` (carries `hasShopPrice`, a fact the API supplies), `ProductSnapshot`, `CategoryNode`, `LocaleConfig`). Must not carry ORM or framework types; the API maps rows to these and back.
- `src/catalog/limits.ts` - `CATALOG_LIMITS` (options per product 3, values per option 30, variants 250, depth 5, page size 100, offset 10 000, ...), `TEXT_LIMITS`, `ATTRIBUTE_VALIDATION_DEFAULTS`, code patterns and `isValidCode` / `isValidValueCode`. Must not read configuration; limits are constants.
- `src/catalog/text-safety.ts` - `hasJsonbUnsafeCharacters` (exported): NUL and unpaired surrogates, which Postgres rejects or the driver silently replaces. Turns a 500 into a field error; the admin schemas use it for every free-text column (barcode, URLs, unit).

## Text, slugs, SKUs

- `src/catalog/i18n.ts` - `validateI18nText` (shape, default locale required, allowed locales, length), `resolveText` (requested locale, else default; per field), `codePointLength`.
- `src/catalog/slug.ts` - `validateSlug`, `isValidSlug`, `transliterateUkrainian` (KMU resolution 55/2010), `slugify`, `slugLookupPrefix` (the prefix a caller queries taken slugs with; not the plain slug, because the candidates of a 160 character slug are `base158-2`, ...), `generateUniqueSlug` (slugifies the title and adds `-2`, `-3` against the set of taken slugs the caller passes in; it must contain every taken slug that starts with `slugLookupPrefix(title)`). Must not query the database for collisions itself.
- `src/catalog/sku.ts` - `normalizeSku` (trim, uppercase), `validateSku`, `proposeSku` / `proposeSkus` (`<SLUG>-<VALUE_CODE>...` uppercased, skipping SKUs in the taken set the caller passes in).

## Attributes and values

- `src/catalog/attribute-defaults.ts` - `normalizeAttributeDefinitionInput`: defaults (`isLocalized` only for text, `isVisibleOnStorefront` is `!isInternal`) and definition consistency errors (for example `internal_cannot_be_public`).
- `src/catalog/attribute-values.ts` - `parseAttributeValidation` and `validateAttributeValues`: validates product or variant attribute values against definitions, in draft mode (required not enforced) or publish mode. Only file in core that uses `zod`. Must not accept unknown keys silently.
- `src/catalog/store-attributes.ts` - public view of attributes: `isPublicAttribute`, `selectPublicAttributes`, `publicAttributeDefinitions`. The one allowlist deciding what the store API may expose (visible on storefront and not internal). Must not be bypassed; the store serializer feeds it and never filters itself.

## Options and variants

- `src/catalog/variants.ts` - `computeOptionSignature` (sorted `code=value` pairs joined with `;`; internal), `generateVariants` (cartesian product, skips existing combinations, enforces limits), invariant checks (`checkExactlyOneDefault`, `checkOptionCoverage`, `checkUniqueSignatures`, `checkSignatureConsistency`, `checkVariantInvariants`).
- `src/catalog/variant-rules.ts` - `canDeleteVariant` (draft only, not the last, not the default, no stock history: `has_stock_history`, ADR 0013, and no order line: `has_order_lines`, ADR 0020), `canRebuildVariants` (refuses an option change that rebuilds all variants while any variant has stock history, ADR 0014, or an order line, ADR 0020), `canCreateVariantManually` (draft only).
- `src/catalog/sellable.ts` - `isVariantSellable({productStatus, variantIsActive, hasShopPrice})`: the one rule for "can be bought" that the store listing and `ReservationsService.reserve` both follow. Pure; must not know about SQL.
- `src/catalog/product-option-change.ts` - `planProductOptionChange`: what a change of a product's options and chosen values does (works on ids, returns a plan; the service applies it in one transaction).

## Categories

- `src/catalog/category-tree.ts` - `depthOf`, `subtreeHeight`, `wouldCreateCycle`, `validateMove`, `validateNewNode`, `validateTree`: depth 5, no cycles, existence of parent or node. Pure; takes the whole tree as input.
- `src/catalog/category-assignments.ts` - `normalizeCategoryAssignments` (exactly one primary when a product has categories), `promotePrimaryAfterRemoval`.

## Lifecycle, rules and type changes

- `src/catalog/lifecycle.ts` - `canTransition` (draft, active, archived), `canHardDelete` (never published), `publishPreconditions` (every violation at once: title, slug, default variant, active variant, option coverage, SKU, required attributes, allowed options, `price_missing` for every active variant whose snapshot has `hasShopPrice: false`; inactive variants never trigger it).
- `src/catalog/publish-timestamp.ts` - `nextPublishedAt`: set on the first publish, never moved. Takes `now` as a parameter.
- `src/catalog/type-change-rules.ts` - `decide*` functions for ADR 0006 section 5 (code, input type, localization, unit, level, attribute and option removal, product type change, option change on products). Each takes facts the service read from the database and returns `allowed` or a reason code. Must not read anything itself.

## Admin authentication rules (ADR 0009)

Pure decisions only: no hashing, no cookies, no random numbers, no clock (`now` is a parameter). The API does the I/O (scrypt, sessions, database) and calls these.

- `src/auth/index.ts` - barrel of the auth modules below. Add new modules here.
- `src/auth/roles.ts` - `ROLES` (`owner`, `manager`, `viewer`), `PERMISSIONS` (`catalog.read`, `catalog.write`, `catalog.publish`, `users.manage`, `orders.read`, `orders.write`, `customers.read`, `customers.write`), frozen `ROLE_PERMISSIONS` (owner all; manager all but `users.manage`; viewer `catalog.read` only, because orders and customers hold personal data), `isAdminRole`, `isAdminPermission`, `permissionsOf` (frozen copy), `hasPermission`. Unknown role or permission strings (also `__proto__`, `constructor`) never grant anything. The one place roles are defined.
- `src/auth/password-policy.ts` - `PASSWORD_LIMITS` (12 to 128 code points), `validatePassword`: `too_short`, `too_long`, `equals_email`, `not_a_string`, `contains_nul`. No composition rules. Must not hash.
- `src/auth/email.ts` - `normalizeEmail` (trim, lower-case; the stored form), `validateEmail` (a small format check, not the RFC; returns the normalized email).
- `src/auth/lockout.ts` - `LOCKOUT_DEFAULTS` (5 failures, 15 minutes), `isLocked`, `registerFailedLogin`, `registerSuccessfulLogin`. Returns the new counter and lock; does not write them.
- `src/auth/session.ts` - `SESSION_DEFAULTS` (720 idle minutes, 168 hours), `CUSTOMER_SESSION_DEFAULTS` (43 200 idle minutes = 30 days, 2 160 hours = 90 days; ADR 0016) and `SESSION_BOUNDS` (at most one year for either limit; `@fluxkit/config` repeats the numbers, a test in apps/api asserts they agree; customers reuse `evaluateSession`, `normalizeEmail`, the password policy and the lockout rules unchanged), `evaluateSession` (`idle_timeout`, `max_lifetime`, `invalid_session`; a limit reached exactly is expired), `shouldTouchSession` (at most once a minute), `sessionExpiry`. Must not read the clock.
- `src/auth/user-rules.ts` - `decideUserChange`: the last active owner cannot be demoted or deactivated; unknown roles are rejected. The caller passes the active owner ids read in the same transaction.

## Money (ADR 0011)

Pure and dependency-free: integers and BigInt only, no float arithmetic for anything rounded or multiplied, no clock, no randomness, never `-0`. Data errors are typed results; only misconfiguration throws `RangeError`. The API and later modules must not do their own money arithmetic or rounding.

- `src/pricing/index.ts` - barrel of the pricing modules below. Add new modules here.
- `src/pricing/currency.ts` - `CURRENCIES` (UAH, USD, EUR, PLN, GBP, CZK, CHF, CAD: 2; JPY: 0; KWD: 3), `CURRENCY_CODES`, `SupportedCurrency`, `isSupportedCurrency` (exact, own-property check), `exponentOf`. Must not read configuration; the shop currency is validated elsewhere against this table.
- `src/pricing/limits.ts` - `MAX_AMOUNT` (10^12 minor units), `MAX_QUANTITY` (1 000 000), `BASIS_POINTS_PER_UNIT` (10 000), `MAX_PERCENTAGE_BASIS_POINTS` (1 000 000). Constants only.
- `src/pricing/money.ts` - `Money`, `createMoney`, `addMoney`, `subtractMoney`, `multiplyByQuantity`, `compareMoney`, `negateMoney`, `isZero`, `percentageOf` (modes `half_away_from_zero` default, `half_even`, `floor`, `ceil`), `toDecimalString`, `parseDecimalString`. Must not accept floats, mix currencies, exceed the limit or know about prices (non-negative prices are a price rule, not a money rule).
- `src/pricing/price.ts` - `Price`, `validatePrice` (integer amount 0 to `MAX_AMOUNT`, supported currency, optional compare-at strictly greater than the amount; typed reasons incl. `negative_amount`, `compare_at_not_greater`), `pickSellablePrice` (the price in the shop currency or `no_price_in_shop_currency`; never converts or picks another currency; a duplicate or invalid stored price is a `RangeError`). Must not do arithmetic or know about the database.

## Stock rules (ADR 0011)

Pure decisions over one `inventory_level`; the API calls them under the row lock and writes the result and the journal row in one transaction. Bad caller data (a quantity, a reservation in the wrong state) is a typed refusal; corrupt stored data (negative level, unknown status, bad flags) is a `RangeError`.

- `src/inventory/index.ts` - barrel of the inventory modules below. Add new modules here.
- `src/inventory/limits.ts` - `MAX_ON_HAND` (10^9) and `MAX_RESERVED` (the same bound for the reserved total of a level). Constants only.
- `src/inventory/types.ts` - `StockFlags`, `StockLevel`, `StockReservation`, `ReservationStatus`, `StockMovement`, `StockMovementKind` and the `assertValid*` guards. Must not carry ORM types.
- `src/inventory/availability.ts` - `availabilityOf(flags, levels, lowStockThreshold)`: `in_stock`, `low_stock` or `out_of_stock` from the sum of `max(0, onHand - reserved)`; never exposes a quantity.
- `src/inventory/decisions.ts` - `decideReserve` (refuses `insufficient_stock` unless backorder, `not_tracked`, `reserved_out_of_range` above `MAX_RESERVED`), `decideRelease`, `decideExpire` (lower `reserved` only), `decideCommit` (lowers `onHand` and `reserved`, yields a `sale` movement with a negative delta), `decideAdjustment` (delta or `setOnHand`; refuses a result below 0, a change that lowers on hand below `reserved` (a raise is always allowed, so partial receipts reduce a backorder), a zero change, receipts or returns that remove stock). `decideExtend` (moves the expiry of an `active` reservation later; the same time is accepted, an earlier one is `would_shorten`; `not_active`, `already_committed`, `invalid_expiry`; changes no level). A reservation leaves `active` once: `committed`, `released` or `expired`. Must not read the clock or a database.

## Cart rules (ADR 0015)

Pure and dependency-free like the money module: money only through `src/pricing/money.ts`, no clock, no I/O, inputs never mutated, outputs frozen. Bad caller input (a quantity from a request) is a typed refusal; a stored cart that breaks the rules (duplicate variants, quantity 0, 101 lines) or a corrupt fact is a `RangeError`.

- `src/cart/index.ts` - barrel of the cart modules below. Add new modules here.
- `src/cart/limits.ts` - `MAX_CART_LINES` (100) and `MAX_LINE_QUANTITY` (999). Constants only; not a public contract.
- `src/cart/lines.ts` - `CartLine` (`variantId`, `quantity`, `seen` unit price or `null`), `addLine`, `setLineQuantity`, `removeLine` (`invalid_quantity`, `quantity_limit` (never a silent cap), `too_many_lines`, `line_not_found`), `mergeCarts` (customer lines first, one line per variant, quantities added and capped at 999 with notice `quantity_capped`, guest-only lines beyond 100 dropped with notice `lines_dropped`; `seen` keeps the older customer price). Must not know about the database or the clock.
- `src/cart/pricing.ts` - `priceCart(currency, lines)`: from per-line facts (`sellable`, `currentPrice`, `availability`, `seen`) to unit price, compare-at, line total (`multiplyByQuantity`), notices (`price_changed {previousAmount}`, `unavailable`, `out_of_stock`), subtotal (`addMoney`, unavailable lines left out), `itemCount` and `purchasable`. A price in another currency is never mixed in (the line is `unavailable`). Overflow is the typed refusal `line_total_out_of_range` (with every offending index) or `subtotal_out_of_range`, never a clamp.

## Order rules (ADR 0017)

Same conventions as the cart. Statuses, transitions and totals are decided here; the API reads the facts, writes the result and records the journal.

- `src/orders/index.ts` - barrel of the order modules below. Add new modules here.
- `src/orders/totals.ts` - `computeOrderTotals(lines, adjustments)` -> `subtotal`, `shippingTotal`, `discountTotal`, `taxTotal`, `total`. Adjustments (`shipping` and `tax` not negative, `discount` not positive, plugin kinds any sign, kind is a code) that are `includedInPrice` are reported in their kind total but not added. Refusals: `no_lines`, `currency_mismatch`, `invalid_adjustment` (with the position), `subtotal_out_of_range`, `adjustments_out_of_range`, `total_out_of_range`, `negative_total`. Must not round or use floats.
- `src/orders/snapshot.ts` - `buildOrderLine(facts, {defaultLocale, locales})`: validates ids, SKU, full i18n maps, option values, image URL (http or https), price, quantity (1 to 999) and the shipping flag, computes the line total and returns a deep-frozen copy; typed refusals per field, `line_total_out_of_range` for an overflow. Must not read the catalog itself.
- `src/orders/status.ts` - `ORDER_STATUSES`, `ORDER_ACTORS`, the transition table `ORDER_TRANSITIONS` (data, deeply frozen), `decideTransition(from, to, actor)` (`invalid_transition`, `not_allowed_for_actor`; `from` is `null` for creation), `stockEffectOf(from, to)` (`reserve`, `commit`, `release`, `none`), `isTerminalStatus`. Must not touch the database or reservations.
- `src/orders/number.ts` - `formatOrderNumber(bytes)` (exactly 5 random bytes -> `XXXX-XXXX`, Crockford base32 without I, L, O, U), `parseOrderNumber(text)` (lower case, missing dash, O/I/L look-alikes forgiven; everything else `invalid_order_number`), `ORDER_NUMBER_PATTERN`. Must not generate randomness.
- `src/orders/contact.ts` - `normalizePhone` (optional `+`, 7 to 15 digits, never guesses a country), `validatePersonName`, `validateAddress` (generic structured address, every error at once, unknown fields refused, no country-specific rule), `shippingAddressRequired(lines)`, `CONTACT_LIMITS`.
- `src/orders/expiry.ts` - `orderExpiresAt(placedAt, ttlMinutes)`, `reservationExpiresAt(orderExpiry)` (+10 minutes), `backorderHoldUntil(now)` (+`BACKORDER_HOLD_DAYS`, 365), `guestAccessExpiresAt`, `isGuestAccessValid(createdAt, now, days)`, `isGuestAccessCurrent(accessExpiresAt, now)` (the one boundary rule for a stored expiry) and the configured ranges.
- `src/orders/events.ts` - types and constants only (ADR 0018): `ORDER_EVENT_TYPES`, `CUSTOMER_EVENT_TYPES`, `orderEventTypeFor(status)`, `buildOrderEventPayload` (order id, number and status, nothing else), `DOMAIN_EVENT_HANDLER_METADATA` with `domainEventHandlerMetadata(types)` (validated value for `SetMetadata`), `DOMAIN_EVENT_TYPE_PATTERN` and the handler types `DomainEventHandler` / `DomainEventEnvelope` (`docs/contracts/events.md`), the `OrderPaymentsPort` interface with `MarkPaidRequest` / `MarkPaidOutcome` and its token `ORDER_PAYMENTS_PORT`. The dispatcher is `apps/api/src/jobs/`; the read port (`OrderReadPort`) comes with the admin orders step. Takes `now` as a parameter; a value outside its range is a `RangeError`.

## Test-only and tests

- `src/catalog/test-support.ts` - `deepFreeze` for tests; excluded from the build (`tsconfig.build.json`). Must not be imported by the API.
- `src/auth/*.spec.ts`, `src/cart/*.spec.ts`, `src/catalog/*.spec.ts`, `src/orders/*.spec.ts`, `src/pricing/*.spec.ts`, `src/inventory/*.spec.ts` - Vitest unit tests next to each module (rules and edge cases); `src/pricing/money.property.spec.ts` compares rounding, arithmetic and decimal strings with independent BigInt references on tens of thousands of cases from a seeded generator (no `Math.random`); `src/inventory/decisions.property.spec.ts` runs seeded random sequences of reserve, release, expire, commit and adjustment and checks that on hand and reserved never go negative, reserved stays within on hand without backorder, on hand equals the sum of journal deltas and availability matches an independent reference; `src/orders/totals.property.spec.ts` compares the order totals and every refusal with an independent BigInt reference on 30 000 seeded random orders; `src/orders/status.spec.ts` checks the whole start state x target x actor matrix against a literal copy of the plan table; `src/orders/number.spec.ts` round-trips 20 000 seeded order numbers against a bit-reading reference; `src/index.spec.ts` checks the public entry point.
