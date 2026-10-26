import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EmailWorld } from "../../test/email-world.js";

/**
 * No provider call inside a database transaction or under a lock (ADR 0031 decision 6): while the provider hangs, the
 * claim is committed and visible, the row is free (`FOR UPDATE NOWAIT` from another connection succeeds) and no
 * connection of the app sits idle in a transaction. The send timeout here is 1.5 s, long enough to probe while it hangs.
 */
describe("email sender: no provider call under a lock (real Postgres)", () => {
  let world: EmailWorld;

  beforeAll(async () => {
    world = await EmailWorld.start({ emailDeliveryTuning: { sendTimeoutMs: 1_500 } });
  });

  beforeEach(async () => {
    world.clock.advanceMinutes(1);
    await world.clear();
  });

  afterAll(async () => {
    await world.stop();
  });

  async function waitForCall(id: string): Promise<void> {
    for (let tries = 0; tries < 200 && !world.provider().calls.includes(id); tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(world.provider().calls).toEqual([id]);
  }

  async function expectNothingLocked(id: string): Promise<void> {
    const probe = await world.pool.connect();
    try {
      await probe.query("begin");
      await probe.query("select 1 from email_message where id = $1 for update nowait", [id]);
      await probe.query("rollback");
      const idle = await probe.query<{ count: number }>(
        `select count(*)::int as count from pg_stat_activity
          where datname = current_database() and state like 'idle in transaction%' and pid <> pg_backend_pid()`,
      );
      expect(idle.rows[0]?.count).toBe(0);
    } finally {
      probe.release();
    }
  }

  it("job path: the claim is committed before the provider is called, and nothing is locked while it hangs", async () => {
    const id = await world.enqueued();
    world.provider().failNext({ hang: true });
    const attempt = world.attempt(id);
    await waitForCall(id);
    const row = await world.row(id);
    expect(row).toMatchObject({ status: "sending", attempts: 1 });
    await expectNothingLocked(id);
    expect(await attempt).toEqual({ kind: "retry", reason: "unavailable" });
    expect((await world.row(id)).last_error_code).toBe("unavailable:timeout");
  });

  it("immediate attempt: the same, through sendNow", async () => {
    const id = await world.enqueued();
    world.provider().failNext({ hang: true });
    const attempt = world.sender.sendNow(id);
    await waitForCall(id);
    expect((await world.row(id)).status).toBe("sending");
    await expectNothingLocked(id);
    expect((await attempt).kind).toBe("retry");
  });
});
