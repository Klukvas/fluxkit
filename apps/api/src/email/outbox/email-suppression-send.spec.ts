import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountEmailWorld } from "../../test/account-email-world.js";
import { EmailAdminWorld } from "../../test/email-admin-world.js";
import { EmailWorld, TEST_RECIPIENT } from "../../test/email-world.js";
import { captureLogs } from "../../test/shipping-fixtures.js";
import { sendEmails } from "../../jobs/send-emails.job.js";
import { EmailSuppressionService } from "../suppression/email-suppression.service.js";
import { EMAIL_SEND_PACER } from "./email-sender.js";
import { SendPacer } from "./send-pacer.js";

async function suppress(world: EmailWorld, address = TEST_RECIPIENT): Promise<void> {
  await world.pool.query(
    `insert into email_suppression (to_address, reason, source_provider, first_seen_at, last_seen_at)
     values ($1, 'complaint', 'resend', $2, $2)`,
    [address, world.clock.now()],
  );
}

describe("shared suppression sender gate (real Postgres)", () => {
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

  it.each([false, true])(
    "stops mail before pacing, preserving a prior pin (%s)",
    async (pinned) => {
      const id = await world.enqueued({ to: "  BUYER@EXAMPLE.NET  " });
      if (pinned) {
        await world.pool.query(
          "update email_message set pinned_provider_code = 'fake', pinned_at = $2 where id = $1",
          [id, world.clock.now()],
        );
      }
      await suppress(world);
      const pace = vi.spyOn(world.running.app.get<SendPacer>(EMAIL_SEND_PACER), "start");
      const logs = captureLogs();
      try {
        expect(await world.attempt(id)).toEqual({
          kind: pinned ? "unknown" : "failed",
          reason: undefined,
        });
      } finally {
        logs.stop();
      }
      expect(await world.row(id)).toMatchObject({
        status: pinned ? "unknown" : "failed",
        last_error_code: "suppressed",
        lease_until: null,
        pinned_provider_code: pinned ? "fake" : null,
      });
      expect(pace).not.toHaveBeenCalled();
      expect(world.provider().calls).toEqual([]);
      expect(logs.text()).toContain("code=suppressed");
      expect(logs.text()).not.toContain(TEST_RECIPIENT);
    },
  );

  it("blocks job 9 across another instance, without pausing unrelated recipients", async () => {
    await suppress(world);
    const blocked = await world.enqueued();
    const allowed = await world.enqueued({ to: "other@example.net" });
    const second = await world.secondInstance();
    const result = await sendEmails(
      {
        database: world.database,
        outbox: world.repository,
        sender: world.get((await import("./email-sender.js")).EmailSender, second),
      },
      world.clock.now(),
      { clock: () => world.clock.now() },
    );
    expect(result).toMatchObject({ failed: 1, sent: 1, paused: false });
    expect((await world.row(blocked)).last_error_code).toBe("suppressed");
    expect((await world.row(allowed)).status).toBe("sent");
    expect(world.provider(second).calls).toEqual([allowed]);
  });

  it("rechecks after a quota refusal on a later attempt", async () => {
    const id = await world.enqueued();
    world.provider().failNext({ reason: "quota_exceeded" });
    expect((await world.attempt(id)).kind).toBe("retry");
    await suppress(world);
    world.clock.set((await world.row(id)).next_attempt_at);
    expect((await world.attempt(id)).kind).toBe("failed");
    expect((await world.row(id)).last_error_code).toBe("suppressed");
    expect(world.provider().calls).toEqual([id]);
  });

  it("defers a failed lookup without spending an attempt, leaking an address or sending", async () => {
    const id = await world.enqueued();
    const lookup = vi
      .spyOn(world.get(EmailSuppressionService), "isSuppressed")
      .mockRejectedValueOnce(new Error(`query failed: ${TEST_RECIPIENT}`));
    const logs = captureLogs();
    try {
      expect(await world.attempt(id)).toEqual({ kind: "deferred" });
    } finally {
      logs.stop();
    }
    expect(await world.row(id)).toMatchObject({
      status: "pending",
      attempts: 0,
      lease_until: null,
    });
    expect(world.provider().calls).toEqual([]);
    expect(logs.text()).toContain("suppression_lookup_failed");
    expect(logs.text()).not.toContain(TEST_RECIPIENT);
    lookup.mockRestore();
    world.clock.set((await world.row(id)).next_attempt_at);
    expect((await world.attempt(id)).kind).toBe("sent");
  });

  it("checks suppression again after pacing deferral", async () => {
    const id = await world.enqueued();
    const pace = vi
      .spyOn(world.running.app.get<SendPacer>(EMAIL_SEND_PACER), "start")
      .mockResolvedValueOnce({ started: false });
    expect((await world.attempt(id)).kind).toBe("deferred");
    pace.mockRestore();
    await suppress(world);
    world.clock.set((await world.row(id)).next_attempt_at);
    expect((await world.attempt(id)).kind).toBe("failed");
    expect(world.provider().calls).toEqual([]);
  });

  it("cannot recall feedback arriving during admission; makes no DB read after the final slot", async () => {
    const id = await world.enqueued();
    const read = vi.spyOn(world.database, "select");
    let readsAtSlot = 0;
    const pacer = new SendPacer(
      8,
      () => world.clock.now().getTime(),
      async (ms) => {
        await suppress(world);
        readsAtSlot = read.mock.calls.length;
        world.clock.set(new Date(world.clock.now().getTime() + ms));
      },
      {
        status: "redis",
        hit: async () => ({ allowed: true }),
        reserveEmailSlot: async () => ({ waitMs: 100, slotAt: world.clock.now().getTime() + 100 }),
      },
    );
    vi.spyOn(world.running.app.get<SendPacer>(EMAIL_SEND_PACER), "start").mockImplementation(
      pacer.start.bind(pacer),
    );
    const send = world.provider().send.bind(world.provider());
    vi.spyOn(world.provider(), "send").mockImplementation((...args) => {
      expect(read.mock.calls.length).toBe(readsAtSlot);
      return send(...args);
    });
    expect((await world.attempt(id)).kind).toBe("sent");
    expect(world.provider().calls).toEqual([id]);
    const later = await world.enqueued();
    expect((await world.attempt(later)).kind).toBe("failed");
    expect(world.provider().calls).toEqual([id]);
  });
});

describe("suppression on admin test and resend paths (real Postgres)", () => {
  let ctx: EmailAdminWorld;
  beforeAll(async () => {
    ctx = await EmailAdminWorld.start();
  });
  beforeEach(async () => {
    ctx.world.clock.advanceMinutes(61);
    await ctx.world.clear();
  });
  afterAll(async () => {
    await ctx.stop();
  });

  async function failed(id: string): Promise<void> {
    await vi.waitFor(async () => {
      expect(await ctx.world.row(id)).toMatchObject({
        status: "failed",
        last_error_code: "suppressed",
      });
    });
  }

  it("blocks an admin test to the caller, preserving its accepted API response", async () => {
    const admin = await ctx.signInAs("owner");
    await suppress(ctx.world, admin.email.toLowerCase());
    const response = await ctx.call<{ messageId: string }>("POST", "/admin/email/test", {
      body: {},
    });
    expect(response.status).toBe(202);
    await failed(response.body.messageId);
    expect(ctx.world.provider().calls).toEqual([]);
  });

  it("checks a manually resent order mail using the same shared block", async () => {
    await ctx.signInAs("owner");
    const original = await ctx.world.enqueued({
      templateKey: "order.cancelled",
      recipientKind: "guest",
      variables: { orderNumber: "AAAA-1234" },
    });
    await ctx.world.pool.query(
      "update email_message set status = 'failed', last_error_code = 'rejected' where id = $1",
      [original],
    );
    await suppress(ctx.world);
    const response = await ctx.call<{ messageId: string }>(
      "POST",
      `/admin/email/messages/${original}/resend`,
    );
    expect(response.status).toBe(202);
    await failed(response.body.messageId);
    expect(ctx.world.provider().calls).toEqual([]);
  });
});

describe("suppression on immediate auth mail (real Postgres)", () => {
  let world: AccountEmailWorld;
  beforeAll(async () => {
    world = await AccountEmailWorld.start();
  });
  afterAll(async () => {
    await world.pool.query("delete from email_suppression where to_address = $1", [
      "suppressed-auth@example.test",
    ]);
    await world.stop();
  });

  it("keeps public reset responses identical and still creates the token, with no provider call", async () => {
    const customer = await world.customer({ email: "suppressed-auth@example.test" });
    await world.pool.query(
      `insert into email_suppression (to_address, reason, source_provider, first_seen_at, last_seen_at)
      values ($1, 'hard_bounce', 'resend', $2, $2)`,
      [customer.email, world.clock.now()],
    );
    const blocked = await world.requestReset(customer.email);
    const missing = await world.requestReset("no-account@example.test");
    expect(blocked.status).toBe(202);
    expect(blocked.body).toEqual(missing.body);
    expect(blocked.headers.get("content-type")).toBe(missing.headers.get("content-type"));
    await vi.waitFor(async () => {
      expect(await world.outboxRows(customer.id)).toEqual([
        expect.objectContaining({
          status: "failed",
          last_error_code: "suppressed",
        }),
      ]);
    });
    expect(await world.tokenRows(customer.id)).toHaveLength(1);
    expect(world.provider.calls).toEqual([]);
  });
});
