import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EMAIL_LEASE_SECONDS, EMAIL_LIMITS } from "@fluxkit/core";
import { emailTheme } from "@fluxkit/theme";
import { TEST_EMAIL_FROM, TEST_STOREFRONT_PUBLIC_URL, startApp } from "../../test/app.js";
import { EmailWorld, TEST_RECIPIENT } from "../../test/email-world.js";
import { captureLogs } from "../../test/shipping-fixtures.js";
import { testEmailProviders } from "../../test/test-email-provider.js";
import { EmailSender } from "./email-sender.js";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

describe("email sender: claim, render, send outside a transaction, record (real Postgres, test provider)", () => {
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

  const at = (offsetMs: number) => new Date(world.clock.now().getTime() + offsetMs);

  it("sends the rendered mail once with idempotency key = row id, and records it sent", async () => {
    const id = await world.enqueued();
    expect(await world.attempt(id)).toEqual({ kind: "sent", reason: undefined });
    const [sent, ...more] = world.provider().sent;
    expect(more).toEqual([]);
    expect(sent?.idempotencyKey).toBe(id);
    expect(sent?.message.from).toEqual(TEST_EMAIL_FROM);
    expect(sent?.message.to).toEqual({ address: TEST_RECIPIENT, displayName: null });
    expect(sent?.message.replyTo).toBeUndefined();
    expect(sent?.message.subject).toBe("Test email from Fluxkit Test Shop");
    expect(sent?.message.tags).toEqual({ category: "account" });
    expect(sent?.message.html).toMatch(/^<!doctype html>/);
    expect(sent?.message.html).toContain('lang="en"');
    expect(sent?.message.html).toContain(emailTheme.color.primary);
    expect(sent?.message.html).toContain(`href="${TEST_STOREFRONT_PUBLIC_URL}/en"`);
    expect(sent?.message.text).toContain("this message was handed to the provider fake");
    expect(sent?.message.text).toContain(`${TEST_STOREFRONT_PUBLIC_URL}/en`);
    expect(await world.row(id)).toMatchObject({
      status: "sent",
      attempts: 1,
      provider_code: "fake",
      provider_message_id: sent?.providerMessageId,
      last_error_code: null,
      lease_until: null,
    });
    expect((await world.row(id)).sent_at).toEqual(world.clock.now());
  });

  it("renders in the mail's locale (uk) and falls back to the default locale for one without a catalog", async () => {
    const uk = await world.enqueued({ locale: "uk" });
    const de = await world.enqueued({ locale: "de" });
    await world.attempt(uk);
    await world.attempt(de);
    const [first, second] = world.provider().sent;
    expect(first?.message.subject).toBe("Тестовий лист від Fluxkit Test Shop");
    expect(second?.message.subject).toBe("Тестовий лист від Fluxkit Test Shop");
    expect(second?.message.html).toContain('lang="de"');
    expect(second?.message.text).toContain(`${TEST_STOREFRONT_PUBLIC_URL}/de`);
  });

  it("retries by the schedule (1, 2, 5 minutes) with the SAME idempotency key until it is accepted", async () => {
    const id = await world.enqueued();
    world
      .provider()
      .failNext({ reason: "unavailable", providerCodes: ["service_unavailable"], times: 3 });
    for (const minutes of [1, 2, 5]) {
      expect(await world.attempt(id)).toEqual({ kind: "retry", reason: "unavailable" });
      const row = await world.row(id);
      expect(row).toMatchObject({
        status: "pending",
        last_error_code: "unavailable:service_unavailable",
        lease_until: null,
      });
      expect(row.next_attempt_at).toEqual(at(minutes * MINUTE));
      // Not due before its time.
      expect(await world.attempt(id)).toEqual({ kind: "skipped" });
      world.clock.set(row.next_attempt_at);
    }
    expect((await world.attempt(id)).kind).toBe("sent");
    expect(world.provider().calls).toEqual([id, id, id, id]);
    expect((await world.row(id)).attempts).toBe(4);
  });

  it("waits exactly the retry-after of a rate limit", async () => {
    const id = await world.enqueued();
    world.provider().failNext({ reason: "rate_limited", retryAfterSeconds: 7 });
    expect(await world.attempt(id)).toEqual({ kind: "retry", reason: "rate_limited" });
    expect((await world.row(id)).next_attempt_at).toEqual(at(7 * SECOND));
  });

  it("waits for 00:05 UTC after a daily quota and an hour after a monthly one; past the deadline it fails", async () => {
    world.clock.set("2030-03-01T20:00:00.000Z");
    const daily = await world.enqueued();
    world.provider().failNext({ reason: "quota_exceeded", quotaPeriod: "daily" });
    await world.attempt(daily);
    expect((await world.row(daily)).next_attempt_at).toEqual(new Date("2030-03-02T00:05:00.000Z"));
    const monthly = await world.enqueued();
    world.provider().failNext({ reason: "quota_exceeded", quotaPeriod: "monthly" });
    await world.attempt(monthly);
    expect((await world.row(monthly)).next_attempt_at).toEqual(at(60 * MINUTE));

    world.clock.set("2030-03-02T09:00:00.000Z");
    const late = await world.enqueued();
    world.clock.set("2030-03-02T13:00:00.000Z");
    world.provider().failNext({ reason: "quota_exceeded", quotaPeriod: "daily" });
    await world.attempt(late);
    expect(await world.row(late)).toMatchObject({
      status: "failed",
      last_error_code: "deadline_passed",
    });
  });

  it("fails a rejected mail at once and never claims it again", async () => {
    const id = await world.enqueued();
    world.provider().failNext({ reason: "rejected", providerCodes: ["validation_error"] });
    expect(await world.attempt(id)).toEqual({ kind: "failed", reason: "rejected" });
    expect(await world.row(id)).toMatchObject({
      status: "failed",
      last_error_code: "rejected:validation_error",
    });
    world.clock.advanceMinutes(120);
    expect(await world.attempt(id)).toEqual({ kind: "skipped" });
    expect(world.provider().calls).toEqual([id]);
  });

  it("marks an idempotency conflict unknown and never retries it automatically", async () => {
    const id = await world.enqueued();
    world.provider().failNext({
      reason: "idempotency_conflict",
      providerCodes: ["invalid_idempotent_request"],
    });
    expect(await world.attempt(id)).toEqual({ kind: "unknown", reason: "idempotency_conflict" });
    expect(await world.row(id)).toMatchObject({
      status: "unknown",
      last_error_code: "idempotency_conflict:invalid_idempotent_request",
    });
    world.clock.advanceMinutes(600);
    expect(await world.attempt(id)).toEqual({ kind: "skipped" });
    expect(
      await world.repository.listDue(world.database, world.clock.now(), undefined, 10),
    ).toEqual([]);
  });

  it("retries a timed-out send (unknown outcome) only with the same key: the provider's copy is not sent twice", async () => {
    const id = await world.enqueued();
    world.provider().failNext({ hang: true });
    expect(await world.attempt(id)).toEqual({ kind: "retry", reason: "unavailable" });
    expect((await world.row(id)).last_error_code).toBe("unavailable:timeout");
    world.clock.advanceMinutes(1);
    // The lost answer: the provider accepted the mail but the answer never came back.
    world.provider().failNext({ reason: "unavailable", afterEffect: true });
    expect((await world.attempt(id)).kind).toBe("retry");
    world.clock.advanceMinutes(2);
    expect((await world.attempt(id)).kind).toBe("sent");
    expect(world.provider().calls).toEqual([id, id, id]);
    expect(world.provider().sent).toHaveLength(1);
    expect((await world.row(id)).provider_message_id).toBe(
      world.provider().sent[0]?.providerMessageId,
    );
  });

  it("re-sends after a crash between claim and record with the SAME idempotency key once the lease expired", async () => {
    const id = await world.enqueued();
    // Attempt 1 reaches the provider, which accepts, then the process dies before the record.
    const record = vi
      .spyOn(world.changes, "record")
      .mockRejectedValueOnce(new Error("process died"));
    await expect(world.attempt(id)).rejects.toThrow("process died");
    record.mockRestore();
    expect(await world.row(id)).toMatchObject({ status: "sending", attempts: 1 });
    expect(await world.attempt(id)).toEqual({ kind: "skipped" });
    world.clock.set(new Date(world.clock.now().getTime() + EMAIL_LEASE_SECONDS * SECOND + 1));
    expect((await world.attempt(id)).kind).toBe("sent");
    expect(world.provider().calls).toEqual([id, id]);
    expect(world.provider().sent).toHaveLength(1);
    expect(await world.row(id)).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("fails a mail whose template version changed, or whose variables no longer pass, without calling the provider", async () => {
    const changed = await world.enqueued();
    await world.pool.query("update email_message set template_version = 7 where id = $1", [
      changed,
    ]);
    const broken = await world.enqueued();
    await world.pool.query(`update email_message set variables = '{}'::jsonb where id = $1`, [
      broken,
    ]);
    const logs = captureLogs();
    try {
      expect(await world.attempt(changed)).toEqual({ kind: "failed", reason: undefined });
      expect(await world.attempt(broken)).toEqual({ kind: "failed", reason: undefined });
    } finally {
      logs.stop();
    }
    expect((await world.row(changed)).last_error_code).toBe("template_unavailable");
    expect((await world.row(broken)).last_error_code).toBe("variables_invalid");
    expect(world.provider().calls).toEqual([]);
    expect(logs.text()).toContain(
      `Email ${changed} (admin.test) cannot be rendered: template_unavailable`,
    );
  });

  it("treats a thrown provider error as unavailable and logs no message text, address, variable or subject", async () => {
    const id = await world.enqueued({ variables: { providerCode: "secretcode" } });
    const misconfigured = await world.enqueued();
    const second = await world.enqueued();
    world.provider().failNext({ throws: true });
    const logs = captureLogs();
    try {
      expect(await world.attempt(id)).toEqual({ kind: "retry", reason: "unavailable" });
      world.provider().failNext({
        reason: "misconfigured",
        providerCodes: ["restricted_api_key"],
        times: 2,
      });
      await world.attempt(misconfigured);
      await world.attempt(second);
      world.clock.advanceMinutes(1);
      await world.attempt(id);
    } finally {
      logs.stop();
    }
    expect((await world.row(id)).status).toBe("sent");
    const text = logs.text();
    expect(text).toContain(
      `Email ${id} (admin.test) attempt 1 via fake: pending code=unavailable:Error`,
    );
    expect(text).toContain(`Email ${id} (admin.test) attempt 2 via fake: sent`);
    // One error per process and code for a misconfigured provider; the next is a warning.
    expect(text.match(/the email provider is misconfigured/g)).toHaveLength(1);
    for (const secret of [
      TEST_RECIPIENT,
      "buyer@",
      "shop@example.com",
      "secretcode",
      "Test email from",
      "handed to the provider",
      TEST_STOREFRONT_PUBLIC_URL,
      "test provider failure",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("sends now (the immediate attempt) at the app clock's time, also fire and forget", async () => {
    const now = await world.enqueued();
    expect((await world.sender.sendNow(now)).kind).toBe("sent");
    const later = await world.enqueued();
    world.sender.startSendNow(later);
    for (let tries = 0; tries < 100 && (await world.row(later)).status !== "sent"; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect((await world.row(later)).status).toBe("sent");
    expect(world.provider().calls).toEqual([now, later]);
  });

  it("leaves an immediate attempt to job 9 when the pacing queue is full", async () => {
    const running = await startApp({
      clock: world.clock,
      extraEmailProviders: testEmailProviders(),
      emailDeliveryTuning: { maxWaitingImmediate: 0 },
    });
    try {
      const id = await world.enqueued();
      expect(await running.app.get(EmailSender).sendNow(id)).toEqual({ kind: "deferred" });
      expect((await world.row(id)).status).toBe("pending");
    } finally {
      await running.app.close();
    }
  });

  it("caps the mail at the provider's limits (one recipient, a subject of at most 200 code points)", async () => {
    const id = await world.enqueued();
    await world.attempt(id);
    const message = world.provider().sent[0]?.message;
    expect([...(message?.subject ?? "")].length).toBeLessThanOrEqual(EMAIL_LIMITS.subjectMaxLength);
    expect(typeof message?.to.address).toBe("string");
  });
});
