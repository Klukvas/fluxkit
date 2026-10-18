import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { startApp, type RunningApp } from "../test/app.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import { dispatchDomainEvents, type DispatchEventsDeps } from "./dispatch-domain-events.job.js";
import type { DomainEventHandlerSource } from "./domain-event-handlers.js";
import { EVENT_LEASE_CLASS, pgEventLeaseSource } from "./event-leases.js";
import { JobBudget } from "./job-budget.js";
import { JobsRepository, MAX_DISPATCH_ATTEMPTS } from "./jobs.repository.js";
import type { DomainEventEnvelope } from "@fluxkit/core";

// Review fix Medium 1 (ADR 0025): the attempt is committed BEFORE a handler runs, handlers run with no transaction
// open, the result is recorded in a second short transaction, and a lease keeps two dispatchers off one event.
const T0 = new Date("2025-03-01T00:00:00.000Z");
const NOW = new Date("2026-01-01T00:00:00.000Z");
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Row {
  attempts: number;
  dispatched_at: Date | null;
  last_error_code: string | null;
}

describe("the outbox dispatcher survives a dying batch (real Postgres)", () => {
  const url = requireTestDatabaseUrl();
  const dbName = new URL(url).pathname.slice(1);
  const pool = new pg.Pool({ connectionString: url });
  const ids: string[] = [];
  let running: RunningApp;
  let repository: JobsRepository;
  let database: Database;
  let seen: DomainEventEnvelope[] = [];
  let behaviour: (event: DomainEventEnvelope) => Promise<void> = async () => undefined;

  const handlers: DomainEventHandlerSource = {
    handlersFor: () => [
      {
        name: "Probe",
        handler: {
          handle: async (event: DomainEventEnvelope) => {
            seen.push(event);
            await behaviour(event);
          },
        },
      },
    ],
  };
  const deps = (over: Partial<DispatchEventsDeps> = {}): DispatchEventsDeps => ({
    database,
    repository,
    handlers,
    leases: pgEventLeaseSource(url),
    ...over,
  });

  async function insertEvent(createdAt = T0): Promise<string> {
    const aggregateId = randomUUID();
    const inserted = await pool.query<{ id: string }>(
      `insert into domain_event (type, aggregate_id, payload, created_at)
       values ('order.paid', $1, '{}'::jsonb, $2) returning id`,
      [aggregateId, createdAt],
    );
    const id = inserted.rows[0]?.id ?? "";
    ids.push(id);
    return id;
  }
  async function row(id: string): Promise<Row> {
    const result = await pool.query<Row>(
      "select attempts, dispatched_at, last_error_code from domain_event where id = $1",
      [id],
    );
    return result.rows[0] as Row;
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp();
    database = running.app.get<Database>(DRIZZLE);
    repository = running.app.get(JobsRepository);
  });

  afterEach(async () => {
    seen = [];
    behaviour = async () => undefined;
    await pool.query("delete from domain_event where id = any($1::uuid[])", [ids.splice(0)]);
  });

  afterAll(async () => {
    await running.app.close();
    await pool.end();
  });

  it("a handler that runs longer than idle_in_transaction_session_timeout completes: nothing waits inside a transaction (the review probe)", async () => {
    await pool.query(`alter database ${dbName} set idle_in_transaction_session_timeout = '1s'`);
    const own = await startApp();
    try {
      const id = await insertEvent();
      behaviour = () => sleep(1_600);
      const result = await dispatchDomainEvents(
        {
          database: own.app.get<Database>(DRIZZLE),
          repository: own.app.get(JobsRepository),
          handlers,
          leases: pgEventLeaseSource(url),
        },
        NOW,
      );
      expect(result).toMatchObject({ scanned: 1, dispatched: 1, failed: 0 });
      expect(seen).toHaveLength(1);
      expect(await row(id)).toMatchObject({ attempts: 1 });
      expect((await row(id)).dispatched_at).not.toBeNull();
    } finally {
      await pool.query(`alter database ${dbName} reset idle_in_transaction_session_timeout`);
      await own.app.close();
    }
  }, 30_000);

  it("no transaction is open while a handler runs", async () => {
    await insertEvent();
    let open = -1;
    behaviour = async () => {
      const result = await pool.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity
         where datname = current_database() and pid <> pg_backend_pid() and state like 'idle in transaction%'`,
      );
      open = result.rows[0]?.n ?? -1;
    };
    await dispatchDomainEvents(deps(), NOW);
    expect(open).toBe(0);
  });

  it("the attempt is committed before the handler runs", async () => {
    const id = await insertEvent();
    let during: Row | undefined;
    behaviour = async () => {
      during = await row(id);
    };
    await dispatchDomainEvents(deps(), NOW);
    expect(during).toMatchObject({ attempts: 1, dispatched_at: null });
    expect(seen[0]?.previousFailures).toBe(0);
  });

  it("when the result cannot be recorded (the process dies after the handler) the attempt still counts, and the event is delivered again", async () => {
    const id = await insertEvent();
    const dying = Object.create(repository) as JobsRepository;
    dying.markEventDispatched = () => Promise.reject(new Error("connection lost"));
    await expect(dispatchDomainEvents(deps({ repository: dying }), NOW)).rejects.toThrow(
      "connection lost",
    );
    expect(await row(id)).toMatchObject({ attempts: 1, dispatched_at: null });

    const later = await dispatchDomainEvents(deps(), NOW);
    expect(later).toMatchObject({ scanned: 1, dispatched: 1 });
    expect(seen.map((event) => event.previousFailures)).toEqual([0, 1]);
  });

  it("an event whose dispatcher keeps dying is given up after MAX_DISPATCH_ATTEMPTS instead of being redelivered for ever", async () => {
    const id = await insertEvent();
    const dying = Object.create(repository) as JobsRepository;
    dying.markEventDispatched = () => Promise.reject(new Error("connection lost"));
    for (let run = 0; run < MAX_DISPATCH_ATTEMPTS + 3; run += 1) {
      await dispatchDomainEvents(deps({ repository: dying }), NOW).catch(() => undefined);
    }
    expect(seen).toHaveLength(MAX_DISPATCH_ATTEMPTS);
    expect(await row(id)).toMatchObject({ attempts: MAX_DISPATCH_ATTEMPTS, dispatched_at: null });
  });

  it("an event another dispatcher is delivering is skipped; when that session dies (a crash) it is delivered, not stuck", async () => {
    const id = await insertEvent();
    const holder = new pg.Client({ connectionString: url, application_name: "lease-holder-probe" });
    await holder.connect();
    holder.on("error", () => undefined);
    const locked = await holder.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1::int, hashtext($2)) as locked",
      [EVENT_LEASE_CLASS, id],
    );
    expect(locked.rows[0]?.locked).toBe(true);

    const blocked = await dispatchDomainEvents(deps(), NOW);
    expect(blocked).toMatchObject({ scanned: 0, dispatched: 0, skipped: 1 });
    expect(seen).toEqual([]);
    expect(await row(id)).toMatchObject({ attempts: 0, dispatched_at: null });

    await pool.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'lease-holder-probe'",
    );
    await sleep(100);
    const freed = await dispatchDomainEvents(deps(), NOW);
    expect(freed).toMatchObject({ scanned: 1, dispatched: 1, skipped: 0 });
    expect(seen).toHaveLength(1);
  });

  it("two dispatchers started together deliver a slow, old event once", async () => {
    await insertEvent();
    behaviour = () => sleep(400);
    const [first, second] = await Promise.all([
      dispatchDomainEvents(deps(), NOW),
      dispatchDomainEvents(deps(), NOW),
    ]);
    expect(seen).toHaveLength(1);
    expect(first.dispatched + second.dispatched).toBe(1);
    expect(first.skipped + second.skipped).toBe(1);
  });

  it("the claim re-checks the event: one another dispatcher delivered, or failed into its backoff, between the list and the claim is left alone", async () => {
    const delivered = await insertEvent();
    const failedElsewhere = await insertEvent(new Date(T0.getTime() + 1_000));
    const racing = Object.create(repository) as JobsRepository;
    racing.listDueEvents = async (...args) => {
      const listed = await repository.listDueEvents(...args);
      // Between the list and the claim, another dispatcher finishes the first event and fails the second one.
      await pool.query("update domain_event set dispatched_at = $2 where id = $1", [
        delivered,
        NOW,
      ]);
      await pool.query(
        "update domain_event set attempts = 4, last_error_code = 'TypeError' where id = $1",
        [failedElsewhere],
      );
      return listed;
    };
    // Two minutes after creation: an event with 4 attempts waits until minute 15.
    const early = new Date(T0.getTime() + 2 * 60_000);
    const result = await dispatchDomainEvents(deps({ repository: racing }), early);
    expect(result).toMatchObject({ scanned: 0, dispatched: 0, skipped: 2 });
    expect(seen).toEqual([]);
    expect(await row(failedElsewhere)).toMatchObject({ attempts: 4, dispatched_at: null });
  });

  it("an event whose row another transaction holds is skipped at once, not waited for (SKIP LOCKED)", async () => {
    const id = await insertEvent();
    const holder = await pool.connect();
    await holder.query("begin");
    await holder.query("select 1 from domain_event where id = $1 for update", [id]);
    const startedAt = Date.now();
    try {
      const result = await dispatchDomainEvents(deps(), NOW);
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(result).toMatchObject({ scanned: 0, skipped: 1 });
      expect(seen).toEqual([]);
    } finally {
      await holder.query("rollback");
      holder.release();
    }
  });

  it("stops starting events when the time budget of the run is used up and says so", async () => {
    const first = await insertEvent(new Date(T0.getTime()));
    const second = await insertEvent(new Date(T0.getTime() + 1_000));
    let ticks = 0;
    // Exhausted after the first event: the clock jumps 1 s per question, the budget is 1.5 s.
    const budget = new JobBudget(1_500, () => {
      ticks += 1;
      return ticks * 1_000;
    });
    const result = await dispatchDomainEvents(deps(), NOW, { budget });
    expect(result).toMatchObject({ scanned: 1, dispatched: 1, truncated: true });
    expect((await row(first)).dispatched_at).not.toBeNull();
    expect((await row(second)).dispatched_at).toBeNull();
    expect((await row(second)).attempts).toBe(0);
  });
});
