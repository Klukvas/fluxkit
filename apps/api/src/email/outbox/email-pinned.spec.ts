import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EMAIL_LEASE_SECONDS, type EmailProviderCapabilities } from "@fluxkit/core";
import { startApp } from "../../test/app.js";
import { sendEmails } from "../../jobs/send-emails.job.js";
import { EmailSender } from "./email-sender.js";
import { EmailWorld } from "../../test/email-world.js";
import { EmailMessageChanges } from "./email-message-changes.js";

describe("durable email pin (real Postgres)", () => {
  let world: EmailWorld;
  const legacy = { idempotencyKeys: true, maxRecipients: 1 };
  beforeAll(async () => {
    world = await EmailWorld.start();
  });
  beforeEach(async () => {
    world.clock.advanceMinutes(1);
    await world.clear();
    capability(legacy);
  });
  afterAll(async () => {
    await world.stop();
  });
  function capability(value: EmailProviderCapabilities) {
    Object.defineProperty(world.provider(), "capabilities", { value, configurable: true });
  }
  async function ambiguous() {
    const id = await world.enqueued();
    const claimedAt = world.clock.now();
    world.provider().failNext({ reason: "unavailable", afterEffect: true });
    expect((await world.attempt(id)).kind).toBe("retry");
    expect(await world.row(id)).toMatchObject({
      pinned_provider_code: "fake",
      pinned_at: claimedAt,
    });
    world.clock.advanceMinutes(1);
    return id;
  }
  it("keeps ambiguity after later rejection, rendering failure or pending deadline", async () => {
    const rejected = await ambiguous();
    world.provider().failNext({ reason: "rejected" });
    expect((await world.attempt(rejected)).kind).toBe("unknown");
    const render = await ambiguous();
    await world.pool.query("update email_message set template_version = 999 where id = $1", [
      render,
    ]);
    expect((await world.attempt(render)).kind).toBe("unknown");
    const expired = await ambiguous();
    world.clock.set((await world.row(expired)).deadline_at);
    expect(await world.attempt(expired)).toEqual({ kind: "expired", status: "unknown" });
  });
  it("pins lease-expiry recovery before a competing provider can reclaim it", async () => {
    const id = await world.enqueued();
    const claimedAt = world.clock.now();
    const old = await world.changes.claim(id, claimedAt, "fake");
    expect(old.kind).toBe("claimed");
    world.clock.set(new Date(claimedAt.getTime() + EMAIL_LEASE_SECONDS * 1000 + 1));
    expect(await world.changes.claim(id, world.clock.now(), "other")).toEqual({ kind: "skipped" });
    expect(await world.row(id)).toMatchObject({
      status: "pending",
      provider_code: "fake",
      pinned_provider_code: "fake",
      pinned_at: claimedAt,
      last_error_code: "pinned_provider_unavailable",
    });
    const held = await world.row(id);
    world.clock.set(held.deadline_at);
    expect(await world.changes.claim(id, world.clock.now(), "other")).toEqual({
      kind: "expired",
      status: "unknown",
    });
  });
  it("survives a second instance, fences a stale result and reuses the UUID", async () => {
    const id = await world.enqueued();
    const old = await world.changes.claim(id, world.clock.now(), "fake");
    if (old.kind !== "claimed") throw new Error("Claim missing");
    world.clock.advanceMinutes(3);
    const second = await world.secondInstance();
    const current = await world
      .get(EmailMessageChanges, second)
      .claim(id, world.clock.now(), "fake");
    expect(current.kind).toBe("claimed");
    expect(
      await world.changes.record(
        old.message,
        { kind: "sent", providerMessageId: "stale" },
        world.clock.now(),
      ),
    ).toEqual({ kind: "lost" });
    if (current.kind !== "claimed") throw new Error("Reclaim missing");
    expect(current.message.id).toBe(id);
    expect(current.message.pinnedAt).toEqual(
      new Date(old.message.leaseUntil.getTime() - EMAIL_LEASE_SECONDS * 1000),
    );
  });
  it("does not automatically replay when idempotency is unsupported", async () => {
    capability({ idempotencyKeys: false, maxRecipients: 1 });
    const id = await world.enqueued();
    world.provider().failNext({ reason: "unavailable", afterEffect: true });
    expect((await world.attempt(id)).kind).toBe("unknown");
    world.clock.advanceMinutes(2);
    expect((await world.attempt(id)).kind).toBe("skipped");
    expect(world.provider().calls).toEqual([id]);
  });
  it.each(["before", "at"] as const)(
    "rechecks removed configuration and restores the same provider %s the original cutoff",
    async (restored) => {
      capability({ ...legacy, idempotencyWindowSeconds: 1800 });
      const id = await ambiguous();
      const before = await world.row(id);
      const pinnedAt = before.pinned_at;
      if (pinnedAt === null) throw new Error("Pin missing");
      const none = await startApp({
        clock: world.clock,
        emailFrom: null,
        storefrontPublicUrl: null,
      });
      try {
        expect(await world.attempt(id, none)).toEqual({ kind: "skipped" });
        const recheckAt = new Date(world.clock.now().getTime() + 60_000);
        expect(await world.row(id)).toMatchObject({
          id,
          status: "pending",
          attempts: before.attempts,
          provider_code: "fake",
          pinned_provider_code: "fake",
          pinned_at: pinnedAt,
          deadline_at: before.deadline_at,
          next_attempt_at: recheckAt,
          last_error_code: "pinned_provider_unavailable",
        });
        expect(await world.attempt(id)).toEqual({ kind: "skipped" });
        world.clock.set(
          restored === "before" ? recheckAt : new Date(pinnedAt.getTime() + 25 * 60_000),
        );
        if (restored === "before") {
          expect(await world.attempt(id)).toEqual({ kind: "sent", reason: undefined });
          expect(world.provider().calls).toEqual([id, id]);
          expect(world.provider().sent).toHaveLength(1);
          expect(world.provider().sent[0]?.idempotencyKey).toBe(id);
        } else {
          expect(await world.attempt(id)).toEqual({ kind: "expired", status: "unknown" });
          expect((await world.row(id)).last_error_code).toBe("idempotency_window_expired");
          expect(world.provider().calls).toEqual([id]);
        }
        expect(await world.row(id)).toMatchObject({
          provider_code: "fake",
          pinned_provider_code: "fake",
          pinned_at: pinnedAt,
          deadline_at: before.deadline_at,
        });
      } finally {
        await none.app.close();
      }
    },
  );
  it("bounds missing-provider rechecks by the deadline and expires without a restored provider", async () => {
    const id = await ambiguous();
    const before = await world.row(id);
    world.clock.set(new Date(before.deadline_at.getTime() - 30_000));
    expect(await world.changes.claim(id, world.clock.now(), undefined)).toEqual({
      kind: "skipped",
    });
    expect(await world.row(id)).toMatchObject({
      status: "pending",
      pinned_provider_code: "fake",
      pinned_at: before.pinned_at,
      next_attempt_at: before.deadline_at,
      last_error_code: "pinned_provider_unavailable",
    });
    world.clock.set(before.deadline_at);
    expect(await world.changes.claim(id, world.clock.now(), undefined)).toEqual({
      kind: "expired",
      status: "unknown",
    });
    expect(world.provider().calls).toEqual([id]);
  });
  it("applies the original 25-minute cutoff after restart, including a late first send", async () => {
    capability({ ...legacy, idempotencyWindowSeconds: 1800 });
    const id = await world.enqueued();
    world.clock.advanceMinutes(60);
    const firstAt = world.clock.now();
    world.provider().failNext({ reason: "unavailable" });
    expect((await world.attempt(id)).kind).toBe("retry");
    const second = await world.secondInstance();
    Object.defineProperty(world.provider(second), "capabilities", {
      value: { ...legacy, idempotencyWindowSeconds: 1800 },
    });
    world.clock.set(new Date(firstAt.getTime() + 25 * 60_000));
    expect(await world.attempt(id, second)).toEqual({ kind: "expired", status: "unknown" });
    expect(world.provider(second).calls).toEqual([]);
    expect((await world.row(id)).pinned_at).toEqual(firstAt);
  });
  it("never loses the pin after a later safe quota refusal", async () => {
    const id = await ambiguous();
    const before = await world.row(id);
    world.provider().failNext({ reason: "quota_exceeded" });
    expect(await world.attempt(id)).toEqual({ kind: "retry", reason: "quota_exceeded" });
    expect(await world.row(id)).toMatchObject({
      pinned_provider_code: "fake",
      pinned_at: before.pinned_at,
    });
    expect(world.provider().calls).toEqual([id, id]);
    expect(world.provider().sent).toHaveLength(1);
  });
  it("job 9 pins crashed attempts and expires them even with delivery disabled", async () => {
    const id = await world.enqueued();
    const claimedAt = world.clock.now();
    await world.changes.claim(id, claimedAt, "fake");
    world.clock.advanceMinutes(3);
    const none = await startApp({ clock: world.clock, emailFrom: null, storefrontPublicUrl: null });
    try {
      const deps = {
        database: world.database,
        outbox: world.repository,
        sender: none.app.get(EmailSender),
      };
      await sendEmails(deps, world.clock.now(), { clock: () => world.clock.now() });
      expect(await world.row(id)).toMatchObject({
        status: "pending",
        pinned_provider_code: "fake",
        pinned_at: claimedAt,
        last_error_code: "pinned_provider_unavailable",
      });
      world.clock.set((await world.row(id)).deadline_at);
      expect(
        (await sendEmails(deps, world.clock.now(), { clock: () => world.clock.now() })).expired,
      ).toBe(1);
      expect((await world.row(id)).status).toBe("unknown");
      expect(world.provider().calls).toEqual([]);
    } finally {
      await none.app.close();
    }
  });

  it("cancels local retries without clearing the pin", async () => {
    const id = await ambiguous();
    const before = await world.row(id);
    expect((await world.changes.cancel(id, world.clock.now())).kind).toBe("cancelled");
    expect(await world.row(id)).toMatchObject({
      pinned_provider_code: before.pinned_provider_code,
      pinned_at: before.pinned_at,
    });
  });
});
