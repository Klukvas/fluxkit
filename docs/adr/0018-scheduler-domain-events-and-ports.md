# 0018. Scheduler, domain events and ports

Status: accepted 2026-10-17 (owner quiz of 2026-10-17 and the assumptions of `docs/plans/2026-10-17-cart-and-orders.md`, approved with the plan). Extends ADR 0002 (stack) and ADR 0011 (reservations).

## Context

- `ReservationsService.expireDue` has no caller, orders must expire, carts and customer sessions must be cleaned, and payment, shipping and email providers must react to orders without editing core (AGENTS.md section 2.1 and 17).
- No worker image or deployment exists (AGENTS.md: API and worker images are not built yet) and `REDIS_URL` is optional. Postgres is the only service every installation has. BullMQ and ioredis are installed but unused.
- Features and providers are packages: they cannot import `apps/api` (dependency-cruiser `packages-must-not-import-apps`), so every extension point must be a contract they can reach from a package.

## Decision

### Scheduler
- **An in-process interval in the API** (owner quiz 2026-10-17): `SCHEDULER_ENABLED` (default `true`), `SCHEDULER_INTERVAL_SECONDS` (default 60, 10 to 3600). Each tick takes a Postgres advisory lock (`pg_try_advisory_lock`), so only one API instance runs the jobs; a crashed holder releases the lock with its connection.
- **Jobs:** expire due orders (release their reservations, record history), `ReservationsService.expireDue` looped on `nextCursor` (an error log on `failures`), delete expired carts in batches, delete expired customer sessions, dispatch pending domain events, delete dispatched events after 7 days.
- **Transport-agnostic.** Job functions take `now` and know nothing about timers. Each is also a CLI (`pnpm jobs:run-once`) for tests and a system cron. Moving the same functions into a BullMQ repeatable job in a separate worker later needs no new dependency; nothing here requests one.
- **Order of expiry.** Reservations expire 10 minutes after their order, so the order job releases them first and the generic sweep only cleans orphans (ADR 0015, ADR 0017). The order job and `markPaid` lock the order row first, so exactly one wins.
- **Known gap.** If the scheduler is disabled on every instance, stock stays held; `GET /health` does not show it yet (follow-up: a scheduler heartbeat in health).

### Domain events (transactional outbox)
- **Table `domain_event`** (`id`, `type`, `aggregate_id`, `payload` ids only, `created_at`, `dispatched_at`, `attempts`, `last_error_code`), written in the SAME transaction as the change it reports, so an event exists if and only if the change committed.
- **Events:** `order.placed`, `order.paid`, `order.cancelled`, `order.expired`, `order.fulfilled`, `customer.registered`. Payload `{eventId, type, occurredAt, orderId | customerId, orderNumber?, status?}`; no PII (a handler reads what it needs through `OrderReadPort`).
- **At-least-once dispatch** by the scheduler; handlers must be idempotent by event id. A handler that throws is retried with backoff (attempts and an error code are stored, no message text); after 10 attempts the event is logged as an error and left for an operator.
- **Handler registration without imports.** The event names, payload types, port interfaces and the metadata key `fluxkit:domain-event-handler` are exported by `@fluxkit/core` (types and constants only, still pure). A plugin's Nest provider marks itself with that metadata (`SetMetadata` from `@nestjs/common`, which plugins may use); the API finds marked providers with Nest `DiscoveryService` at startup.

### Ports: the only way plugins act on orders
- `OrderPaymentsPort.markPaid(orderId, {amount, providerReference, source})`: idempotent (the same reference on a paid order answers ok; a different reference answers `payment_reference_conflict`); the amount must equal the order total; refused on an expired or cancelled order (`order_not_payable`).
- `OrderReadPort.getOrder(orderId)`: the admin view without reservation internals.
- Interfaces live in core; implementations live in `apps/api` and are injected by string tokens exported from core. A plugin never imports `apps/api`, and core never imports a plugin.
- **How plugins attach later.** A payment plugin registers its own routes, reads the order through `OrderReadPort`, verifies the provider signature and calls `OrderPaymentsPort.markPaid`. A shipping plugin adds a shipping adjustment at checkout (the pricing-pipeline plan), reacts to `order.paid` and moves `paid` to `fulfilled` through a port added by the shipping plan. An email notifier handles `order.placed`, `order.paid`, `order.cancelled` and `customer.registered`. Removing any of them leaves orders working: an order stays `awaiting_payment` until an admin marks it paid or it expires.
- The contract is listed in `docs/contracts/events.md`, written in the documentation step of the plan; anything not listed there is internal.

## Alternatives rejected

- **A BullMQ repeatable job and a separate worker process now.** It would make `REDIS_URL` required and need a worker entry point and image that do not exist. The job functions are written so that this move stays cheap.
- **Only a CLI for an external cron.** Works, and `pnpm jobs:run-once` keeps it available, but a fresh installation would silently hold stock until someone sets a cron.
- **An in-memory event emitter, or calling plugins directly after the transaction.** Events would be lost on a crash and could fire for a change that rolled back. The outbox gives both guarantees with Postgres alone.
- **Plugins importing API services.** Forbidden by the dependency rules and would couple clients' code to internals.
- **Putting PII in event payloads.** Payloads are stored and retried; ids are enough and a handler reads the rest through the port.

## Consequences

- At-least-once delivery means every handler needs an idempotency check; the test handler lives in a fixture, not in a feature.
- Several API instances are safe (advisory lock); a single process is also fine. The scheduler needs the API process to run; a deployment that stops it must run `pnpm jobs:run-once` from a cron.
- The ports and the metadata key become public contracts (SemVer, AGENTS.md section 17) once `docs/contracts/events.md` lists them.
- No new dependency and no new feature flag.
