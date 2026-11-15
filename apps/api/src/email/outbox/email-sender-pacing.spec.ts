import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowStore } from "../../rate-limit/window-store.js";
import { EmailWorld } from "../../test/email-world.js";
import { EMAIL_SEND_PACER } from "./email-sender.js";
import { SendPacer } from "./send-pacer.js";

describe("sender pacing admission (real Postgres, fake clock)", () => {
  let world: EmailWorld;
  beforeAll(async () => {
    world = await EmailWorld.start();
  });
  beforeEach(async () => {
    world.clock.advanceMinutes(1);
    await world.clear();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await world.stop();
  });

  function install(waitMs: number, sleep: (ms: number) => Promise<void>) {
    const store: WindowStore = {
      status: "redis",
      hit: async () => ({ allowed: true }),
      reserveEmailSlot: async () => ({ waitMs, slotAt: world.clock.now().getTime() + waitMs }),
    };
    const pacer = new SendPacer(8, () => world.clock.now().getTime(), sleep, store);
    const injected = world.running.app.get<SendPacer>(EMAIL_SEND_PACER);
    vi.spyOn(injected, "start").mockImplementation(pacer.start.bind(pacer));
  }

  it("defers a backlog beyond the lease without sleeping or spending an attempt, then can retry", async () => {
    const sleep = vi.fn(async () => undefined);
    install(120_000, sleep);
    const id = await world.enqueued();
    expect(await world.attempt(id)).toEqual({ kind: "deferred" });
    expect(sleep).not.toHaveBeenCalled();
    expect(world.provider().calls).toEqual([]);
    expect(await world.row(id)).toMatchObject({
      status: "pending",
      attempts: 0,
      lease_until: null,
    });
    vi.restoreAllMocks();
    world.clock.set((await world.row(id)).next_attempt_at);
    expect((await world.attempt(id)).kind).toBe("sent");
    expect((await world.row(id)).attempts).toBe(1);
  });

  it("refuses a reservation beyond the message deadline", async () => {
    const sleep = vi.fn(async () => undefined);
    install(2_000, sleep);
    const id = await world.enqueued();
    await world.pool.query("update email_message set deadline_at = $2 where id = $1", [
      id,
      new Date(world.clock.now().getTime() + 1_000),
    ]);
    expect(await world.attempt(id)).toEqual({ kind: "deferred" });
    expect(sleep).not.toHaveBeenCalled();
    expect(world.provider().calls).toEqual([]);
    world.clock.set((await world.row(id)).deadline_at);
    expect(await world.attempt(id)).toEqual({ kind: "expired", status: "failed" });
    expect((await world.row(id)).attempts).toBe(0);
  });

  it("never calls the provider if a delayed timer crosses the deadline", async () => {
    install(100, async () => {
      world.clock.set(new Date(world.clock.now().getTime() + 2_000));
    });
    const id = await world.enqueued();
    await world.pool.query("update email_message set deadline_at = $2 where id = $1", [
      id,
      new Date(world.clock.now().getTime() + 1_000),
    ]);
    expect(await world.attempt(id)).toEqual({ kind: "deferred" });
    expect(world.provider().calls).toEqual([]);
    expect((await world.row(id)).attempts).toBe(0);
    expect(await world.attempt(id)).toEqual({ kind: "expired", status: "failed" });
  });

  it("does not send or overwrite a claim acquired by another sender during the wait", async () => {
    const id = await world.enqueued();
    install(100, async () => {
      world.clock.advanceMinutes(3);
      expect((await world.changes.claim(id, world.clock.now(), "fake")).kind).toBe("claimed");
    });
    expect(await world.attempt(id)).toEqual({ kind: "lost" });
    expect(world.provider().calls).toEqual([]);
    expect(await world.row(id)).toMatchObject({ status: "sending", attempts: 2 });
  });

  it.each(["lease", "deadline"])(
    "keeps provider starts before the safe %s boundary",
    async (boundary) => {
      const startAt = world.clock.now().getTime();
      const id = await world.enqueued();
      const boundaryAt = boundary === "lease" ? startAt + 120_000 - 300 - 5_000 : startAt + 1_000;
      if (boundary === "deadline") {
        await world.pool.query("update email_message set deadline_at = $2 where id = $1", [
          id,
          new Date(boundaryAt),
        ]);
      }
      install(boundaryAt - startAt - 1, async (ms) => {
        world.clock.set(new Date(world.clock.now().getTime() + ms));
      });
      const providerSend = world.provider().send.bind(world.provider());
      const send = vi.spyOn(world.provider(), "send");
      send.mockImplementation((...args) => {
        expect(world.clock.now().getTime()).toBe(boundaryAt - 1);
        return providerSend(...args);
      });
      expect((await world.attempt(id)).kind).toBe("sent");
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it("defers when a late timer reaches the safe lease boundary", async () => {
    install(100, async () => {
      world.clock.set(new Date(world.clock.now().getTime() + 120_000 - 300 - 5_000));
    });
    const id = await world.enqueued();
    expect(await world.attempt(id)).toEqual({ kind: "deferred" });
    expect(world.provider().calls).toEqual([]);
    expect((await world.row(id)).attempts).toBe(0);
  });

  it("does no admission read and admits another send while the result database call hangs", async () => {
    install(100, async (ms) => {
      world.clock.set(new Date(world.clock.now().getTime() + ms));
    });
    const ids = [await world.enqueued(), await world.enqueued()];
    const firstId = ids[0];
    const secondId = ids[1];
    if (firstId === undefined || secondId === undefined) throw new Error("Missing test mails");
    // Claims and result updates use short transactions. A former pre-send read used the database directly.
    const read = vi.spyOn(world.database, "select").mockImplementation(() => {
      throw new Error("unexpected_admission_read");
    });
    const record = world.changes.record.bind(world.changes);
    let entered: () => void = () => undefined;
    const recording = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release: () => void = () => undefined;
    const databaseReply = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(world.changes, "record").mockImplementationOnce(async (...args) => {
      entered();
      await databaseReply;
      return record(...args);
    });
    const first = world.attempt(firstId);
    try {
      await recording;
      expect((await world.attempt(secondId)).kind).toBe("sent");
      expect(world.provider().calls).toHaveLength(2);
      expect(read).not.toHaveBeenCalled();
    } finally {
      release();
      await first;
    }
  });
});
