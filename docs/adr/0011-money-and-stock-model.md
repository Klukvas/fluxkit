# 0011. Money and stock model

Status: accepted 2026-10-16 (owner decisions and the assumptions of `docs/plans/2026-10-16-pricing-and-inventory.md`, approved the same day). Refines the money and inventory parts of ADR 0004.

## Context

- ADR 0004 fixed "integer minor units plus a currency code, never floats" and left the details open: the range, the rounding rules, the text form, the JSON shape, tax rounding.
- The pricing and inventory plan needs one module that owns these rules before any price or stock row exists. Money bugs are expensive and silent, so the rules are decided once, tested against an independent reference, and reused by cart, checkout and orders later.

## Decision

### Money
- **Shape**: `Money = { amount: integer, currency: ISO 4217 code }`. The amount counts minor units (kopiykas, cents, yen). Never a float, never a string of major units, never stored as major units.
- **Range**: `|amount| <= 1_000_000_000_000` (`MAX_AMOUNT`, 10^12 minor units, 10 billion major units for a two-decimal currency). Reason: every value is an exact JavaScript number (below 2^53), the sum of two values is still exact before it is range-checked, and it fits a Postgres `bigint` and a JSON number without loss. Products and percentages are computed with BigInt and range-checked afterwards (the intermediate can reach 10^18).
- **Sign**: the money module allows negative amounts (adjustments, discounts as lines, refunds). A price is non-negative: that rule belongs to the price rules and the database constraint (step 2 and 3 of the plan), not to the money type. Negative zero never exists: every function returns `+0`.
- **Quantity**: an integer from 0 to `MAX_QUANTITY` (1 000 000) per line.
- **Currencies**: a table in core with ISO 4217 exponents: UAH, USD, EUR, PLN, GBP, CZK, CHF, CAD (2), JPY (0), KWD (3). The lookup is an own-property check, so `__proto__`, `constructor` and `toString` are not currencies; codes are exact upper case. Adding a currency is a one-line change in `packages/core/src/pricing/currency.ts`; a code outside the table is a data error (`unsupported_currency`), a table lookup with a code outside it is a `RangeError` (misconfiguration).
- **Rounding**: only percentages round. A percentage is an integer count of basis points (10 000 = 100 %) from 0 to 1 000 000 (100x, a larger factor is a caller bug). `percentageOf(money, basisPoints, mode)` computes `amount * basisPoints / 10 000` with BigInt and rounds with one of four modes: `half_away_from_zero` (default; symmetric: 2.5 becomes 3, -2.5 becomes -3), `half_even` (banker's rounding, also symmetric), `floor` (toward negative infinity) and `ceil` (toward positive infinity). The default matches what shoppers and accountants expect for retail prices; the other modes exist because the later pricing pipeline (discounts, taxes) may need them. Add, subtract and multiply by an integer quantity are exact and never round.
- **Typed errors**: data errors are results (`{ ok: false, reason }`): `not_a_number`, `not_an_integer`, `amount_out_of_range`, `unsupported_currency`, `currency_mismatch`, `invalid_quantity`, `invalid_basis_points`, `invalid_money` (a hand-built value that is not valid money). `compareMoney` follows the same rule (a currency mismatch is a result, not a throw). Only misconfiguration throws `RangeError` (an unknown rounding mode, an unknown currency passed to `exponentOf`, invalid money passed to `toDecimalString`).
- **Decimal text**: `toDecimalString` and `parseDecimalString` convert without floats: 123456 UAH is `1234.56`, 5 UAH is `0.05`, JPY has no fraction, KWD has three decimals, negative amounts have a leading minus. The parse grammar is strict: optional minus, ASCII digits, optional dot with 1 to `exponent` digits. Rejected: more digits than the currency has, comma, exponent notation, spaces, a leading plus, `.5`, `5.`, empty text, `-0` and `-0.00` (negative zero), non-ASCII digits, values beyond the range. Output of one is always accepted by the other and round-trips exactly.
- **JSON in the API**: `{ "amount": 123456, "currency": "UAH" }` with an integer amount in minor units. Nothing in the API sends major units or a decimal string as the source of truth; decimal strings are for display, import and export only. The storefront formats with the currency exponent from `GET /store/config`.
- **Tax**: only a display flag for now (`PRICES_INCLUDE_TAX`, plan decision). The tax rounding strategy (per line or per order) stays OPEN and is decided by the pricing-pipeline plan; the rounding modes above are the building blocks it will use.

### Stock model (details in the plan, section Design/Data)
- Per-variant flags `track_inventory` and `allow_backorder`; a variant that is not tracked, or allows backorder, is always available.
- Stock lives in `inventory_level` per variant and location (`on_hand`, `reserved`); available is `on_hand - reserved`, never below 0.
- The public API shows only an availability status (`in_stock`, `low_stock`, `out_of_stock`), never quantities or locations. Exact numbers are admin-only.
- Every change of `on_hand` is a row in the append-only `stock_movement` journal in the same transaction (a database trigger rejects UPDATE and DELETE).
- Cart and checkout hold stock through reservations (`active`, `committed`, `released`, `expired`) that expire; reserving never makes `reserved` exceed `on_hand` unless backorder is allowed.
- Every stock write takes a row lock (`SELECT ... FOR UPDATE`) on the `inventory_level` row inside one transaction, so parallel requests for the last unit cannot both succeed.

## Alternatives rejected

- **Floating point amounts**: binary floats cannot represent most decimal prices (0.1 + 0.2), rounding errors accumulate in totals and a percentage computed as `Math.round(amount * rate)` is wrong near halves and above 2^53. Rejected without exception.
- **A decimal library** (decimal.js, big.js, dinero.js): adds a dependency and a runtime cost for what BigInt and integers already do exactly; every extra dependency is a red zone and a licence check. Integers in minor units are also what Postgres, payment providers and accounting systems exchange.
- **Storing major units** (`12.34` as `numeric` or string): ties storage to the currency exponent, makes JPY and KWD special cases in every query, and invites float parsing at every boundary.
- **Larger range** (bigint everywhere, strings in JSON): needs `BigInt` in every consumer and breaks plain JSON numbers; 10^12 minor units is far above any realistic retail price or order total.
- **Throwing on data errors**: the catalog and auth modules return typed results so the API can map them to field errors; money follows the same convention.

## Consequences

- One module (`packages/core/src/pricing`) owns amounts, currencies, limits, rounding and decimal text; the API and later modules must not do their own money arithmetic or rounding.
- Amounts above 10^12 minor units are refused everywhere; a client needing more needs a new ADR (a database column change and a string JSON form).
- The currency table is fixed in code: a currency outside it needs a core change, not a database row.
- Negative amounts are possible in `Money` but invalid as prices; the price rules (step 2) and a database CHECK (step 3) enforce it.
- The tax rounding strategy and discount ordering remain open until the pricing-pipeline plan.
