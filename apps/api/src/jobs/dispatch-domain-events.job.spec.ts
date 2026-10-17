import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.factory.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { startApp, type RunningApp } from "../test/app.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import {
  BrokenHandlerFixtureModule,
  EventHandlerFixtureModule,
  FixtureHandlerA,
  FixtureHandlerB,
} from "../test/event-handler-fixture.js";
import { ensureMigrated } from "../test/migrate.js";
import { dispatchDomainEvents, type DispatchEventsDeps } from "./dispatch-domain-events.job.js";
import { DomainEventHandlerRegistry } from "./domain-event-handlers.js";
import { BACKOFF_UNIT_MS, JobsRepository, MAX_DISPATCH_ATTEMPTS } from "./jobs.repository.js";

// Outbox rows are stamped by the test with explicit times; 2025-02 is before anything another spec leaves undispatched.
const T0 = new Date("2025-02-01T00:00:00.000Z");
const MINUTE = 60_000;

interface EventRow {
  id: string;
  attempts: number;
  dispatched_at: Date | null;
  last_error_code: string | null;
}

describe("dispatchDomainEvents and the handler discovery (real Postgres, injected time)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let running: RunningApp;
  let deps: DispatchEventsDeps;
  let handlerA: FixtureHandlerA;
  let handlerB: FixtureHandlerB;
  const eventIds: string[] = [];

  async function insertEvent(
    options: {
      type?: string;
      createdAt?: Date;
      attempts?: number;
      dispatchedAt?: Date | null;
    } = {},
  ): Promise<string> {
    const aggregateId = randomUUID();
    const result = await pool.query<{ id: string }>(
      `insert into domain_event (type, aggregate_id, payload, created_at, attempts, dispatched_at)
       values ($1, $2, $3::jsonb, $4, $5, $6) returning id`,
      [
        options.type ?? "order.expired",
        aggregateId,
        JSON.stringify({ orderId: aggregateId, orderNumber: "AAAA-BBBB", status: "expired" }),
        options.createdAt ?? T0,
        options.attempts ?? 0,
        options.dispatchedAt ?? null,
      ],
    );
    const id = result.rows[0]?.id ?? "";
    eventIds.push(id);
    return id;
  }

  async function rows(ids: readonly string[]): Promise<EventRow[]> {
    const result = await pool.query<EventRow>(
      "select id, attempts, dispatched_at, last_error_code from domain_event where id = any($1::uuid[])",
      [ids],
    );
    const byId = new Map(result.rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id) as EventRow);
  }

  const at = (minutes: number): Date => new Date(T0.getTime() + minutes * MINUTE);

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ extraFeatures: [{ name: "fixture", module: EventHandlerFixtureModule }] });
    deps = {
      database: running.app.get<Database>(DRIZZLE),
      repository: running.app.get(JobsRepository),
      handlers: running.app.get(DomainEventHandlerRegistry),
    };
    handlerA = running.app.get(FixtureHandlerA, { strict: false });
    handlerB = running.app.get(FixtureHandlerB, { strict: false });
  });

  afterEach(async () => {
    handlerA.reset();
    handlerB.reset();
    await pool.query("delete from domain_event where id = any($1::uuid[])", [eventIds.splice(0)]);
  });

  afterAll(async () => {
    await running.app.close();
    await pool.end();
  });

  describe("discovery", () => {
    it("finds the marked providers at startup by the event types they declare", () => {
      const registry = deps.handlers as DomainEventHandlerRegistry;
      expect(registry.handlersFor("order.expired").map((entry) => entry.name)).toEqual([
        "FixtureHandlerA",
        "FixtureHandlerB",
      ]);
      expect(registry.handlersFor("order.paid").map((entry) => entry.name)).toEqual(["FixtureHandlerA"]);
      expect(registry.handlersFor("order.cancelled")).toEqual([]);
      expect(registry.names().sort()).toEqual(["FixtureHandlerA", "FixtureHandlerB"]);
    });

    it("an application without a marked provider has no handlers", async () => {
      const plain = await startApp();
      try {
        expect(plain.app.get(DomainEventHandlerRegistry).names()).toEqual([]);
      } finally {
        await plain.app.close();
      }
    });

    it("a marked provider without handle() stops the startup loudly instead of being skipped", async () => {
      const app = await createApp(
        { databaseUrl: requireTestDatabaseUrl(), enabledFeatures: [], featuresDir: undefined },
        { extraFeatures: [{ name: "broken", module: BrokenHandlerFixtureModule }] },
      );
      try {
        await expect(app.init()).rejects.toThrow(/BrokenFixtureHandler.*handle\(event\)/);
      } finally {
        await app.close();
      }
    });
  });

  describe("delivery", () => {
    it("delivers due events oldest first (ties by id) to the handlers of their type and marks them dispatched", async () => {
      const second = await insertEvent({ createdAt: at(2) });
      const first = await insertEvent({ createdAt: at(1) });
      const third = await insertEvent({ createdAt: at(3), type: "order.paid" });
      const result = await dispatchDomainEvents(deps, at(10));
      expect(result).toEqual({
        scanned: 3,
        dispatched: 3,
        failed: 0,
        failures: [],
        abandoned: [],
        truncated: false,
      });
      expect(handlerA.calls.map((call) => call.id)).toEqual([first, second, third]);
      expect(handlerB.calls.map((call) => call.id)).toEqual([first, second]);
      expect(handlerA.calls[0]).toMatchObject({
        id: first,
        type: "order.expired",
        occurredAt: at(1),
        previousFailures: 0,
        payload: { orderNumber: "AAAA-BBBB", status: "expired" },
      });
      for (const row of await rows([first, second, third])) {
        expect(row.dispatched_at?.toISOString()).toBe(at(10).toISOString());
        expect(row.attempts).toBe(0);
        expect(row.last_error_code).toBeNull();
      }
    });

    it("marks an event with no handler dispatched without delivering anything", async () => {
      const id = await insertEvent({ type: "order.cancelled" });
      expect(await dispatchDomainEvents(deps, at(1))).toMatchObject({ scanned: 1, dispatched: 1 });
      expect(handlerA.calls).toEqual([]);
      expect((await rows([id]))[0]?.dispatched_at).not.toBeNull();
    });

    it("does not touch events created after `now`, dispatched ones, or the clock of the machine", async () => {
      const future = await insertEvent({ createdAt: at(30) });
      const done = await insertEvent({ dispatchedAt: at(1) });
      expect(await dispatchDomainEvents(deps, at(10))).toMatchObject({ scanned: 0 });
      expect((await rows([future]))[0]?.dispatched_at).toBeNull();
      expect((await rows([done]))[0]?.dispatched_at?.toISOString()).toBe(at(1).toISOString());
      expect(handlerA.calls).toEqual([]);
    });

    it("pages through many events and says when it stopped at the batch limit", async () => {
      const ids: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        ids.push(await insertEvent({ createdAt: at(index), type: "order.cancelled" }));
      }
      const first = await dispatchDomainEvents(deps, at(60), { batchSize: 2, maxBatches: 2 });
      expect(first).toMatchObject({ scanned: 4, dispatched: 4, truncated: true });
      const second = await dispatchDomainEvents(deps, at(60), { batchSize: 2, maxBatches: 2 });
      expect(second).toMatchObject({ scanned: 1, dispatched: 1, truncated: false });
      expect((await rows(ids)).every((row) => row.dispatched_at !== null)).toBe(true);
    });

    it("refuses nonsensical options", async () => {
      await expect(dispatchDomainEvents(deps, at(1), { batchSize: 0 })).rejects.toThrow(RangeError);
      await expect(dispatchDomainEvents(deps, at(1), { maxBatches: 0 })).rejects.toThrow(RangeError);
      await expect(dispatchDomainEvents(deps, at(1), { handlerTimeoutMs: 0 })).rejects.toThrow(
        RangeError,
      );
    });
  });

  describe("failure, retry and backoff", () => {
    it("a failing handler leaves the event undispatched, counts the attempt and stores a code, never the message", async () => {
      const id = await insertEvent();
      handlerA.behaviour = async () => {
        throw new TypeError("secret buyer@example.test in a message");
      };
      handlerB.behaviour = async () => {
        throw Object.assign(new Error("also secret"), { code: "ECONNRESET" });
      };
      const result = await dispatchDomainEvents(deps, at(1));
      expect(result).toMatchObject({ scanned: 1, dispatched: 0, failed: 1, abandoned: [] });
      expect(result.failures).toEqual([
        { eventId: id, type: "order.expired", handler: "FixtureHandlerA", code: "TypeError" },
        { eventId: id, type: "order.expired", handler: "FixtureHandlerB", code: "Error:ECONNRESET" },
      ]);
      expect(JSON.stringify(result)).not.toContain("buyer@example.test");
      const [row] = await rows([id]);
      expect(row).toMatchObject({ attempts: 1, dispatched_at: null, last_error_code: "TypeError" });
    });

    it("every handler of the event is called even if one fails; the event is dispatched only when ALL succeed; a retry calls all again with the same event id", async () => {
      const id = await insertEvent();
      handlerA.behaviour = async () => {
        throw new Error("down");
      };
      await dispatchDomainEvents(deps, at(1));
      expect(handlerB.calls.map((call) => call.id)).toEqual([id]);
      expect((await rows([id]))[0]?.dispatched_at).toBeNull();

      // Backoff after one failure is 1 minute from creation: T0 + 1 min is the first instant it is picked again.
      handlerA.behaviour = async () => undefined;
      expect(await dispatchDomainEvents(deps, new Date(at(1).getTime() - 1))).toMatchObject({
        scanned: 0,
      });
      expect(await dispatchDomainEvents(deps, at(1))).toMatchObject({ scanned: 1, dispatched: 1 });
      expect(handlerA.calls.map((call) => [call.id, call.previousFailures])).toEqual([
        [id, 0],
        [id, 1],
      ]);
      // Handler B succeeded the first time and is called again: handlers are idempotent by event id.
      expect(handlerB.calls.map((call) => call.id)).toEqual([id, id]);
      expect((await rows([id]))[0]?.dispatched_at).not.toBeNull();
    });

    it.each(Array.from({ length: MAX_DISPATCH_ATTEMPTS }, (_, attempts) => attempts))(
      "after %i failures an event is picked again at created_at + (2^n - 1) minutes, not a millisecond earlier",
      async (attempts) => {
        const id = await insertEvent({ attempts, type: "order.cancelled" });
        const eligibleAt = new Date(T0.getTime() + (2 ** attempts - 1) * BACKOFF_UNIT_MS);
        expect(
          await dispatchDomainEvents(deps, new Date(eligibleAt.getTime() - 1)),
        ).toMatchObject({ scanned: 0 });
        expect(await dispatchDomainEvents(deps, eligibleAt)).toMatchObject({
          scanned: 1,
          dispatched: 1,
        });
        expect((await rows([id]))[0]?.dispatched_at).not.toBeNull();
      },
    );

    it("gives up after 10 failures: reports it once, leaves it undispatched, never picks it again", async () => {
      const id = await insertEvent({ attempts: MAX_DISPATCH_ATTEMPTS - 1 });
      handlerA.behaviour = async () => {
        throw new Error("down");
      };
      const result = await dispatchDomainEvents(deps, at(24 * 60));
      expect(result).toMatchObject({ failed: 1, abandoned: [{ eventId: id, type: "order.expired" }] });
      expect((await rows([id]))[0]).toMatchObject({ attempts: 10, dispatched_at: null });

      handlerA.calls.length = 0;
      handlerA.behaviour = async () => undefined;
      const later = await dispatchDomainEvents(deps, at(365 * 24 * 60));
      expect(later).toMatchObject({ scanned: 0, abandoned: [] });
      expect(handlerA.calls).toEqual([]);
      expect((await rows([id]))[0]).toMatchObject({ attempts: 10, dispatched_at: null });
    });

    it("an event that is already at the limit is not picked", async () => {
      await insertEvent({ attempts: MAX_DISPATCH_ATTEMPTS });
      expect(await dispatchDomainEvents(deps, at(365 * 24 * 60))).toMatchObject({ scanned: 0 });
    });

    it("attempts each event at most once per run, even when it stays due", async () => {
      const ids: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        ids.push(await insertEvent({ createdAt: at(index) }));
      }
      handlerA.behaviour = async () => {
        throw new Error("down");
      };
      // Old events are due again right after a failure (their backoff counts from creation): the cursor stops the loop.
      const result = await dispatchDomainEvents(deps, at(600), { batchSize: 2 });
      expect(result).toMatchObject({ scanned: 3, failed: 3, truncated: false });
      expect((await rows(ids)).map((row) => row.attempts)).toEqual([1, 1, 1]);
    });

    it("commits the good outcomes of a batch next to the failed one", async () => {
      const ok1 = await insertEvent({ createdAt: at(1) });
      const bad = await insertEvent({ createdAt: at(2) });
      const ok2 = await insertEvent({ createdAt: at(3) });
      handlerA.behaviour = async (event) => {
        if (event.id === bad) throw new Error("down");
      };
      await dispatchDomainEvents(deps, at(10), { batchSize: 10 });
      const [r1, r2, r3] = await rows([ok1, bad, ok2]);
      expect(r1?.dispatched_at).not.toBeNull();
      expect(r2).toMatchObject({ attempts: 1, dispatched_at: null });
      expect(r3?.dispatched_at).not.toBeNull();
    });

    it("a handler that never answers fails with HandlerTimeout instead of holding the tick forever", async () => {
      const id = await insertEvent({ type: "order.paid" });
      handlerA.behaviour = () => new Promise<void>(() => undefined);
      const result = await dispatchDomainEvents(deps, at(1), { handlerTimeoutMs: 50 });
      expect(result.failures).toEqual([
        { eventId: id, type: "order.paid", handler: "FixtureHandlerA", code: "HandlerTimeout" },
      ]);
      expect((await rows([id]))[0]).toMatchObject({
        attempts: 1,
        last_error_code: "HandlerTimeout",
        dispatched_at: null,
      });
    });
  });

  describe("two dispatchers at once", () => {
    it("never deliver the same event twice, and neither waits for the rows of the other (SKIP LOCKED)", async () => {
      const ids: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        ids.push(await insertEvent({ createdAt: at(index), type: "order.paid" }));
      }
      // Both dispatchers must be inside a handler at the same moment, or the barrier fails the delivery. A dispatcher that
      // waited for the other's row locks could never get there.
      let inside = 0;
      let release: () => void = () => undefined;
      const together = new Promise<void>((resolve) => {
        release = resolve;
      });
      handlerA.behaviour = async () => {
        inside += 1;
        if (inside >= 2) release();
        await Promise.race([
          together,
          new Promise<void>((_, reject) =>
            setTimeout(() => {
              reject(new Error("the other dispatcher never got to a handler"));
            }, 3_000),
          ),
        ]);
      };
      const [first, second] = await Promise.all([
        dispatchDomainEvents(deps, at(10), { batchSize: 2 }),
        dispatchDomainEvents(deps, at(10), { batchSize: 2 }),
      ]);
      expect(first.failures).toEqual([]);
      expect(second.failures).toEqual([]);
      expect(first.dispatched + second.dispatched).toBe(4);
      const delivered = handlerA.calls.map((call) => call.id).sort();
      expect(delivered).toEqual([...ids].sort());
      expect((await rows(ids)).every((row) => row.dispatched_at !== null && row.attempts === 0)).toBe(
        true,
      );
    });
  });
});
