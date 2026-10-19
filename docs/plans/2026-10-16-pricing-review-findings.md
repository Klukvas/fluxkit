# Pricing and inventory independent review: findings (plan step 7)

Status: review done 2026-10-16 on `main` at f7021ee. All findings are fixed or documented in PR #47 (`fix/pricing-review-findings`, merged); the owner approved fixing all of them with the choices recorded below. ADR 0013 records the one rule decision (variants with stock history are not deleted).
Reviewer: Opus (rounding and overflow, oversell races, journal integrity, leaks, publish-rule regressions, migration reversibility, tests that cannot fail). Authors were Sonnet agents; the reviewer did not see the orchestrator's conclusions.
"Confirmed" = the orchestrator reproduced it or re-derived it from the code. "Reported" = reproduced by the reviewer only.

## Findings

| # | Severity | Defect | Where | Status |
|---|---|---|---|---|
| R1 | Medium, confirmed | With backorder, a receipt smaller than the backordered quantity was refused `below_reserved` (`{onHand 0, reserved 10}` + receipt 5), so a backorder could only be fulfilled by one receipt that covered everything. | `packages/core/src/inventory/decisions.ts` `decideAdjustment` | Fixed in this PR: `below_reserved` refuses only changes that lower on hand; increases are always allowed. Core, property, HTTP and service tests (full backorder flow: reserve beyond stock, receive in parts, commit each). |
| R2 | Medium, confirmed | Unpublishing a sold product returns it to draft; `DELETE` of a non-default variant then cascaded away its `stock_movement` rows (sales history), levels and active reservations. | `canDeleteVariant`, variants delete service | Fixed in this PR: `hasStockHistory` fact and reason `has_stock_history` (409), read under the product lock with the variant row locked `FOR NO KEY UPDATE`; ADR 0013. The follow-up (rebuilding the variants on an options change) is fixed in the branch `fix/option-change-stock-history`: ADR 0014, core `canRebuildVariants`, 409 `has_stock_history`. |
| R3 | Low, confirmed test gap | `findVariantForReservation` takes `FOR SHARE` on the variant; no test covered it. | `reservations.repository.ts` | Fixed in this PR: lock-wait test `expectWaitsForVariantLock`; mutation shown (below). |
| R4 | Low, confirmed test gap | The trigger clause "`actor_id` to NULL and nothing else" at depth above 1 was untested. | `0003_pricing_inventory.sql` | Fixed in this PR (tests only, migration untouched): helper function and trigger at depth 2; mutation shown (below). |
| R5 | Low, confirmed in core | `decideReserve` could push `reserved` beyond the Postgres `integer` (`{onHand 0, reserved 2147000000}` + 1 000 000 returned ok). | `decideReserve` | Fixed in this PR: typed refusal `reserved_out_of_range` above `MAX_RESERVED` (= `MAX_ON_HAND`). A database `CHECK` is a possible later migration (ADR 0013, HANDOFF). |
| R6 | Low, reported | `expireDue` re-listed failed (damaged) reservations first on every call, so "call again while scanned == limit" never ended with `limit` or more damaged rows at the head. | `ReservationsService.expireDue` | Fixed in this PR: ordered by `(expires_at, id)`, optional keyset `after`, `nextCursor` in the result. |
| R7 | Low, reported (matters for checkout) | Two definitions of "sellable": the store needs an active variant, an active product and a shop-currency price; `reserve` needed only an active variant and product. | store SQL, `reserve` | Fixed in this PR: core `isVariantSellable` used by `reserve`; the store SQL stays and points at it; a spec compares both with the core function on 12 combinations. |
| R8 | Low, confirmed, docs | Changing `SHOP_CURRENCY` after data exists hides every live product without a price in the new currency; `pnpm seed` never prices or stocks existing products; the plan text on the seed runner was wrong. | docs | Documented in `docs/contracts/config.md`, `README.md`, `seeds/README.md`, the plan. |
| R9 | Info, confirmed, docs | `LOW_STOCK_THRESHOLD` doc said "later step"; docs said "no cache headers" although Express sends a weak `ETag`; docs said a non-integer amount is "never rounded" although JSON parsing turns `100.0` into an integer first. | docs | Documented in `docs/contracts/config.md` and `docs/api/pricing.md`. |
| R10 | Info, confirmed | `negateMoney` and `isZero` did not validate their input (`negateMoney({amount: NaN, currency: "XXX"})` returned it unchanged). | `packages/core/src/pricing/money.ts` | Fixed in this PR: `negateMoney` returns `MoneyResult<"invalid_money">`; `isZero` throws `RangeError` for invalid money (a predicate has no room for a reason, and `false` would hide the bug). No callers outside tests. |
| R11 | Info | A user trigger at depth 2 or `TRUNCATE` can bypass the append-only trigger. | ADR 0012 | Already documented in ADR 0012; an optional statement-level `TRUNCATE` trigger is a possible later migration (ADR 0013, HANDOFF). No code change. |

## Decisions where the brief left room

- R6 cursor: `after: {expiresAt, id}` is the position of the last reservation looked at. `expiresAt` is the UTC ISO text with microseconds that the database printed (`...T..:..:...123456Z`), not a `Date`, because a `Date` has milliseconds only and could name the same row again; treat the cursor as opaque and copy `nextCursor`. A malformed cursor throws `RangeError`. `nextCursor` is `null` when the call looked at fewer than `limit` reservations.
- R10: `negateMoney` typed result (a data error, like the other money functions); `isZero` `RangeError` (a boolean predicate).
- R2 lock: the variant row is locked `FOR NO KEY UPDATE`, not `FOR UPDATE`, so foreign-key checks (`FOR KEY SHARE`) of stock writes do not conflict with it. Lock order stays product, then variant for the delete; stock writes product, then level; reservations variant (`FOR SHARE`), then level. No cycle.

## Checked and found sound

- Money: percentage rounding against a BigInt reference over 600 000+ cases and multiplication over 200 000 cases, decimal-string round trips, 0 mismatches.
- Oversell races: stress of 4 x 300 random interleavings without backorder and 2 with backorder keeps every invariant (reserved equals the active reservations, on hand equals the journal sum, no negative level).
- Leaks: scan of all store routes finds no quantity, location, movement, reservation, flag or other-currency price.
- Permissions: matrix of 9 routes (viewer, manager, owner, anonymous) as designed.
- Migration `0003`: down, up, down, up with data in the tables.
- Mutation testing: 25 mutations, 21 caught. Survivors: C5 (multiply via floats: equivalent at the amount and quantity limits), A11 (expire re-check under the lock: equivalent, `expires_at` is never updated), A10 (= R3, now covered) and A20 (= R4, now covered).

## Evidence for the test-only findings (mutation, run in this PR)

- R3: removing `.for("share", { of: variant })` from `findVariantForReservation` makes `makes reserve wait for a transaction that holds the variant row` fail ("the operation must wait for the variant row lock"); restored, it passes. The holder uses `FOR NO KEY UPDATE`: a `FOR UPDATE` holder would also block the foreign-key check of the reservation insert and hide the missing lock (first attempt passed with the lock removed).
- R4: removing the `to_jsonb(NEW) - 'actor_id' = to_jsonb(OLD) - 'actor_id'` clause from `0003_pricing_inventory.sql` (as run by the test) makes `rejects an UPDATE that nulls actor_id and changes another column (R4)` fail ("expected 23001 to be violated, but the statement succeeded"); restored, it passes.
- R2: removing the variant row lock from the history check makes `waits for a reservation in progress (variant row lock)` fail.

## Not verified

Postgres 17 (local 16), load behaviour, the real scheduler for `expireDue` (does not exist yet), a `FOR SHARE` race between a price delete and `reserve` (checkout validates again before payment).
