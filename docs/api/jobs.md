# Scheduler and jobs

The scheduler (plan step 5c of `docs/plans/2026-10-17-cart-and-orders.md`, ADR 0018 and 0021) has NO HTTP route. It is an in-process timer in the API plus a command line, both running the same job functions in `apps/api/src/jobs/`. Core, no feature flag. `GET /health` is unchanged (a scheduler heartbeat in health is a follow-up).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SCHEDULER_ENABLED` | `true` | Exactly `true` or `false`. `false`: this process starts no timer (the jobs can still be run by hand) |
| `SCHEDULER_INTERVAL_SECONDS` | `60` | Seconds between ticks, whole number from 10 to 3600 |

Malformed values fail startup (and `pnpm jobs:run-once`) with `Invalid environment: ...`. Details: `docs/contracts/config.md`. If the scheduler is off in every API process and no cron runs `pnpm jobs:run-once`, unpaid orders keep their stock reserved until someone runs it.

## One tick

The timer calls `SchedulerService.tick()` every `SCHEDULER_INTERVAL_SECONDS`:
1. Takes the session advisory lock `7426003` with `pg_try_advisory_lock` on a dedicated connection (application name `fluxkit-scheduler-lock`; it only takes and gives back the lock, the jobs run on the application pool). Lock held elsewhere: the tick does nothing (`lock_held`). The previous tick of this process still running: nothing (`overlap`). Skipped ticks are logged, see Skipped ticks below.
2. Runs the jobs below in this order with `now = clock.now()` (one value for the whole tick), each with its own time budget (see Bounded jobs). A failing job is logged (class and cause code only, never the message) and does not stop the next; nothing a tick does can crash the process.
3. Unlocks and ends the connection. A crashed process or a lost connection releases the lock with the session.

Shutdown clears the timer and waits for a running tick before the database pool closes.

| Order | Job (file) | What it does | Result counts |
|---|---|---|---|
| 1 | `expire-orders` (`expire-due-orders.job.ts`) | `awaiting_payment` orders with `expires_at <= now`, oldest first, in pages of 100 (50 pages per run), each through `OrdersService.expireOne(id, now)` in its own transaction: releases the reservations, writes the status journal row and `order.expired` | `scanned`, `expired`, `notDue` (a payment or cancellation got there first), `failures[{orderNumber, error}]`, `truncated` |
| 2 | `sweep-reservations` (`sweep-reservations.job.ts`) | `ReservationsService.expireDue(now)` looped on `nextCursor` until it is `null` (at most 100 calls): only orphans are left, because the order job released the rest (a reservation outlives its order by 10 minutes) | `scanned`, `expired`, `skipped`, `failures[{reservationId, reason}]`, `iterations`, `truncated` |
| 3 | `dispatch-events` (`dispatch-domain-events.job.ts`) | delivers due outbox events to the handlers (`docs/contracts/events.md`), pages of 20 (25 per run), one event at a time: lease, claim, handlers, result (below) | `scanned` (attempts started), `dispatched`, `failed`, `skipped` (held by another dispatcher, or no longer due), `failures[{eventId, type, handler, code}]`, `abandoned[{eventId, type}]`, `truncated` |
| 4 | `delete-dispatched-events` (`delete-dispatched-events.job.ts`) | deletes events dispatched strictly more than 7 days before `now`; never an undispatched one | `deleted`, `truncated` |
| 5 | `delete-carts` (`delete-expired-carts.job.ts`) | deletes carts with `expires_at <= now` (lines by the foreign key; no stock is held by a cart); a cart another transaction is writing is skipped | `deleted`, `truncated` |
| 6 | `delete-customer-sessions` (`delete-expired-customer-sessions.job.ts`) | deletes customer sessions with the ABSOLUTE `expires_at <= now`. An idle-expired session is deleted when used or at its absolute end | `deleted`, `truncated` |
| 7 | `delete-abandoned-uploads` (`delete-abandoned-uploads.job.ts`) | deletes `media_upload` rows never attached (`first_attached_at IS NULL`) and strictly older than 24 hours before `now`, oldest first, in pages of 100 (50 pages per run), then deletes their files (details below); with `MEDIA_STORAGE_DRIVER=none` it does nothing | `deleted`, `truncated`, `fileErrors` |
| 8 | `track-shipments` (`track-shipments.job.ts`) | asks the carriers for the status of due shipments (polled status `created`, `in_transit`, `arrived` or `returning`, a waybill number, `next_track_at <= now`, a loaded provider that offers tracking), oldest due first, in pages of 100 (at most 5 per run), ONE `track` call per provider and page outside any transaction, then one short transaction per shipment (details below); it never changes an order | `scanned`, `changed`, `unchanged`, `ignored`, `providerFailures`, `stopped`, `failures[{shipmentId, error}]`, `truncated` |

Not cleaned here: admin sessions (cleaned at startup and at login, ADR 0009).

`failures` and `abandoned` are logged as errors with ids, order numbers and codes only. `truncated: true` means a run stopped at its batch limit or its time budget with more rows possibly left; the next tick continues (logged as a warning). Cleanup batches are 500 rows, at most 100 per run (job 7: 100 rows, at most 50 per run; job 8: 100 shipments, at most 5 pages per run).

## Abandoned uploads (job 7, ADR 0028 decision 7)

An upload (`POST /admin/media/uploads`) that no product media list or brand logo referenced within 24 hours is abandoned: the admin left the editor, or the answer was lost. The job removes it so the disk does not fill with files nobody uses.

- **Which rows.** `first_attached_at IS NULL` and `created_at < now - 24 hours` (strictly: an upload exactly 24 hours old is kept), oldest first, through the partial index `media_upload_created_at_unattached_idx`. An attached upload is NEVER deleted, however old, and neither is its file: removing it from a media list, deleting a draft product or changing a brand logo keeps the row and the file, because order snapshots, caches and the image optimizer may still use the URL. A purge of those is a later plan.
- **Per page (one transaction, the job limits above).** `SELECT ... FOR UPDATE SKIP LOCKED` locks the page, then `DELETE ... WHERE id IN (page) AND first_attached_at IS NULL AND created_at < cutoff RETURNING storage_key` repeats both conditions, then COMMIT. Only after the commit the job calls `storage.delete(key)` for each returned key, one at a time, so a file is never touched while its row can still be rolled back or attached.
- **Race with an attaching save.** A save marks uploads with `UPDATE media_upload SET first_attached_at = ... RETURNING` in its own transaction, which locks the row. Whichever transaction commits first wins: if the save committed first, the job skips the locked row (and a later run finds it attached), so row and file stay; if the job committed first, the save finds no row and answers `400 validation_failed` with `upload_not_found` at the URL's field (the admin uploads again).
- **Files.** An absent file is success (the port's `delete` is idempotent). Any other error (permissions, a directory in place of the file, I/O) is logged as an error with the key and the error code only, the file is left and counted in `fileErrors`; the row is already gone, so nothing links to the file and it stays for an operator to remove. One failing file never stops the page or the run.
- **Crash between commit and file delete.** The rows are gone and the files stay on disk, unreferenced (nothing deletes them later). Rare; remove files under `MEDIA_DIR` that have no `media_upload` row by hand if disk use matters.
- **`MEDIA_STORAGE_DRIVER=none`.** The job deletes nothing (no storage is configured to clean, and a row deleted without its file would leave an untracked file for the day the driver is switched back on).
- **Where it runs.** On whichever instance holds the scheduler lock, so the instance must see the same `MEDIA_DIR` as the one that stored the files (one API instance or a shared volume). `pnpm jobs:run-once` needs the same `MEDIA_DIR` (and `MEDIA_PUBLIC_BASE_URL`) as the API; with `MEDIA_DIR` unset outside production it uses the same development default directory.

## Shipment tracking (job 8, ADR 0029 decision 10)

Tracking is by polling (Nova Post offers webhooks, but they are not used in v1: ADR 0030 decision 5). The job runs LAST in the tick: it makes outbound network calls, so a slow carrier delays nothing time-critical; the events it writes are delivered by the next tick's dispatcher.

- **Which shipments.** Polled statuses only (a waybill exists and the status is not terminal), `next_track_at <= now`, a provider that is loaded and has the `tracking` capability (a shipment of a disabled provider is not polled and not counted), ordered by `(next_track_at, id)`, through the partial index `shipment_next_track_at_idx`. The page query takes no lock and is continued by a `(next_track_at, id)` cursor, so a row that could not be written is not read again in the same run.
- **Per page and provider:** ONE `track({trackingNumbers, phones})` call (the phones are the orders' recipient phones, which the carrier may need for a full answer; they go to the carrier only, never into a log), with the API's limit of 15 s (`SHIPMENT_CALL_TIMEOUTS.trackingMs`, core `SHIPPING_PROVIDER_TIMEOUTS_MS.waybill`). No transaction or lock is held during the call. An answer entry that breaks the port (a number not asked for, a code that is not `CARRIER_CODE_PATTERN`, a status that is not a carrier status) is dropped and counted in a warning.
- **Per shipment** (its own transaction, the job limits above, locking only that shipment row; the status is read again under the lock, so an admin action that got there first wins):
  - a new status the core machine allows (`decideShipmentTransition`, actor `system`): the row, a journal row with the carrier code (actor `system`, no admin) and the event (`shipment.status_changed`, `shipment.cancelled`) commit together; `delivered_at` / `cancelled_at` are set for those statuses (`changed`);
  - the same status, or no entry for the number: only the carrier code and time are refreshed (`unchanged`); a status the machine does not allow from here is logged with the shipment id and the codes and not applied (`ignored`);
  - either way `tracking_attempts` goes back to 0 and the next poll is set by the status: `created` 2 h, `in_transit` 4 h, `arrived` and `returning` 6 h; a terminal status gets none (`apps/api/src/shipping/shipments/tracking-schedule.ts`).
- **A failed call** (no answer in time, a thrown error, any typed failure) counts one more try for each shipment of that call and moves its next poll by 5 minutes doubled per failure in a row, at most 6 hours (5, 10, 20, 40, 80, 160, 320, 360, 360, ...; `providerFailures`, logged once per call as a warning with the provider code, the outcome kind, the reason and carrier codes). A carrier that is down therefore does not take the pages of the others, and one carrier's failure never stops another carrier's call. (ADR 0029 says "a failed call leaves the rows due for the next tick"; the backoff refines that so a broken carrier cannot starve the job.)
- **Giving up.** A shipment that is still not terminal 30 days after its creation is polled one last time and then gets no next poll (`stopped`, a warning with the shipment id). An admin can still refresh it (`POST /admin/orders/{id}/shipments/{shipmentId}/refresh`).
- **A shipment that cannot be written** (a lock held past `lock_timeout`, damaged data) is reported in `failures` by id with the error class and code only, and stays due for the next run; the others go on.
- **Budget.** Checked before each page and before each provider call; a page or call that has begun finishes, so a run overruns its budget by at most one carrier call (15 s).
- **Never** changes an order, its status or its stock: fulfilment stays an admin action (no `OrderFulfilmentPort`, the owner's decision).

## Bounded jobs and skipped ticks (ADR 0025)

- **Time budget.** Each job of a tick gets 30 seconds (a constant, `DEFAULT_JOB_BUDGET_MS`). It checks the budget between units of work (before each order, sweep page, event or delete batch) and, when it is used up, starts nothing new and reports `truncated: true`. A unit that has begun finishes: a tick overruns a budget by at most one event (30 s per handler of its type). One slow job can no longer hold the tick, and the time-critical jobs (order expiry, reservation sweep) always run before the dispatcher.
- **Statement limits.** Every statement of a job runs under `statement_timeout` 30 s and `lock_timeout` 5 s, set per transaction (`set_config(..., true)`), so a row held by a stuck writer makes that order or event fail within 5 s (reported in `failures`, retried next tick) instead of blocking the tick. They apply to the order listing, `expireOne`, the reservation sweep, the dispatcher's transactions, every cleanup delete and job 8's shipment transactions; the scheduler lock connection only issues the non-waiting lock and unlock.
- **Skipped ticks.** Each skipped tick (`lock_held`, `overlap`) is logged at debug. The same reason 3 times in a row is a warning (`N ticks in a row skipped (reason)`), and again every 30 further skips (3, 33, 63, ...); a tick that runs, or another reason, resets the count. With several instances the idle ones are always `lock_held` (one warning, then one per 30 ticks); `overlap` means a tick takes longer than the interval, so look at the job logs for `truncated` warnings. `SchedulerService.skippedTicks()` gives the cumulative counts per reason.

Every job function takes `now` and reads no clock and starts no timer, so a test (or a cron) decides the time. All queries receive `now` as a parameter; none reads the database clock.

## Delivery and retry of events

For each due event, oldest first (ADR 0025):
1. **Lease**: a session advisory lock on the event (`pg_try_advisory_lock(7426004, hashtext(event id))`) on a dedicated connection opened per run (application name `fluxkit-event-lease`). Held by another dispatcher: the event is skipped. The lock goes with the session when the process dies, or within about a minute when the network vanishes (the connection sets TCP keepalives so the server notices a dead client): a crashed dispatcher's event is never stuck.
2. **Claim**: a short transaction re-checks the event is still due and commits `attempts + 1`. The attempt is on record BEFORE any handler runs.
3. **Handlers**: all handlers of the type run with no transaction open, each with 30 seconds to answer (`HandlerTimeout` after that), also when an earlier one failed.
4. **Result**: a second short transaction sets `dispatched_at` (every handler succeeded, or none is registered) or stores `last_error_code` (error class, plus the code of the innermost cause: `TypeError`, `Error:ECONNRESET`, `HandlerTimeout`; never a message).

- At-least-once: a retry calls ALL handlers again, and a dispatcher that dies after a handler succeeded causes a redelivery; handlers are idempotent by `event.id`.
- `attempts` counts STARTED attempts (a delivered event shows at least 1). A dispatcher that dies in the middle leaves its attempt counted, so the backoff and the limit below apply to it: the event is not redelivered on every tick for ever.
- Backoff: after n attempts the event is picked again at `created_at + (2^n - 1) minutes` (0, 1, 3, 7, 15, 31, 63, 127, 255, 511); no new column, so the spacing is anchored to creation (ADR 0021, 0025).
- After 10 attempts: the row stays undispatched and is never picked again. A failed 10th attempt is logged once as an error (`abandoned`); a 10th attempt that died without recording is not logged, so check the stuck ones: `select id, type, attempts, last_error_code from domain_event where dispatched_at is null and attempts >= 10`. To retry one after fixing the cause: `update domain_event set attempts = 0 where id = '<id>'`.
- Each event is attempted at most once per run.

## `pnpm jobs:run-once`

`pnpm build && pnpm --filter @fluxkit/api jobs:run-once` (reads the root `.env` like the other commands; takes no arguments). Builds the application without the HTTP listener, the timer and the startup cleanup of admin sessions, takes the SAME advisory lock without waiting, runs every job once with `now` = the system clock, prints one line per job and exits:

| Exit | Meaning |
|---|---|
| `0` | every job ran; stdout has one line per job, for example `expire-orders: scanned=2 expired=2 notDue=0 failures=0 truncated=false` |
| `1` | a job failed (its line says `FAILED` and the full error is on stderr, connection string removed), or the configuration is malformed, `DATABASE_URL` is missing, an argument was given, or the database is unreachable |
| `2` | the lock is held by a running scheduler or another command: nothing was run; stderr says so. A tick takes seconds; run it again, or leave it, the scheduler is doing this work |

Use it for a system cron when `SCHEDULER_ENABLED=false`, and to run the jobs by hand. Feature handlers of enabled features (`FEATURES_ENABLED`) are discovered, so their events are delivered by the command too.
