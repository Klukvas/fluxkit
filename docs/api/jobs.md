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
1. Takes the session advisory lock `7426003` with `pg_try_advisory_lock` on a dedicated connection (application name `fluxkit-scheduler-lock`). Lock held elsewhere: the tick does nothing (`lock_held`). The previous tick of this process still running: nothing (`overlap`).
2. Runs the jobs below in this order with `now = clock.now()` (one value for the whole tick). A failing job is logged (class and cause code only, never the message) and does not stop the next; nothing a tick does can crash the process.
3. Unlocks and ends the connection. A crashed process or a lost connection releases the lock with the session.

Shutdown clears the timer and waits for a running tick before the database pool closes.

| Order | Job (file) | What it does | Result counts |
|---|---|---|---|
| 1 | `expire-orders` (`expire-due-orders.job.ts`) | `awaiting_payment` orders with `expires_at <= now`, oldest first, in pages of 100 (50 pages per run), each through `OrdersService.expireOne(id, now)` in its own transaction: releases the reservations, writes the status journal row and `order.expired` | `scanned`, `expired`, `notDue` (a payment or cancellation got there first), `failures[{orderNumber, error}]`, `truncated` |
| 2 | `sweep-reservations` (`sweep-reservations.job.ts`) | `ReservationsService.expireDue(now)` looped on `nextCursor` until it is `null` (at most 100 calls): only orphans are left, because the order job released the rest (a reservation outlives its order by 10 minutes) | `scanned`, `expired`, `skipped`, `failures[{reservationId, reason}]`, `iterations`, `truncated` |
| 3 | `dispatch-events` (`dispatch-domain-events.job.ts`) | delivers due outbox events to the handlers (`docs/contracts/events.md`), pages of 20 (25 per run) | `scanned`, `dispatched`, `failed`, `failures[{eventId, type, handler, code}]`, `abandoned[{eventId, type}]`, `truncated` |
| 4 | `delete-dispatched-events` (`delete-dispatched-events.job.ts`) | deletes events dispatched strictly more than 7 days before `now`; never an undispatched one | `deleted`, `truncated` |
| 5 | `delete-carts` (`delete-expired-carts.job.ts`) | deletes carts with `expires_at <= now` (lines by the foreign key; no stock is held by a cart); a cart another transaction is writing is skipped | `deleted`, `truncated` |
| 6 | `delete-customer-sessions` (`delete-expired-customer-sessions.job.ts`) | deletes customer sessions with the ABSOLUTE `expires_at <= now`. An idle-expired session is deleted when used or at its absolute end | `deleted`, `truncated` |

Not cleaned here: admin sessions (cleaned at startup and at login, ADR 0009).

`failures` and `abandoned` are logged as errors with ids, order numbers and codes only. `truncated: true` means a run stopped at its batch limit with more rows possibly left; the next tick continues (logged as a warning). Cleanup batches are 500 rows, at most 100 per run.

Every job function takes `now` and reads no clock and starts no timer, so a test (or a cron) decides the time. All queries receive `now` as a parameter; none reads the database clock.

## Delivery and retry of events

- At-least-once; a batch is one transaction holding `FOR UPDATE SKIP LOCKED` on its rows, so two dispatchers never deliver the same row at the same time.
- Dispatched only when every handler of the type succeeded (or none is registered). All handlers are called each attempt; a retry calls all of them again.
- A failure stores `attempts + 1` and `last_error_code` (error class, plus the code of the innermost cause: `TypeError`, `Error:ECONNRESET`, `HandlerTimeout`; never a message).
- Backoff: picked again at `created_at + (2^attempts - 1) minutes` (0, 1, 3, 7, 15, 31, 63, 127, 255, 511); no new column, so the spacing is anchored to creation (ADR 0021). A handler has 30 seconds to answer.
- After 10 failed deliveries: one error log, the row stays undispatched and is never picked again. To retry it after fixing the cause: `update domain_event set attempts = 0 where id = '<id>'`. List the stuck ones: `select id, type, attempts, last_error_code from domain_event where dispatched_at is null and attempts >= 10`.
- Each event is attempted at most once per run.

## `pnpm jobs:run-once`

`pnpm build && pnpm --filter @fluxkit/api jobs:run-once` (reads the root `.env` like the other commands; takes no arguments). Builds the application without the HTTP listener, the timer and the startup cleanup of admin sessions, takes the SAME advisory lock without waiting, runs every job once with `now` = the system clock, prints one line per job and exits:

| Exit | Meaning |
|---|---|
| `0` | every job ran; stdout has one line per job, for example `expire-orders: scanned=2 expired=2 notDue=0 failures=0 truncated=false` |
| `1` | a job failed (its line says `FAILED` and the full error is on stderr, connection string removed), or the configuration is malformed, `DATABASE_URL` is missing, an argument was given, or the database is unreachable |
| `2` | the lock is held by a running scheduler or another command: nothing was run; stderr says so. A tick takes seconds; run it again, or leave it, the scheduler is doing this work |

Use it for a system cron when `SCHEDULER_ENABLED=false`, and to run the jobs by hand. Feature handlers of enabled features (`FEATURES_ENABLED`) are discovered, so their events are delivered by the command too.
