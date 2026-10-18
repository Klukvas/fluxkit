# 0025. Outbox dispatcher: claim, lease and bounded scheduler jobs

Status: accepted 2026-10-18 (PR C of `docs/plans/2026-10-18-cart-orders-review-fixes.md`; review Medium 1, Medium 2, Medium 3 and two Lows). Supersedes in part ADR 0021 (the "Locks" and "Backoff" paragraphs of "Event delivery", and the counting of `attempts`); ADR 0021 itself is not edited. Changes no schema: no migration, no dependency, no environment variable.

## Context

- **Medium 1.** The dispatcher of ADR 0021 ran the handlers INSIDE the transaction that holds `FOR UPDATE SKIP LOCKED` on a batch of up to 20 rows. When that transaction died (the reviewer's probe: `idle_in_transaction_session_timeout` of 1 s and a handler that takes 1.5 s; also a lost connection), the increment of `attempts` rolled back with it, so the event was redelivered on every tick with no backoff and no limit. The 30 s handler timeout did not help: it only protects against a handler that never answers.
- **Medium 2.** The jobs of a tick run one after the other under one advisory lock. One slow job (a dispatch of 500 events with slow handlers) could hold the tick, and with it the lock, for hours; the next ticks were skipped as `lock_held` or `overlap` without a single log line, and order expiry and the reservation sweep did not run.
- **Medium 3.** A product whose title exists only in locales that are no longer in `LOCALES` was shown in the cart (200) and then failed the checkout with a 500, because the order snapshot demanded the default locale and refused every locale that is not configured.
- **Low (cart).** A price raise that makes a 999-unit line overflow the money limit made `GET /store/cart` answer 409, so the shopper could not read the cart at all.
- **Low (docs).** `docs/contracts/events.md` said `occurredAt` is the time the change committed; it is `created_at DEFAULT now()`, the start time of the transaction that wrote the row.
- The schema is fixed: `domain_event` has `attempts`, `last_error_code`, `created_at`, `dispatched_at` and nothing else (no lease or last-attempt column).

## Decision

### The dispatcher: lease, claim, handlers, result

For each due event (listed oldest first, 20 per page, without a lock), in this order:

1. **Lease.** `pg_try_advisory_lock(7_426_004, hashtext(event id))` on a DEDICATED `pg.Client` opened once per run (application name `fluxkit-event-lease`), never on the application pool (the reason of ADR 0021: a pooled connection must not be left holding a lock). Held by someone else: the event is skipped (`skipped`). The lease is released after the result is recorded; the session end releases whatever is left.
2. **Claim.** A short transaction re-checks that the event is still due (undispatched, fewer than 10 attempts, backoff elapsed; `FOR UPDATE SKIP LOCKED` on the row) and COMMITS `attempts = attempts + 1`. The attempt is on record before any handler runs.
3. **Handlers.** Every handler registered for the type runs with NO transaction open, each with the existing 30 s timeout, also when an earlier one failed. `previousFailures` in the envelope is the number of attempts before this one.
4. **Result.** A second short transaction: `dispatched_at = now` when every handler succeeded (or none is registered), else `last_error_code` of the first failure. The attempt that was the 10th failure is reported in `abandoned`.

What this fixes: a dispatcher that dies (process crash, killed connection, `idle_in_transaction_session_timeout`) in step 3 or between 3 and 4 leaves `attempts` incremented. The event is then retried by the same backoff and the same limit as a failure, so it can no longer be redelivered for ever. At-least-once is kept (a crash after a handler succeeded redelivers the event) and so is the idempotency requirement (handlers are idempotent by `event.id`).

`attempts` now counts STARTED attempts, not failed deliveries. The retry spacing is unchanged: after n attempts that did not finish the event waits until `created_at + (2^n - 1) minutes` (0, 1, 3, 7, ..., 511 minutes), at most 10 attempts. A delivered event shows the attempts it took (at least 1).

### Visibility timeout and multi-instance safety

- The claim commits, so a row lock can not keep other dispatchers away while a handler runs. The LEASE does: two dispatchers (any instance) never run the same event at the same time, and each takes the events the other does not hold (they work in parallel on different events).
- A crashed dispatcher's lease disappears with its database session: at once when the process dies (the kernel closes the socket), and within about a minute when the network just vanishes, because the lease connection sets `tcp_keepalives_idle=30`, `tcp_keepalives_interval=10`, `tcp_keepalives_count=3` for its session so the SERVER notices a dead client (the operating system default would be two hours). That window is the visibility timeout. After it the event is picked again when its backoff allows.
- The scheduler advisory lock (ADR 0021) still makes one instance run the jobs per tick. The leases are the second line of defence for a lock that was lost mid-tick (a dropped lock connection) and for `pnpm jobs:run-once` next to a running scheduler.
- Hash collisions of `hashtext` can only make a dispatcher skip an event that happens to share the 32-bit hash with an event in flight; it is picked on a later run.

### Bounded jobs

- **Time budget.** Every job of a tick gets its own `JobBudget` of 30 s (`DEFAULT_JOB_BUDGET_MS`, a constant, `JobsRunner.runAll(now, {budgetMs})` for tests). A job checks it BETWEEN units of work (before each order, each sweep page, each event, each delete batch) and, when it is used up, stops starting new work and reports `truncated: true` (logged as a warning; the next tick continues). A unit that has begun finishes, so a tick can overrun a budget by at most one unit (one event: 30 s per handler of its type). The budget reads the monotonic clock only to stop; the jobs still take `now` from the caller.
- **Statement and lock timeouts.** The jobs run on the application pool; the scheduler's own connection (the advisory lock, `scheduler-lock.ts`) only issues `pg_try_advisory_lock` and `pg_advisory_unlock`, which never wait. So the limits are set per TRANSACTION with `set_config('statement_timeout', '30000', true)` and `set_config('lock_timeout', '5000', true)` (`withJobTransaction`, `applyJobLimits`), which end with the transaction and never touch a request's connection. They apply to the order listing, `OrdersService.expireOne`, `ReservationsService.expireDue` (both take an optional `limits`), the dispatcher's claim and result transactions and every cleanup delete. A row held by a stuck writer therefore fails that order or event within 5 s instead of queueing behind it; it is reported and retried on the next tick.
- **Order.** Unchanged and now pinned by its reason: expire orders, sweep reservations, dispatch events, then the three cleanups. The time-critical jobs run BEFORE the dispatcher, and the dispatcher is bounded by its budget, so it can not delay them in the next tick either.
- **Constants, not variables.** Budget and timeouts are constants with documented values. An environment variable can be added later if a deployment needs different numbers; it is not needed to fix the review findings.

### Skipped ticks

Every skipped tick (`lock_held`, `overlap`) is logged at debug. The same reason repeating 3 times in a row is a warning (`3 ticks in a row skipped (overlap)`), and again every 30 further skips (3, 33, 63, ...); a tick that runs, or a different reason, starts the count again. `SchedulerService.skippedTicks()` returns the cumulative counts per reason. The rule is quiet for the normal case of several instances (the idle ones are always `lock_held`: one warning, then one per half hour at the default interval) and loud for a tick that never finishes.

### Related decisions in the same change

- **Snapshot texts (Medium 3).** The order snapshot is history. It keeps EVERY real translation of a text (title, variant title, option name and value), also in locales that are not configured today, and does not require the default locale; empty and whitespace-only entries are dropped, and only a text with no real entry at all is refused (`invalid_product_title`), which the checkout answers as `409 checkout_refused` with `errors[] = {path: "lines.N", code: "product_title_missing"}` instead of a 500. A damaged entry (not a string, too long, characters JSONB can not store) still refuses. Readers resolve the map with the one rule `resolveTextWithFallback` (core): requested locale, default locale, first available non-empty locale in code order. The store read, the cart and the order views use it, so the cart shows the same title the order will carry. The catalog WRITE rules (default locale required, configured locales only) are unchanged. This refines decision 4 of ADR 0004 (what the snapshot stores) and the per-field fallback of ADR 0006 section 10 (a third step).
- **Cart read (Low).** `GET /store/cart` shows a line whose total no longer fits the money limit as unavailable (`unitPrice` and `lineTotal` null, left out of the subtotal, notice `line_total_out_of_range`) and the cart as not purchasable. Writes keep their `409 rule_violation` (an add that overflows is refused and rolled back), and the checkout keeps refusing the line (`409 checkout_refused`). A subtotal that overflows while every line fits is still a 409 on read: no single line is to blame.
- **`occurredAt`.** Documented as what it is: the time the outbox row was inserted, which is the start of the transaction that wrote it (`DEFAULT now()`), so it can be earlier than the commit by the length of that transaction. The data is not changed.

## Alternatives rejected

- **A `lease_until` / `last_attempt_at` column.** The clean design (a real visibility timeout, and retry spacing anchored to the last attempt instead of creation), but a migration and a schema change; not needed to remove the infinite redelivery. Left as the follow-up that would also fix the creation-anchored spacing recorded in ADR 0021.
- **A time in `last_error_code` or a future time in `dispatched_at` as the lease.** Bends a column meant for something else (ADR 0021 rejected the first; the second would make an event look delivered).
- **One advisory lock for the whole dispatcher run.** Simpler, but two instances could no longer work on different events at the same time, and a run of 500 events would block `jobs:run-once`.
- **Keeping the row locks and shortening the handler timeout.** Does not remove the dying transaction, only makes it rarer.
- **The lease on a pool connection.** One missed release would keep a lock on a pooled connection for the life of the process.
- **A bounded `statement_timeout` on the pool for every connection.** Would also cut long admin statements and imports.

## Consequences

- An event costs about four short statements and transactions (list page, lease, claim, result) instead of one transaction per 20 events. Dispatch throughput is lower for large backlogs; the budget bounds a run and the next tick continues.
- One more database connection exists for the length of a dispatcher run (the lease connection), next to the scheduler lock connection.
- An event whose 10th attempt dies without recording a result is not reported as `abandoned` (nothing recorded the failure); it shows up in the operator query `dispatched_at is null and attempts >= 10` (`last_error_code` is stale or null).
- Retry spacing is still anchored to `created_at`, so events that first fail long after creation can still use up their 10 attempts in 10 ticks. Unchanged from ADR 0021; the column above would fix it.
- `domain_event.attempts` is now at least 1 for every delivered event; nothing outside the dispatcher reads it. A plugin handler must not rely on `previousFailures` being a count of failures: it is the number of earlier attempts.
- `docs/api/jobs.md` and `docs/contracts/events.md` describe the new delivery rules; `docs/api/cart.md` and `docs/api/orders.md` the cart and checkout answers.
