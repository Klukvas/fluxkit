import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AUTH_TOKEN_LIFETIME_MINUTES, EMAIL_LEASE_SECONDS } from "@fluxkit/core";
import { withTransaction } from "../../common/transaction.js";
import { EmailWorld, TEST_RECIPIENT } from "../../test/email-world.js";
import { startApp } from "../../test/app.js";
import { EmailMessageChanges } from "./email-message-changes.js";
import { EmailOutbox } from "./email-outbox.service.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const EVENT_ID = "0a0b0c0d-1111-4222-8333-944455556666";

describe("email outbox: enqueue, claim and record (real Postgres)", () => {
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

  describe("enqueue", () => {
    it("stores a pending row with the template version, the normalized address and a 12 h deadline", async () => {
      const now = world.clock.now();
      const id = await world.enqueued({ to: "  Buyer@Example.NET " });
      const row = await world.row(id);
      expect(row).toMatchObject({
        template_key: "admin.test",
        template_version: 1,
        locale: "en",
        to_address: TEST_RECIPIENT,
        recipient_kind: "admin",
        variables: { providerCode: "fake" },
        dedupe_key: null,
        status: "pending",
        attempts: 0,
        lease_until: null,
        provider_code: null,
      });
      expect(row.created_at).toEqual(now);
      expect(row.next_attempt_at).toEqual(now);
      expect(row.deadline_at).toEqual(new Date(now.getTime() + 12 * HOUR));
    });

    it("dedupes by <eventId>:<templateKey>: a redelivered event makes no second row", async () => {
      const first = await world.enqueue({ eventId: EVENT_ID });
      const second = await world.enqueue({ eventId: EVENT_ID });
      expect(first.status).toBe("enqueued");
      expect(second).toEqual({ status: "duplicate" });
      expect(await world.count()).toBe(1);
      const id = first.status === "enqueued" ? first.id : "";
      expect((await world.row(id)).dedupe_key).toBe(`${EVENT_ID}:admin.test`);
    });

    it("gives an auth mail the deadline min(token expiry, created_at + 1 h)", async () => {
      const now = world.clock.now();
      const resetExpiry = new Date(
        now.getTime() + AUTH_TOKEN_LIFETIME_MINUTES.password_reset * MINUTE - 5 * MINUTE,
      );
      const reset = await world.enqueued({ authTokenExpiresAt: resetExpiry });
      expect((await world.row(reset)).deadline_at).toEqual(resetExpiry);
      const verification = await world.enqueued({
        authTokenExpiresAt: new Date(now.getTime() + 48 * HOUR),
      });
      expect((await world.row(verification)).deadline_at).toEqual(new Date(now.getTime() + HOUR));
    });

    it("refuses an auth mail whose token has already expired (a caller bug), writing nothing", async () => {
      await expect(world.enqueue({ authTokenExpiresAt: world.clock.now() })).rejects.toThrow(
        RangeError,
      );
      expect(await world.count()).toBe(0);
    });

    it("answers undeliverable for an address that cannot go into a header, writing nothing", async () => {
      expect(await world.enqueue({ to: "пошта@приклад.укр" })).toEqual({
        status: "undeliverable",
        reason: "non_ascii",
      });
      expect(await world.count()).toBe(0);
    });

    it("throws for an unknown template, variables that fail the schema, or a bad locale", async () => {
      await expect(world.enqueue({ templateKey: "nothing.here" })).rejects.toThrow(RangeError);
      await expect(world.enqueue({ variables: { providerCode: "<b>" } })).rejects.toThrow(
        RangeError,
      );
      await expect(
        world.enqueue({ variables: { providerCode: "fake", extra: 1 } }),
      ).rejects.toThrow(RangeError);
      await expect(world.enqueue({ locale: "EN" })).rejects.toThrow(RangeError);
      expect(await world.count()).toBe(0);
    });

    it("rolls back with the caller's transaction", async () => {
      await expect(
        withTransaction(world.database, async (tx) => {
          await world.outbox.enqueue(tx, {
            templateKey: "admin.test",
            locale: "uk",
            to: TEST_RECIPIENT,
            recipientKind: "admin",
            variables: { providerCode: "fake" },
            now: world.clock.now(),
          });
          throw new Error("the caller failed");
        }),
      ).rejects.toThrow("the caller failed");
      expect(await world.count()).toBe(0);
    });
  });

  describe("claim", () => {
    it("claims a due row: sending, attempts + 1, a 120 s lease, the provider code; committed before any send", async () => {
      const id = await world.enqueued();
      const now = world.clock.now();
      const claim = await world.changes.claim(id, now, "fake");
      expect(claim.kind).toBe("claimed");
      const row = await world.row(id);
      const lease = new Date(now.getTime() + EMAIL_LEASE_SECONDS * 1000);
      expect(row).toMatchObject({ status: "sending", attempts: 1, provider_code: "fake" });
      expect(row.lease_until).toEqual(lease);
      expect(row.next_attempt_at).toEqual(lease);
    });

    it("skips a row that is not due yet, and a row whose lease has not expired", async () => {
      const id = await world.enqueued();
      const before = new Date(world.clock.now().getTime() - 1);
      expect(await world.changes.claim(id, before, "fake")).toEqual({ kind: "skipped" });
      const now = world.clock.now();
      expect((await world.changes.claim(id, now, "fake")).kind).toBe("claimed");
      const atLeaseEnd = new Date(now.getTime() + EMAIL_LEASE_SECONDS * 1000);
      expect(await world.changes.claim(id, atLeaseEnd, "fake")).toEqual({ kind: "skipped" });
      expect((await world.row(id)).attempts).toBe(1);
    });

    it("re-claims an expired lease as sending -> sending with attempts + 1 and the SAME id (idempotency key)", async () => {
      const id = await world.enqueued();
      const now = world.clock.now();
      await world.changes.claim(id, now, "fake");
      const after = new Date(now.getTime() + EMAIL_LEASE_SECONDS * 1000 + 1);
      const again = await world.changes.claim(id, after, "fake");
      expect(again.kind === "claimed" ? again.message : undefined).toMatchObject({
        id,
        attempts: 2,
      });
      expect((await world.row(id)).status).toBe("sending");
    });

    it("lets exactly one of two concurrent claims win (SKIP LOCKED), also across two API instances", async () => {
      const second = await world.secondInstance();
      for (let round = 0; round < 10; round += 1) {
        const id = await world.enqueued();
        const now = world.clock.now();
        const results = await Promise.all([
          world.changes.claim(id, now, "fake"),
          world.changes.claim(id, now, "fake"),
          world.get(EmailMessageChanges, second).claim(id, now, "fake"),
        ]);
        expect(results.filter((result) => result.kind === "claimed")).toHaveLength(1);
        expect(results.filter((result) => result.kind === "skipped")).toHaveLength(2);
        expect((await world.row(id)).attempts).toBe(1);
        await world.clear();
      }
    });

    it("fails a pending row at its deadline instead of claiming it (deadline cut)", async () => {
      const id = await world.enqueued();
      const deadline = (await world.row(id)).deadline_at;
      expect(await world.changes.claim(id, deadline, "fake")).toEqual({
        kind: "expired",
        status: "failed",
      });
      expect(await world.row(id)).toMatchObject({
        status: "failed",
        attempts: 0,
        last_error_code: "deadline_passed",
        lease_until: null,
      });
    });

    it("marks an expired lease past the deadline unknown (the crashed attempt may have been sent)", async () => {
      const id = await world.enqueued();
      const row = await world.row(id);
      const claimedAt = row.deadline_at.getTime() - 1000;
      await world.changes.claim(id, new Date(claimedAt), "fake");
      const leaseExpired = new Date(claimedAt + EMAIL_LEASE_SECONDS * 1000 + 1);
      expect(await world.changes.claim(id, leaseExpired, "fake")).toEqual({
        kind: "expired",
        status: "unknown",
      });
      expect(await world.row(id)).toMatchObject({
        status: "unknown",
        last_error_code: "deadline_passed",
      });
    });
  });

  describe("record", () => {
    it("records sent only for the attempt that holds the row; a stale attempt is lost and writes nothing", async () => {
      const id = await world.enqueued();
      const now = world.clock.now();
      const first = await world.changes.claim(id, now, "fake");
      const later = new Date(now.getTime() + EMAIL_LEASE_SECONDS * 1000 + 1);
      const second = await world.changes.claim(id, later, "fake");
      if (first.kind !== "claimed" || second.kind !== "claimed") {
        throw new Error("expected two claims");
      }
      expect(
        await world.changes.record(
          first.message,
          { kind: "sent", providerMessageId: "stale-1" },
          later,
        ),
      ).toEqual({ kind: "lost" });
      expect((await world.row(id)).status).toBe("sending");
      const recorded = await world.changes.record(
        second.message,
        { kind: "sent", providerMessageId: "fresh-2" },
        later,
      );
      expect(recorded.kind).toBe("recorded");
      expect(await world.row(id)).toMatchObject({
        status: "sent",
        attempts: 2,
        provider_message_id: "fresh-2",
        lease_until: null,
      });
      // A record of a final row is lost too: nothing moves a sent mail.
      expect(
        await world.changes.record(second.message, { kind: "sent", providerMessageId: "x" }, later),
      ).toEqual({ kind: "lost" });
    });
  });
});

describe("email outbox with EMAIL_PROVIDER=none", () => {
  it("enqueues nothing: 'disabled', no row (turning mail on later sends nothing for old events)", async () => {
    const world = await EmailWorld.start();
    const running = await startApp({ storefrontPublicUrl: null, emailFrom: null });
    try {
      const outbox = running.app.get(EmailOutbox);
      expect(outbox.enabled()).toBe(false);
      const result = await withTransaction(world.database, (tx) =>
        outbox.enqueue(tx, {
          templateKey: "admin.test",
          locale: "en",
          to: TEST_RECIPIENT,
          recipientKind: "admin",
          variables: { providerCode: "fake" },
          now: world.clock.now(),
        }),
      );
      expect(result).toEqual({ status: "disabled" });
      expect(await world.count()).toBe(0);
    } finally {
      await running.app.close();
      await world.stop();
    }
  });
});
