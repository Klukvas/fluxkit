# 0021. Scheduler jobs: lock, retry and handler completion

Status: accepted 2026-10-17 (plan step 5c). Fills in what ADR 0018 left open; does not change it.

## Context

ADR 0018 fixes the shape of the scheduler (in-process interval, Postgres advisory lock, transport-agnostic jobs, outbox with at-least-once dispatch, handler discovery by metadata). Building it needed rules that ADR 0018 does not state, and the schema is fixed (no migration in this step): `domain_event` has `attempts`, `last_error_code`, `created_at`, `dispatched_at` and nothing else.

## Decision

### The lock
- Key `7_426_003` (the others in use: `7_426_001` test schema helpers, `7_426_002` `pnpm db:migrate`), session level `pg_try_advisory_lock`, never a waiting lock.
- Taken on a DEDICATED `pg.Client` (application name `fluxkit-scheduler-lock`), opened per tick and ended in `finally`, never on a connection of the application pool: a pool connection can not be left holding a lock, and a crashed process or a lost connection releases it with the session. The tick unlocks explicitly first and ends the session after that.
- A tick that finds the lock taken does nothing (`lock_held`); a tick of the same process that starts while the previous one still runs does nothing (`overlap`). Neither is an error.
- `pnpm jobs:run-once` uses the SAME lock and does NOT wait: when a running scheduler (or another command) holds it, the command runs nothing, says so and exits `2`. That scheduler is already doing this work, a tick takes seconds, and waiting could hang a cron job behind a stuck tick. Exit `0`: all jobs ran; `1`: a job failed, the configuration is malformed or the database is unreachable; `2`: lock held.
- The order of one tick: expire orders, reservation sweep, dispatch events, delete dispatched events, delete carts, delete customer sessions. The order job runs first so that the sweep only finds orphans, and the dispatcher sees the `order.expired` events written in the same tick. A failing job is logged and reported; the next job still runs.

### Event delivery
- **Completion.** An event is dispatched (`dispatched_at = now`) only when EVERY handler registered for its type succeeded, or when no handler is registered (nothing to deliver). Every registered handler is called even when an earlier one failed, so one bad handler does not starve the others. Without a per-handler delivery table (no schema change), a retry calls ALL handlers of the event again, including the ones that already succeeded: handlers must be idempotent by `event.id`, which at-least-once delivery requires anyway.
- **Backoff without a new column.** `attempts` counts FAILED deliveries. An event is picked again when `created_at + (2^attempts - 1) minutes <= now` (0, 1, 3, 7, 15, 31, 63, 127, 255, 511 minutes after creation), and not at all once `attempts >= 10`. The rule is anchored to `created_at` because the table stores no time of the last attempt. Consequence: after a long outage the retries of old events are no longer spread out (each is due again on the next tick, at most one attempt per event per run), so ten attempts can be used up within ten ticks. A `last_attempt_at` column would remove this; adding it is a migration and needs its own approval.
- **Giving up.** The failure that makes `attempts` reach 10 is reported once as an error log (event id and type); the row stays undispatched and is no longer picked. An operator looks at `domain_event` (`dispatched_at is null and attempts >= 10`, `last_error_code`) and can reset `attempts` to retry.
- **Stored error code.** The class name of the error, plus the `code` of its innermost cause (`TypeError`, `Error:ECONNRESET`, `HandlerTimeout`), cut to the 64 characters and the character set the column's CHECK allows. Never the message.
- **Locks.** A batch of at most 20 events is one transaction that holds `FOR UPDATE SKIP LOCKED` on its rows while the handlers run, so two dispatchers never deliver the same row at the same time and a crash redelivers the batch. A handler that has not answered after 30 seconds counts as failed (`HandlerTimeout`), so a hung handler can not hold the tick, its row locks and the scheduler lock for ever; the handler may still finish later, which at-least-once already allows. Within a run each event is attempted at most once. There is no ordering guarantee between events beyond "oldest due first".
- **Retention.** Events dispatched strictly more than 7 days before `now` are deleted in batches (an event dispatched exactly 7 days ago is kept). Undispatched events are never deleted.
- **Discovery.** `DiscoveryService.getProviders({metadataKey})` only knows decorators made by `DiscoveryService.createDecorator`, so the registry asks the class of every provider for `DOMAIN_EVENT_HANDLER_METADATA` itself, once at startup. The metadata value is `{eventTypes: [...]}` (built with the core helper `domainEventHandlerMetadata`, which checks the names). A marked provider that has no `handle(event)` method, no valid event type or is not a static provider stops the startup.

### Cleanup scope
- Carts: `expires_at <= now`, lines by the foreign key; a cart another transaction is writing is skipped (`SKIP LOCKED`). A checkout gives the cart a new expiry, so a cart of a recent order is not deleted; a replay of a checkout whose cart was deleted is refused as before (`idempotency_key_reused`, ADR 0015).
- Customer sessions: the ABSOLUTE `expires_at <= now` only. An idle-expired session is deleted when it is used (`CustomerSessionService.resolve`) or when its absolute end passes (at most `CUSTOMER_SESSION_MAX_HOURS` after creation); the idle rule depends on a setting that can change and stays in one place (`evaluateSession`).
- Admin sessions are not touched by the scheduler (ADR 0009: cleaned at startup and at login).
- Batch deletes name their rows in a materialized CTE: `delete ... where id in (select ... limit n for update skip locked)` is planned as a nested-loop semi join that runs the subquery for every candidate row and deleted 5 rows for a limit of 2 (found by the batch test).

### Configuration
`SCHEDULER_ENABLED` (default `true`, exactly `true` or `false`) and `SCHEDULER_INTERVAL_SECONDS` (default 60, 10 to 3600). An application built without an environment (tests, the OpenAPI export, the seed and admin commands, `pnpm jobs:run-once`) has no timer.

## Alternatives rejected

- **Waiting for the lock in `pnpm jobs:run-once`.** Hides a stuck tick behind a hanging cron job.
- **A delivery row per (event, handler).** Exact per-handler retry, but a new table (migration, red zone) for a case idempotent handlers already cover.
- **The advisory lock on a pool connection.** One forgotten release would leave the lock on a pooled connection for the life of the process.
- **Cleaning idle-expired sessions too.** Duplicates the idle rule of core in SQL, and the rows hold nothing but a hash.
- **A per-attempt time stored in `last_error_code`.** Bends a column meant for a code into a timestamp store.

## Consequences

- The retention job selects dispatched rows by `dispatched_at` without an index (the partial index covers undispatched rows only, the known gap of ADR 0019); one scan per tick is cheap while the table holds a week of events. An index is a migration and a follow-up if the table grows. Likewise the dispatcher scans the undispatched rows, so events stuck at 10 failures stay in that scan until an operator resolves them.
- The scheduler needs no migration, no dependency and no flag. The retry spacing after an outage is coarser than a `last_attempt_at` design would give (see above); recorded as a follow-up.
- `docs/contracts/events.md` lists the handler contract; `docs/api/jobs.md` lists the jobs, the command and the locking.
