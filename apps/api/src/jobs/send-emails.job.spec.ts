import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EmailSender } from "../email/outbox/index.js";
import { startApp } from "../test/app.js";
import { EmailWorld } from "../test/email-world.js";
import { captureLogs } from "../test/shipping-fixtures.js";
import { JobBudget } from "./job-budget.js";
import { JobsRunner } from "./jobs-runner.js";
import { SEND_EMAIL_LIMITS, sendEmails, type SendEmailsDeps } from "./send-emails.job.js";

describe("send-emails (job 9; real Postgres, injected time, the in-repo test provider)", () => {
  let world: EmailWorld;

  beforeAll(async () => {
    world = await EmailWorld.start();
  });

  beforeEach(async () => {
    world.clock.advanceMinutes(1);
    await world.clear();
  });

  afterAll(async () => {
    await world.stop();
  });

  const deps = (sender: SendEmailsDeps["sender"] = world.sender): SendEmailsDeps => ({
    database: world.database,
    outbox: world.repository,
    sender,
  });
  const run = (options: Parameters<typeof sendEmails>[2] = {}, sender?: SendEmailsDeps["sender"]) =>
    sendEmails(deps(sender), world.clock.now(), { clock: () => world.clock.now(), ...options });

  /** Three mails enqueued a minute apart (so their due order is a, b, c). */
  async function three(): Promise<[string, string, string]> {
    const a = await world.enqueued();
    world.clock.advanceMinutes(1);
    const b = await world.enqueued();
    world.clock.advanceMinutes(1);
    const c = await world.enqueued();
    world.clock.advanceMinutes(1);
    return [a, b, c];
  }

  it("sends every due mail, oldest due first, and reports the counts", async () => {
    const [a, b, c] = await three();
    const result = await run();
    expect(result).toMatchObject({
      scanned: 3,
      sent: 3,
      retried: 0,
      failed: 0,
      paused: false,
      failures: [],
      truncated: false,
    });
    expect(world.provider().calls).toEqual([a, b, c]);
  });

  it("does not send a mail that is not due yet", async () => {
    const id = await world.enqueued();
    const result = await sendEmails(deps(), new Date(world.clock.now().getTime() - 1), {
      clock: () => world.clock.now(),
    });
    expect(result.scanned).toBe(0);
    expect((await world.row(id)).status).toBe("pending");
  });

  it("one failing mail never blocks the others: its failure is reported, the rest are sent, it is sent later", async () => {
    const [a, b, c] = await three();
    const failing: SendEmailsDeps["sender"] = {
      provider: () => world.sender.provider(),
      warnWaitingWithoutProvider: (open) => world.sender.warnWaitingWithoutProvider(open),
      attempt: (id, clock, limits) =>
        id === a
          ? Promise.reject(Object.assign(new Error("lock timeout"), { code: "55P03" }))
          : world.sender.attempt(id, clock, limits),
    };
    const result = await run({}, failing);
    expect(result.failures).toEqual([{ messageId: a, error: "Error cause=Error code=55P03" }]);
    expect(result.sent).toBe(2);
    expect(world.provider().calls).toEqual([b, c]);
    expect((await world.row(a)).status).toBe("pending");
    expect((await run()).sent).toBe(1);
    expect((await world.row(a)).status).toBe("sent");
  });

  it("a mail held by another transaction is skipped, not waited for; the others go out", async () => {
    const [a, b, c] = await three();
    const probe = await world.pool.connect();
    try {
      await probe.query("begin");
      await probe.query("select 1 from email_message where id = $1 for update", [a]);
      const result = await run();
      expect(result).toMatchObject({ scanned: 3, sent: 2, skipped: 1 });
      expect(world.provider().calls).toEqual([b, c]);
    } finally {
      await probe.query("rollback");
      probe.release();
    }
  });

  it("no starvation: each due mail is looked at once per run (cursor), a retried one does not come back in the run", async () => {
    const [a, b, c] = await three();
    world.provider().failNext({ reason: "unavailable" });
    const result = await run({ limits: { batchSize: 1, maxBatches: 10 } });
    expect(result).toMatchObject({ scanned: 3, retried: 1, sent: 2, truncated: false });
    expect(world.provider().calls).toEqual([a, b, c]);
  });

  it("stops at the batch limit with truncated, the rest waits for the next run", async () => {
    await three();
    const result = await run({ limits: { batchSize: 1, maxBatches: 2 } });
    expect(result).toMatchObject({ scanned: 2, sent: 2, truncated: true });
    expect((await run()).sent).toBe(1);
  });

  it("respects the time budget: checked before each page and each mail", async () => {
    await three();
    let checks = 0;
    // Clock readings: the budget's start, the page check, then the check before the second mail (used up).
    const budget = new JobBudget(10, () => (checks++ >= 2 ? 1_000 : 0));
    const result = await run({ budget });
    expect(result).toMatchObject({ scanned: 1, sent: 1, truncated: true });
    expect(SEND_EMAIL_LIMITS).toEqual({ batchSize: 20, maxBatches: 25 });
  });

  it("stops the run when the provider answers a reason that concerns every mail (rate limit)", async () => {
    const [a, b, c] = await three();
    world.provider().failNext({ reason: "rate_limited", retryAfterSeconds: 2 });
    const logs = captureLogs();
    let result;
    try {
      result = await run();
    } finally {
      logs.stop();
    }
    expect(result).toMatchObject({ scanned: 1, retried: 1, paused: true });
    expect(world.provider().calls).toEqual([a]);
    expect((await world.row(b)).attempts).toBe(0);
    expect((await world.row(c)).attempts).toBe(0);
    expect(logs.text()).toContain("the provider answered rate_limited; the run stops");
  });

  it("is job 9 of the tick: runAll sends the due mail", async () => {
    const id = await world.enqueued();
    const reports = await world.get(JobsRunner).runAll(world.clock.now());
    const report = reports.find((entry) => entry.name === "send-emails");
    expect(report).toMatchObject({ ok: true, result: { sent: 1 } });
    expect((await world.row(id)).status).toBe("sent");
  });
});

describe("send-emails pacing (real time)", () => {
  it("starts at most sendsPerSecond provider calls per second (8: 125 ms apart)", async () => {
    const world = await EmailWorld.start({ emailDeliveryTuning: { sendsPerSecond: 8 } });
    try {
      const ids: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        ids.push(await world.enqueued());
      }
      const provider = world.provider();
      const times: number[] = [];
      const send = provider.send.bind(provider);
      provider.send = (message, options, signal) => {
        times.push(performance.now());
        return send(message, options, signal);
      };
      const result = await sendEmails(
        { database: world.database, outbox: world.repository, sender: world.sender },
        world.clock.now(),
        { clock: () => world.clock.now() },
      );
      expect(result.sent).toBe(5);
      // A single gap can be short when the previous send started late under load (the pacer schedules from its own
      // clock), so the pacing is asserted over the whole span: 5 sends take at least 4 intervals of 125 ms (20 ms of
      // timer slack). Unpaced sends finish within a few milliseconds.
      const span = (times[times.length - 1] ?? 0) - (times[0] ?? 0);
      expect(times).toHaveLength(5);
      expect(span).toBeGreaterThanOrEqual(4 * 125 - 20);
    } finally {
      await world.stop();
    }
  });
});

describe("send-emails with EMAIL_PROVIDER=none", () => {
  it("claims nothing: mails stay pending and one warning is logged per process", async () => {
    const world = await EmailWorld.start();
    const none = await startApp({ clock: world.clock, emailFrom: null, storefrontPublicUrl: null });
    try {
      const id = await world.enqueued();
      const sender = none.app.get(EmailSender);
      const logs = captureLogs();
      let first;
      let second;
      try {
        first = await sendEmails(
          { database: world.database, outbox: world.repository, sender },
          world.clock.now(),
        );
        second = await sendEmails(
          { database: world.database, outbox: world.repository, sender },
          world.clock.now(),
        );
      } finally {
        logs.stop();
      }
      expect(first).toMatchObject({ scanned: 0, waitingWithoutProvider: 1 });
      expect(second).toMatchObject({ scanned: 0, waitingWithoutProvider: 1 });
      expect(logs.text().match(/mails wait but no email provider is loaded/g)).toHaveLength(1);
      expect(await world.row(id)).toMatchObject({ status: "pending", attempts: 0 });
    } finally {
      await none.app.close();
      await world.stop();
    }
  });
});
