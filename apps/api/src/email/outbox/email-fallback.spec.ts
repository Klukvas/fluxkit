import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailProviderFailure, EMAIL_LEASE_SECONDS } from "@fluxkit/core";
import { EmailWorld } from "../../test/email-world.js";
import { startApp, type RunningApp } from "../../test/app.js";
import {
  testEmailPair,
  TestFallbackEmailProvider,
  TestPrimaryEmailProvider,
} from "../../test/test-email-pair.js";
import { recordEmailProviderCooldown } from "./email-provider-state.js";
import { withTransaction } from "../../common/transaction.js";
import { EmailMessageChanges } from "./email-message-changes.js";
import { EMAIL_SEND_PACER } from "./email-sender.js";
import { SendPacer } from "./send-pacer.js";
import { sendEmails } from "../../jobs/send-emails.job.js";

describe("safe email fallback (real Postgres, independent provider key stores)", () => {
  let world: EmailWorld;
  const a = (running = world.running) => running.app.get(TestPrimaryEmailProvider);
  const b = (running = world.running) => running.app.get(TestFallbackEmailProvider);
  beforeAll(async () => {
    world = await EmailWorld.start({ extraEmailProviders: testEmailPair() });
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    world.clock.advanceMinutes(1);
    await world.clear();
    for (const running of world.apps) {
      a(running).reset();
      b(running).reset();
    }
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await world.stop();
  });
  async function second(): Promise<RunningApp> {
    const running = await startApp({
      clock: world.clock,
      extraEmailProviders: testEmailPair(),
      emailDeliveryTuning: { sendTimeoutMs: 300, sendsPerSecond: 1000 },
    });
    world.apps.push(running);
    return running;
  }
  async function expireCooldown(code = "fake") {
    await world.pool.query(
      "update email_provider_state set unavailable_until = clock_timestamp() - interval '1 second', probe_token = null, probe_until = null where provider_code = $1",
      [code],
    );
  }

  it.each(["quota_exceeded", "rate_limited", "misconfigured", "not_sent"] as const)(
    "advances after proven %s with the original UUID and actual accepting provider",
    async (reason) => {
      const id = await world.enqueued();
      a().failNext({ reason });
      expect(await world.attempt(id)).toEqual({ kind: "sent", reason: undefined });
      expect(a().calls).toEqual([id]);
      expect(b().calls).toEqual([id]);
      expect(await world.row(id)).toMatchObject({
        status: "sent",
        provider_code: "fake_fallback",
        route_provider_code: null,
        pinned_provider_code: null,
        attempts: 2,
      });
      expect(b().sent[0]?.idempotencyKey).toBe(id);
    },
  );
  it.each(["rejected", "idempotency_conflict", "unavailable"] as const)(
    "never advances after %s",
    async (reason) => {
      const id = await world.enqueued();
      a().failNext({ reason });
      expect((await world.attempt(id)).kind).toBe(
        reason === "rejected" ? "failed" : reason === "idempotency_conflict" ? "unknown" : "retry",
      );
      expect(b().calls).toEqual([]);
      if (reason === "unavailable") expect((await world.row(id)).pinned_provider_code).toBe("fake");
    },
  );
  it("advances safely after a 31-day server delay and persists the entire cooldown", async () => {
    const id = await world.enqueued();
    a().failNext({ reason: "rate_limited", retryAfterSeconds: 31 * 86400 });
    expect((await world.attempt(id)).kind).toBe("sent");
    expect(a().calls).toEqual([id]);
    expect(b().calls).toEqual([id]);
    expect(await world.row(id)).toMatchObject({
      provider_code: "fake_fallback",
      pinned_provider_code: null,
    });
    const row = (
      await world.pool.query(
        "select extract(epoch from(unavailable_until-clock_timestamp()))::float8 remaining from email_provider_state where provider_code='fake'",
      )
    ).rows[0] as { remaining: number };
    expect(row.remaining).toBeGreaterThan(31 * 86400 - 10);
    expect(row.remaining).toBeLessThanOrEqual(31 * 86400);
  });
  it.each([
    [false, 0, 600],
    [true, 0, 600],
    [true, 6, 3600],
  ] as const)(
    "honors message Retry-After on an exhausted chain (prior fallback cooldown: %s, prior attempts: %s)",
    async (priorCooldown, priorAttempts, delaySeconds) => {
      const id = await world.enqueued();
      await world.pool.query("update email_message set attempts=$2 where id=$1", [
        id,
        priorAttempts,
      ]);
      if (priorCooldown) {
        await world.pool.query(
          "insert into email_provider_state(provider_code,unavailable_until,reason,updated_at) values ('fake_fallback',clock_timestamp()-interval '1 second','rate_limited',clock_timestamp())",
        );
      }
      a().failNext({ reason: "rate_limited", retryAfterSeconds: priorAttempts > 0 ? 7200 : 3600 });
      b().failNext({ reason: "not_sent", retryAfterSeconds: 600 });
      expect((await world.attempt(id)).kind).toBe("retry");
      const row = await world.row(id);
      expect(row).toMatchObject({
        status: "pending",
        attempts: priorAttempts + 2,
        route_provider_code: null,
      });
      expect(row.next_attempt_at.getTime() - world.clock.now().getTime()).toBe(delaySeconds * 1000);
      world.clock.advanceMinutes(2);
      expect(await world.attempt(id)).toEqual({ kind: "skipped" });
      expect(b().calls).toEqual([id]);
      if (priorCooldown) await expireCooldown("fake_fallback");
      world.clock.set(row.next_attempt_at);
      expect((await world.attempt(id)).kind).toBe("sent");
      expect(a().calls).toEqual([id]);
      expect(b().calls).toEqual([id, id]);
    },
  );
  it("can retry another provider before the exhausted fallback's message Retry-After", async () => {
    const id = await world.enqueued();
    a().failNext({ reason: "rate_limited", retryAfterSeconds: 5 });
    b().failNext({ reason: "not_sent", retryAfterSeconds: 600 });
    expect((await world.attempt(id)).kind).toBe("retry");
    const row = await world.row(id);
    const waitMs = row.next_attempt_at.getTime() - world.clock.now().getTime();
    expect(waitMs).toBeGreaterThan(1000);
    expect(waitMs).toBeLessThanOrEqual(5000);
    await expireCooldown();
    world.clock.set(row.next_attempt_at);
    expect((await world.attempt(id)).kind).toBe("sent");
    expect(a().calls).toEqual([id, id]);
    expect(b().calls).toEqual([id]);
  });
  it("never advances after ambiguous acceptance followed by a safe quota refusal", async () => {
    const id = await world.enqueued();
    a().failNext({ reason: "unavailable", afterEffect: true });
    await world.attempt(id);
    world.clock.set((await world.row(id)).next_attempt_at);
    a().failNext({ reason: "quota_exceeded" });
    expect((await world.attempt(id)).kind).toBe("retry");
    expect(b().calls).toEqual([]);
    expect(a().sent).toHaveLength(1);
    expect((await world.row(id)).pinned_provider_code).toBe("fake");
  });
  it("commits deferred B when job budget is low and restarts at B", async () => {
    const id = await world.enqueued();
    a().failNext({ reason: "quota_exceeded" });
    let budget = 20000;
    const send = a().send.bind(a());
    vi.spyOn(a(), "send").mockImplementation((...args) => {
      budget = 5000;
      return send(...args);
    });
    expect(
      (
        await world.sender.attempt(
          id,
          () => world.clock.now(),
          undefined,
          () => budget,
        )
      ).kind,
    ).toBe("retry");
    expect(await world.row(id)).toMatchObject({
      route_provider_code: "fake_fallback",
      status: "pending",
    });
    expect(b().calls).toEqual([]);
    const restarted = await second();
    expect((await world.attempt(id, restarted)).kind).toBe("sent");
    expect(a(restarted).calls).toEqual([]);
    expect(b(restarted).calls).toEqual([id]);
  });
  it("leaves deferred B when A consumes the original lease budget", async () => {
    const id = await world.enqueued();
    vi.spyOn(a(), "send").mockImplementation(async () => {
      world.clock.set(new Date(world.clock.now().getTime() + EMAIL_LEASE_SECONDS * 1000 - 5000));
      return emailProviderFailure("not_sent");
    });
    expect((await world.attempt(id)).kind).toBe("retry");
    expect((await world.row(id)).route_provider_code).toBe("fake_fallback");
    expect(b().calls).toEqual([]);
  });
  it("persists shared cooldown across instances and grants a single recovery probe", async () => {
    const first = await world.enqueued();
    a().failNext({ reason: "quota_exceeded" });
    await world.attempt(first);
    const other = await second();
    const next = await world.enqueued();
    await world.attempt(next, other);
    expect(a(other).calls).toEqual([]);
    expect(b(other).calls).toEqual([next]);
    await expireCooldown();
    const one = await world.enqueued();
    const two = await world.enqueued();
    const providers = [a(), b()];
    const otherProviders = [a(other), b(other)];
    const claims = await Promise.all([
      world.changes.claim(one, world.clock.now(), "fake", undefined, a().capabilities, {
        providers,
        excluded: [],
      }),
      other.app
        .get(EmailMessageChanges)
        .claim(two, world.clock.now(), "fake", undefined, a(other).capabilities, {
          providers: otherProviders,
          excluded: [],
        }),
    ]);
    expect(
      claims.filter((claim) => claim.kind === "claimed" && claim.message.providerCode === "fake"),
    ).toHaveLength(1);
    expect(
      claims.filter(
        (claim) => claim.kind === "claimed" && claim.message.providerCode === "fake_fallback",
      ),
    ).toHaveLength(1);
    const probe = claims.find(
      (claim) => claim.kind === "claimed" && claim.message.providerCode === "fake",
    );
    if (probe?.kind !== "claimed") throw new Error("Missing recovery probe");
    await world.changes.record(
      probe.message,
      { kind: "sent", providerMessageId: "probe-success" },
      world.clock.now(),
      undefined,
      a().capabilities,
      {
        nextProviderCode: null,
        chainCodes: ["fake", "fake_fallback"],
        probeToken: probe.message.providerProbeToken,
      },
    );
    expect(
      (await world.pool.query("select * from email_provider_state where provider_code = 'fake'"))
        .rows,
    ).toEqual([]);
  });
  it("extends cooldown atomically with max semantics across observations", async () => {
    await withTransaction(world.database, (tx) =>
      recordEmailProviderCooldown(
        tx,
        "resend",
        emailProviderFailure("rate_limited", { retryAfterSeconds: 600 }),
        1,
      ),
    );
    const before = (
      await world.pool.query(
        "select unavailable_until from email_provider_state where provider_code='resend'",
      )
    ).rows[0]?.unavailable_until as Date;
    await withTransaction(world.database, (tx) =>
      recordEmailProviderCooldown(
        tx,
        "resend",
        emailProviderFailure("rate_limited", { retryAfterSeconds: 7 }),
        1,
      ),
    );
    expect(
      (
        await world.pool.query(
          "select unavailable_until from email_provider_state where provider_code='resend'",
        )
      ).rows[0]?.unavailable_until,
    ).toEqual(before);
  });
  it("never lets a stale probe clear a newer max-extended cooldown", async () => {
    a().failNext({ reason: "rate_limited", retryAfterSeconds: 600 });
    await world.attempt(await world.enqueued());
    await expireCooldown();
    const probeId = await world.enqueued();
    const claim = await world.changes.claim(
      probeId,
      world.clock.now(),
      "fake",
      undefined,
      a().capabilities,
      { providers: [a(), b()], excluded: [] },
    );
    if (claim.kind !== "claimed") throw new Error("Missing claim");
    await world.pool.query(
      "update email_provider_state set unavailable_until = clock_timestamp() + interval '2 hours', probe_token = null, probe_until = null where provider_code = 'fake'",
    );
    await world.changes.record(
      claim.message,
      { kind: "sent", providerMessageId: "late-probe" },
      world.clock.now(),
      undefined,
      a().capabilities,
      {
        nextProviderCode: null,
        chainCodes: ["fake", "fake_fallback"],
        probeToken: claim.message.providerProbeToken,
      },
    );
    expect(
      (await world.pool.query("select * from email_provider_state where provider_code = 'fake'"))
        .rows,
    ).toHaveLength(1);
  });
  it("checks shared suppression again before B, including an immediate sender", async () => {
    const id = await world.enqueued();
    vi.spyOn(a(), "send").mockImplementation(async () => {
      await world.pool.query(
        "insert into email_suppression (to_address,reason,source_provider,first_seen_at,last_seen_at) values ($1,'complaint','fake', $2, $2)",
        ["buyer@example.net", world.clock.now()],
      );
      return emailProviderFailure("quota_exceeded");
    });
    expect((await world.sender.sendNow(id)).kind).toBe("failed");
    expect(b().calls).toEqual([]);
    expect((await world.row(id)).last_error_code).toBe("suppressed");
  });
  it("resets exhausted routes and waits, while a blocked pin does not stop other job mail", async () => {
    const pin = await world.enqueued();
    a().failNext({ reason: "unavailable" });
    await world.attempt(pin);
    world.clock.set((await world.row(pin)).next_attempt_at);
    a().failNext({ reason: "quota_exceeded" });
    await world.attempt(pin);
    const id = await world.enqueued();
    b().failNext({ reason: "rate_limited", retryAfterSeconds: 7 });
    expect((await world.attempt(id)).kind).toBe("retry");
    expect(await world.row(id)).toMatchObject({ route_provider_code: null, status: "pending" });
    expect((await world.row(id)).next_attempt_at.getTime()).toBeGreaterThan(
      world.clock.now().getTime(),
    );
    await expireCooldown("fake_fallback");
    const another = await world.enqueued();
    const job = await sendEmails(
      { database: world.database, outbox: world.repository, sender: world.sender },
      world.clock.now(),
      { clock: () => world.clock.now() },
    );
    expect(job.sent).toBe(1);
    expect((await world.row(another)).provider_code).toBe("fake_fallback");
  });
  it("holds a removed pinned fallback with a single provider configured, then expires unknown", async () => {
    const id = await world.enqueued();
    a().failNext({ reason: "quota_exceeded" });
    b().failNext({ reason: "unavailable" });
    await world.attempt(id);
    const before = await world.row(id);
    expect(before.pinned_provider_code).toBe("fake_fallback");
    const removed = await startApp({
      clock: world.clock,
      extraEmailProviders: testEmailPair().slice(0, 1),
    });
    try {
      Object.defineProperty(a(removed), "capabilities", {
        value: { idempotencyKeys: false, maxRecipients: 1 },
        configurable: true,
      });
      world.clock.set(before.next_attempt_at);
      expect(await world.attempt(id, removed)).toEqual({ kind: "skipped" });
      expect(await world.row(id)).toMatchObject({
        pinned_provider_code: "fake_fallback",
        last_error_code: "pinned_provider_unavailable",
      });
      world.clock.set(before.deadline_at);
      expect(await world.attempt(id, removed)).toEqual({ kind: "expired", status: "unknown" });
      expect(a(removed).calls).toEqual([]);
    } finally {
      await removed.app.close();
    }
  });
  it("rolls back cooldown and route atomically on a record failure, and lease recovery pins A", async () => {
    const id = await world.enqueued();
    a().failNext({ reason: "quota_exceeded" });
    const update = world.repository.update.bind(world.repository);
    vi.spyOn(world.repository, "update").mockImplementation(async (tx, messageId, values) => {
      if (values.status === "pending") throw new Error("test_record_commit_failed");
      return update(tx, messageId, values);
    });
    await expect(world.attempt(id)).rejects.toThrow("test_record_commit_failed");
    expect((await world.pool.query("select * from email_provider_state")).rows).toEqual([]);
    expect((await world.row(id)).route_provider_code).toBeNull();
    expect(b().calls).toEqual([]);
    vi.restoreAllMocks();
    world.clock.advanceMinutes(3);
    const claim = await world.changes.claim(
      id,
      world.clock.now(),
      "fake",
      undefined,
      a().capabilities,
      { providers: [a(), b()], excluded: [] },
    );
    expect(claim.kind).toBe("claimed");
    expect((await world.row(id)).pinned_provider_code).toBe("fake");
  });
  it("preserves a shared primary cooldown after the fallback is removed", async () => {
    a().failNext({ reason: "quota_exceeded" });
    await world.attempt(await world.enqueued());
    const single = await startApp({
      clock: world.clock,
      extraEmailProviders: testEmailPair().slice(0, 1),
    });
    try {
      const id = await world.enqueued();
      expect(await world.attempt(id, single)).toEqual({ kind: "skipped" });
      expect(a(single).calls).toEqual([]);
      await expireCooldown();
      world.clock.set((await world.row(id)).next_attempt_at);
      expect((await world.attempt(id, single)).kind).toBe("sent");
      expect(
        (await world.pool.query("select * from email_provider_state where provider_code='fake'"))
          .rows,
      ).toEqual([]);
    } finally {
      await single.app.close();
    }
  });
  it("restarts an exhausted deferred pass at the earliest cooldown in the entire chain", async () => {
    const id = await world.enqueued();
    await world.pool.query(
      "update email_message set route_provider_code='fake_fallback' where id=$1",
      [id],
    );
    await world.pool.query(
      "insert into email_provider_state(provider_code,unavailable_until,reason,updated_at) values ('fake',clock_timestamp()+interval '2 seconds','rate_limited',clock_timestamp()),('fake_fallback',clock_timestamp()+interval '1 hour','quota_exceeded',clock_timestamp())",
    );
    expect(await world.attempt(id)).toEqual({ kind: "skipped" });
    const row = await world.row(id);
    expect(row.route_provider_code).toBeNull();
    expect(row.next_attempt_at.getTime() - world.clock.now().getTime()).toBeGreaterThan(1000);
    expect(row.next_attempt_at.getTime() - world.clock.now().getTime()).toBeLessThanOrEqual(2000);
    expect(a().calls).toEqual([]);
    expect(b().calls).toEqual([]);
  });
  it.each([
    [0, 1],
    [1, 1],
    [2, 2],
    [3, 5],
    [7, 60],
    [12, 60],
  ])(
    "keeps message backoff when a deferred route exhausts after %s attempts",
    async (attempts, delayMinutes) => {
      const id = await world.enqueued();
      await world.pool.query(
        "update email_message set attempts=$2, route_provider_code='fake_fallback' where id=$1",
        [id, attempts],
      );
      await world.pool.query(
        "insert into email_provider_state(provider_code,unavailable_until,reason,updated_at) values ('fake_fallback',clock_timestamp()+interval '2 hours','quota_exceeded',clock_timestamp())",
      );
      expect(await world.attempt(id)).toEqual({ kind: "skipped" });
      const row = await world.row(id);
      expect(row.route_provider_code).toBeNull();
      expect(row.attempts).toBe(attempts);
      expect(row.next_attempt_at.getTime() - world.clock.now().getTime()).toBe(
        (delayMinutes as number) * 60000,
      );
      expect(a().calls).toEqual([]);
      expect(b().calls).toEqual([]);
    },
  );
  it("closes an unprotected or expired pinned retry before cooldown admission", async () => {
    const id = await world.enqueued();
    a().failNext({ reason: "unavailable" });
    await world.attempt(id);
    await world.pool.query(
      "insert into email_provider_state(provider_code,unavailable_until,reason,updated_at) values ('fake',clock_timestamp()+interval '1 hour','quota_exceeded',clock_timestamp())",
    );
    Object.defineProperty(a(), "capabilities", {
      value: { idempotencyKeys: false, maxRecipients: 1 },
      configurable: true,
    });
    world.clock.set((await world.row(id)).next_attempt_at);
    expect(await world.attempt(id)).toEqual({ kind: "expired", status: "unknown" });
    expect(b().calls).toEqual([]);
    Object.defineProperty(a(), "capabilities", {
      value: { idempotencyKeys: true, maxRecipients: 1 },
      configurable: true,
    });
  });

  it("defers B with its durable route when A safely refuses near the deadline", async () => {
    const id = await world.enqueued();
    await world.pool.query("update email_message set deadline_at=$2 where id=$1", [
      id,
      new Date(world.clock.now().getTime() + 20000),
    ]);
    vi.spyOn(a(), "send").mockImplementation(async () => {
      world.clock.set(new Date(world.clock.now().getTime() + 18000));
      return emailProviderFailure("quota_exceeded");
    });
    expect((await world.attempt(id)).kind).toBe("deferred");
    expect(b().calls).toEqual([]);
    expect(await world.row(id)).toMatchObject({
      status: "pending",
      route_provider_code: "fake_fallback",
      attempts: 1,
    });
  });
  it("keeps one recovery probe exclusive through a pacing wait beyond the old 90-second window", async () => {
    const id = await world.enqueued();
    const next = await world.enqueued();
    const other = await second();
    await world.pool.query(
      "insert into email_provider_state(provider_code,unavailable_until,reason,updated_at) values ('fake',clock_timestamp()-interval '1 second','rate_limited',clock_timestamp())",
    );
    const injected = world.running.app.get<SendPacer>(EMAIL_SEND_PACER);
    vi.spyOn(injected, "start").mockImplementation(async function <T>(
      _maxWait: number,
      start: () => T,
    ) {
      world.clock.set(new Date(world.clock.now().getTime() + 91000));
      await world.pool.query(
        "update email_provider_state set probe_until=probe_until-interval '91 seconds' where provider_code='fake'",
      );
      await world.attempt(next, other);
      expect(a(other).calls).toEqual([]);
      expect(b(other).calls).toEqual([next]);
      return { started: true as const, value: start() };
    });
    expect((await world.attempt(id)).kind).toBe("sent");
    expect(a().calls).toEqual([id]);
  });
  it("admits a new recovery worker after actual probe expiry while the stale paced worker cannot call", async () => {
    const id = await world.enqueued();
    const next = await world.enqueued();
    const other = await second();
    await world.pool.query(
      "insert into email_provider_state(provider_code,unavailable_until,reason,updated_at) values ('fake',clock_timestamp()-interval '1 second','rate_limited',clock_timestamp())",
    );
    const injected = world.running.app.get<SendPacer>(EMAIL_SEND_PACER);
    vi.spyOn(injected, "start").mockImplementation(async function <T>(
      _maxWait: number,
      start: () => T,
    ) {
      const row = (
        await world.pool.query(
          "select ceil(extract(epoch from(probe_until-clock_timestamp()))*1000)::int remaining_ms from email_provider_state where provider_code='fake'",
        )
      ).rows[0] as { remaining_ms: number };
      world.clock.set(new Date(world.clock.now().getTime() + row.remaining_ms + 1000));
      await world.pool.query(
        "update email_provider_state set probe_until=clock_timestamp()-interval '1 second' where provider_code='fake'",
      );
      await world.attempt(next, other);
      expect(a(other).calls).toEqual([next]);
      return { started: true as const, value: start() };
    });
    expect((await world.attempt(id)).kind).toBe("deferred");
    expect(a().calls).toEqual([]);
    expect(b().calls).toEqual([]);
  });
});
