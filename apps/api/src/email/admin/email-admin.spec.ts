import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { TEST_EMAIL_FROM } from "../../test/app.js";
import { createTestCustomer, deleteTestCustomers } from "../../test/customer-fixtures.js";
import { EmailAdminWorld } from "../../test/email-admin-world.js";
import { TEST_RECIPIENT } from "../../test/email-world.js";
import { captureLogs } from "../../test/shipping-fixtures.js";
import type { TestAdminUser } from "../../test/admin-user-fixtures.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

interface StatusBody {
  configured: boolean;
  providerCode: string | null;
  from: { address: string; displayName: string | null } | null;
  replyTo: { address: string; displayName: string | null } | null;
  since: string;
  counts: Record<string, number>;
  queueDepth: number;
  oldestPendingAt: string | null;
  errorCodes: { code: string; count: number }[];
}

interface MessageBody {
  id: string;
  templateKey: string;
  templateVersion: number;
  locale: string;
  to: string;
  recipientKind: string;
  customerId: string | null;
  orderId: string | null;
  adminUserId: string | null;
  status: string;
  attempts: number;
  lastErrorCode: string | null;
  resendOf: string | null;
  createdByAdminId: string | null;
  createdAt: string;
  canCancel: boolean;
  canResend: boolean;
  variables?: Record<string, unknown>;
}

interface PageBody {
  items: MessageBody[];
  total: number;
  limit: number;
  offset: number;
}

describe("admin email API (real Postgres, test provider)", () => {
  let ctx: EmailAdminWorld;
  let owner: TestAdminUser;

  const world = () => ctx.world;

  /** Waits until the immediate attempt of a route has reached the provider (it runs after the answer). */
  async function untilStatus(id: string, status: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await world().row(id)).status === status) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Test: ${id} never became ${status}`);
  }

  /** Puts a row in a final status directly (a mail that was handled earlier), at the clock's time. */
  async function settle(id: string, status: "sent" | "failed" | "unknown" | "cancelled") {
    const base = "attempts = 1, lease_until = null, updated_at = $2";
    const sets: Record<typeof status, string> = {
      sent: `status = 'sent', ${base}, sent_at = $2, provider_code = 'fake', provider_message_id = 'pm_${randomUUID()}'`,
      failed: `status = 'failed', ${base}, last_error_code = 'rejected'`,
      unknown: `status = 'unknown', ${base}, last_error_code = 'idempotency_conflict'`,
      cancelled: `status = 'cancelled', attempts = 0, lease_until = null, updated_at = $2`,
    };
    await world().pool.query(`update email_message set ${sets[status]} where id = $1`, [
      id,
      world().clock.now(),
    ]);
  }

  beforeAll(async () => {
    ctx = await EmailAdminWorld.start();
  });

  beforeEach(async () => {
    world().clock.advanceMinutes(61);
    await world().clear();
    owner = await ctx.signInAs("owner");
  });

  afterAll(async () => {
    await ctx.stop();
  });

  describe("GET /admin/email/status", () => {
    it("reports the provider, the sender and zero counts on an empty outbox, and never a key", async () => {
      const result = await ctx.call<StatusBody>("GET", "/admin/email/status");
      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        configured: true,
        providerCode: "fake",
        from: TEST_EMAIL_FROM,
        replyTo: null,
        since: new Date(world().clock.now().getTime() - 24 * HOUR).toISOString(),
        counts: { pending: 0, sending: 0, sent: 0, failed: 0, unknown: 0, cancelled: 0 },
        queueDepth: 0,
        oldestPendingAt: null,
        errorCodes: [],
      });
    });

    it("counts the last 24 hours by status, the open queue and the oldest pending mail", async () => {
      const sent = await world().enqueued();
      await settle(sent, "sent");
      const failed = await world().enqueued();
      await settle(failed, "failed");
      const old = await world().enqueued({
        now: new Date(world().clock.now().getTime() - 30 * HOUR),
      });
      await world().pool.query(
        "update email_message set status = 'failed', attempts = 1, last_error_code = 'old_code', updated_at = $2 where id = $1",
        [old, new Date(world().clock.now().getTime() - 30 * HOUR)],
      );
      const oldestPending = await world().enqueued({
        now: new Date(world().clock.now().getTime() - 2 * HOUR),
      });
      await world().enqueued();
      const result = await ctx.call<StatusBody>("GET", "/admin/email/status");
      expect(result.body.counts).toEqual({
        pending: 2,
        sending: 0,
        sent: 1,
        failed: 1,
        unknown: 0,
        cancelled: 0,
      });
      expect(result.body.queueDepth).toBe(2);
      expect(result.body.oldestPendingAt).toBe(
        (await world().row(oldestPending)).created_at.toISOString(),
      );
      expect(result.body.errorCodes).toEqual([{ code: "rejected", count: 1 }]);
    });

    it("shows the reply-to address when it is configured", async () => {
      // Covered with the sender in the none/replyTo worlds of email-admin-config.spec.ts.
      const result = await ctx.call<StatusBody>("GET", "/admin/email/status");
      expect(Object.keys(result.body).sort()).toEqual([
        "configured",
        "counts",
        "errorCodes",
        "from",
        "oldestPendingAt",
        "providerCode",
        "queueDepth",
        "replyTo",
        "since",
      ]);
    });
  });

  describe("POST /admin/email/test", () => {
    it("sends admin.test to the CALLER's own address in the default locale and answers 202 with the message id", async () => {
      const result = await ctx.call<{ messageId: string }>("POST", "/admin/email/test", {
        body: {},
      });
      expect(result.status).toBe(202);
      const id = result.body.messageId;
      await untilStatus(id, "sent");
      const row = await world().row(id);
      expect(row).toMatchObject({
        template_key: "admin.test",
        recipient_kind: "admin",
        to_address: owner.email.toLowerCase(),
        locale: "uk",
        variables: { providerCode: "fake" },
        dedupe_key: null,
      });
      const pg = await world().pool.query(
        "select admin_user_id, created_by_admin_id, resend_of from email_message where id = $1",
        [id],
      );
      expect(pg.rows[0]).toEqual({
        admin_user_id: owner.id,
        created_by_admin_id: owner.id,
        resend_of: null,
      });
      const [sent, ...more] = world().provider().sent;
      expect(more).toEqual([]);
      expect(sent?.message.to).toEqual({ address: owner.email.toLowerCase(), displayName: null });
      expect(sent?.idempotencyKey).toBe(id);
    });

    it("uses the locale of the request when it is one of LOCALES", async () => {
      const result = await ctx.call<{ messageId: string }>("POST", "/admin/email/test", {
        body: { locale: "en" },
      });
      expect(result.status).toBe(202);
      await untilStatus(result.body.messageId, "sent");
      expect((await world().row(result.body.messageId)).locale).toBe("en");
      expect(world().provider().sent[0]?.message.subject).toBe("Test email from Fluxkit Test Shop");
    });

    it("refuses a locale that is not configured with 400 and sends nothing", async () => {
      const result = await ctx.call<ProblemBody>("POST", "/admin/email/test", {
        body: { locale: "de" },
      });
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual([
        expect.objectContaining({ path: "locale", code: "invalid_value" }),
      ]);
      expect(await world().count()).toBe(0);
    });

    it("accepts no recipient: the address of another admin (or any address) is refused, nothing is sent", async () => {
      const other = await ctx.signInAs("manager");
      ctx.switchTo(owner);
      for (const to of [other.email, "someone@example.net", owner.email]) {
        const result = await ctx.call<ProblemBody>("POST", "/admin/email/test", { body: { to } });
        expect(result.status, to).toBe(400);
        expect(result.body.errors, to).toEqual([
          expect.objectContaining({ path: "to", code: "unknown_field" }),
        ]);
      }
      expect(await world().count()).toBe(0);
      expect(world().provider().calls).toEqual([]);
    });

    it("answers 409 address_undeliverable for an admin address no mail header can carry, writing nothing", async () => {
      ctx.signInAsPrincipal({
        userId: owner.id,
        email: "адмін@example.test",
        role: "owner",
        permissions: ["email.manage"],
        sessionId: "00000000-0000-4000-8000-000000000002",
      });
      const result = await ctx.call<ProblemBody>("POST", "/admin/email/test", { body: {} });
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ code: "rule_violation", rule: "address_undeliverable" });
      expect(await world().count()).toBe(0);
    });

    it("limits the test send to 5 per hour per admin user (ADR 0031 decision 16), and another admin keeps their own window", async () => {
      for (let sent = 0; sent < 5; sent += 1) {
        const result = await ctx.call("POST", "/admin/email/test", { body: {} });
        expect(result.status, `send ${String(sent)}`).toBe(202);
      }
      const limited = await ctx.call<ProblemBody>("POST", "/admin/email/test", { body: {} });
      expect(limited.status).toBe(429);
      expect(limited.body).toMatchObject({ code: "too_many_requests" });
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      const rows = await world().count();
      expect(rows).toBe(5);
      await ctx.signInAs("manager");
      expect((await ctx.call("POST", "/admin/email/test", { body: {} })).status).toBe(202);
      ctx.switchTo(owner);
      world().clock.advanceMinutes(61);
      expect((await ctx.call("POST", "/admin/email/test", { body: {} })).status).toBe(202);
    });
  });

  describe("GET /admin/email/messages", () => {
    it("lists newest first with the recipient address and no variables, with total, limit and offset", async () => {
      const ids: string[] = [];
      for (let n = 0; n < 5; n += 1) {
        world().clock.advanceMinutes(1);
        ids.push(await world().enqueued({ to: `buyer${String(n)}@example.net` }));
      }
      const page = await ctx.call<PageBody>("GET", "/admin/email/messages?limit=2&offset=1");
      expect(page.status).toBe(200);
      expect(page.body).toMatchObject({ total: 5, limit: 2, offset: 1 });
      expect(page.body.items.map((item) => item.id)).toEqual([ids[3], ids[2]]);
      expect(page.body.items[0]).toMatchObject({
        to: "buyer3@example.net",
        templateKey: "admin.test",
        status: "pending",
        canCancel: true,
        canResend: false,
      });
      expect("variables" in (page.body.items[0] ?? {})).toBe(false);
    });

    it("orders rows with the same creation time by id, descending, so pages never repeat a row", async () => {
      const ids: string[] = [];
      for (let n = 0; n < 4; n += 1) {
        ids.push(await world().enqueued({ to: `same${String(n)}@example.net` }));
      }
      const first = await ctx.call<PageBody>("GET", "/admin/email/messages?limit=2&offset=0");
      const second = await ctx.call<PageBody>("GET", "/admin/email/messages?limit=2&offset=2");
      const seen = [...first.body.items, ...second.body.items].map((item) => item.id);
      expect(new Set(seen).size).toBe(4);
      expect(seen).toEqual([...ids].sort().reverse());
    });

    it("filters by status, template, recipient substring (case-insensitive, wildcards literal) and dates", async () => {
      const sent = await world().enqueued({ to: "Anna.Smith@Example.net" });
      await settle(sent, "sent");
      world().clock.advanceMinutes(10);
      const paid = await world().enqueued({
        templateKey: "order.paid",
        recipientKind: "guest",
        to: "bob_100%@example.net",
        variables: { orderNumber: "AAAA-0001", currency: "UAH", total: 100 },
      });
      world().clock.advanceMinutes(10);
      await world().enqueued({ to: "carol@example.net" });
      const ids = async (query: string) =>
        (await ctx.call<PageBody>("GET", `/admin/email/messages?${query}`)).body.items.map(
          (item) => item.id,
        );

      expect(await ids("status=sent")).toEqual([sent]);
      expect(await ids("template=order.paid")).toEqual([paid]);
      expect(await ids("recipient=ANNA.sm")).toEqual([sent]);
      expect(await ids("recipient=example.net")).toHaveLength(3);
      expect(await ids("recipient=100%25")).toEqual([paid]);
      expect(await ids("recipient=%25")).toEqual([paid]);
      expect(await ids("recipient=_")).toEqual([paid]);
      const created = (await world().row(paid)).created_at;
      expect(await ids(`createdFrom=${created.toISOString()}`)).toHaveLength(2);
      expect(await ids(`createdTo=${created.toISOString()}`)).toEqual([sent]);
      expect(
        await ids(
          `createdFrom=${created.toISOString()}&createdTo=${new Date(created.getTime() + 1).toISOString()}`,
        ),
      ).toEqual([paid]);
    });

    it("filters by customer", async () => {
      const customer = await createTestCustomer(world().database);
      try {
        const mine = await world().enqueued({
          templateKey: "order.paid",
          recipientKind: "customer",
          customerId: customer.id,
          to: customer.email,
          variables: { orderNumber: "AAAA-0002", currency: "UAH", total: 5 },
        });
        await world().enqueued();
        const page = await ctx.call<PageBody>(
          "GET",
          `/admin/email/messages?customerId=${customer.id}`,
        );
        expect(page.body.items.map((item) => item.id)).toEqual([mine]);
        expect(page.body.items[0]?.customerId).toBe(customer.id);
        const none = await ctx.call<PageBody>(
          "GET",
          `/admin/email/messages?orderId=${randomUUID()}`,
        );
        expect(none.body).toMatchObject({ items: [], total: 0 });
      } finally {
        await world().pool.query("delete from email_message");
        await deleteTestCustomers(world().database, [customer.id]);
      }
    });

    it.each([
      ["limit=0"],
      ["limit=101"],
      ["offset=-1"],
      ["status=bogus"],
      ["template=Not A Key"],
      ["recipient="],
      ["customerId=nope"],
      ["createdFrom=yesterday"],
      ["createdFrom=2030-03-02T00:00:00.000Z&createdTo=2030-03-01T00:00:00.000Z"],
      ["unknown=1"],
    ])("answers 400 for %s", async (query) => {
      const result = await ctx.call<ProblemBody>("GET", `/admin/email/messages?${query}`);
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ code: "validation_failed" });
    });
  });

  describe("GET /admin/email/messages/{id}", () => {
    it("shows the journal fields of one message", async () => {
      const id = await world().enqueued();
      await settle(id, "failed");
      const result = await ctx.call<MessageBody>("GET", `/admin/email/messages/${id}`);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        id,
        templateKey: "admin.test",
        templateVersion: 1,
        locale: "en",
        to: TEST_RECIPIENT,
        recipientKind: "admin",
        status: "failed",
        attempts: 1,
        lastErrorCode: "rejected",
        canCancel: false,
        canResend: true,
        variables: { providerCode: "fake" },
      });
      expect(result.headers.get("cache-control")).toBe("no-store");
    });

    it("shows only the variables the template declares, none of an account mail, and none of an unregistered template", async () => {
      const tokenRow = randomUUID();
      const reset = await world().enqueued({
        templateKey: "customer.password_reset",
        recipientKind: "customer",
        variables: { tokenId: tokenRow },
        authTokenExpiresAt: new Date(world().clock.now().getTime() + 30 * MINUTE),
      });
      const shown = await ctx.call<MessageBody>("GET", `/admin/email/messages/${reset}`);
      expect(shown.body.variables).toEqual({ tokenId: "[redacted]" });
      expect(JSON.stringify(shown.body)).not.toContain(tokenRow);

      const paid = await world().enqueued({
        templateKey: "order.paid",
        recipientKind: "guest",
        variables: { orderNumber: "AAAA-0003", currency: "UAH", total: 4200 },
      });
      const paidShown = await ctx.call<MessageBody>("GET", `/admin/email/messages/${paid}`);
      expect(paidShown.body.variables).toEqual({
        orderNumber: "AAAA-0003",
        currency: "UAH",
        total: 4200,
      });

      // Only the keys the template declares (`displayVariables`) are shown; a stored key it does not list is not,
      // whatever its name (review F3), and neither is any value of a template that is not registered any more.
      await world().pool.query(
        `update email_message set variables = variables || '{"code":"123456","href":"https://x.example/m"}' where id = $1`,
        [paid],
      );
      const extra = await ctx.call<MessageBody>("GET", `/admin/email/messages/${paid}`);
      expect(extra.body.variables).toEqual({
        orderNumber: "AAAA-0003",
        currency: "UAH",
        total: 4200,
        code: "[redacted]",
        href: "[redacted]",
      });
      await world().pool.query(
        "update email_message set template_key = 'removed_feature.notice' where id = $1",
        [paid],
      );
      const orphan = await ctx.call<MessageBody>("GET", `/admin/email/messages/${paid}`);
      expect(orphan.body.variables).toEqual({
        orderNumber: "[redacted]",
        currency: "[redacted]",
        total: "[redacted]",
        code: "[redacted]",
        href: "[redacted]",
      });
    });

    it("answers 404 for an unknown id and 400 for a malformed one", async () => {
      expect((await ctx.call("GET", `/admin/email/messages/${randomUUID()}`)).status).toBe(404);
      expect((await ctx.call("GET", "/admin/email/messages/not-a-uuid")).status).toBe(400);
    });
  });

  describe("POST /admin/email/messages/{id}/cancel", () => {
    it("cancels a pending message through the writer as the admin and the provider never gets it", async () => {
      const id = await world().enqueued();
      const result = await ctx.call<MessageBody>("POST", `/admin/email/messages/${id}/cancel`);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        id,
        status: "cancelled",
        canCancel: false,
        canResend: true,
      });
      expect((await world().row(id)).status).toBe("cancelled");
      expect(await world().attempt(id)).toEqual({ kind: "skipped" });
      expect(world().provider().calls).toEqual([]);
    });

    it.each(["sent", "failed", "unknown", "cancelled"] as const)(
      "refuses a %s message with 409 invalid_transition and changes nothing",
      async (status) => {
        const id = await world().enqueued();
        await settle(id, status);
        const before = await world().row(id);
        const result = await ctx.call<ProblemBody>("POST", `/admin/email/messages/${id}/cancel`);
        expect(result.status).toBe(409);
        expect(result.body).toMatchObject({ code: "invalid_transition" });
        expect(await world().row(id)).toEqual(before);
      },
    );

    it("answers 404 for an unknown id", async () => {
      expect((await ctx.call("POST", `/admin/email/messages/${randomUUID()}/cancel`)).status).toBe(
        404,
      );
    });
  });

  describe("POST /admin/email/messages/{id}/resend", () => {
    it("creates a NEW row with resend_of, the same template and variables, a fresh id and no dedupe key, and sends it", async () => {
      const original = await world().enqueued({
        templateKey: "order.cancelled",
        recipientKind: "guest",
        to: "guest@example.net",
        locale: "uk",
        variables: { orderNumber: "AAAA-0004" },
        eventId: randomUUID(),
      });
      await settle(original, "failed");
      const before = await world().row(original);
      const result = await ctx.call<{ messageId: string }>(
        "POST",
        `/admin/email/messages/${original}/resend`,
      );
      expect(result.status).toBe(202);
      const id = result.body.messageId;
      expect(id).not.toBe(original);
      await untilStatus(id, "sent");
      const copy = await world().row(id);
      expect(copy).toMatchObject({
        template_key: "order.cancelled",
        template_version: 1,
        locale: "uk",
        to_address: "guest@example.net",
        recipient_kind: "guest",
        variables: { orderNumber: "AAAA-0004" },
        dedupe_key: null,
      });
      const link = await world().pool.query(
        "select resend_of, created_by_admin_id from email_message where id = $1",
        [id],
      );
      expect(link.rows[0]).toEqual({ resend_of: original, created_by_admin_id: owner.id });
      expect(await world().row(original)).toEqual(before);
      expect(
        world()
          .provider()
          .sent.map((mail) => mail.idempotencyKey),
      ).toEqual([id]);
    });

    it.each(["sent", "failed", "unknown", "cancelled"] as const)(
      "may resend a %s message",
      async (status) => {
        const original = await world().enqueued({
          templateKey: "order.cancelled",
          recipientKind: "guest",
          variables: { orderNumber: "AAAA-0005" },
        });
        await settle(original, status);
        const result = await ctx.call("POST", `/admin/email/messages/${original}/resend`);
        expect(result.status).toBe(202);
      },
    );

    it("refuses a message that is still pending or sending", async () => {
      const pending = await world().enqueued();
      const refusedPending = await ctx.call<ProblemBody>(
        "POST",
        `/admin/email/messages/${pending}/resend`,
      );
      expect(refusedPending.status).toBe(409);
      expect(refusedPending.body).toMatchObject({ code: "rule_violation", rule: "message_open" });
      const sending = await world().enqueued();
      await world().pool.query(
        "update email_message set status = 'sending', attempts = 1, lease_until = now() + interval '2 minutes' where id = $1",
        [sending],
      );
      const refusedSending = await ctx.call<ProblemBody>(
        "POST",
        `/admin/email/messages/${sending}/resend`,
      );
      expect(refusedSending.status).toBe(409);
      expect(refusedSending.body).toMatchObject({ code: "rule_violation", rule: "message_open" });
      expect(await world().count()).toBe(2);
    });

    it("refuses the account mails of a customer: the person asks again", async () => {
      for (const templateKey of [
        "customer.password_changed",
        "customer.password_reset",
        "customer.verify_email",
      ]) {
        const original = await world().enqueued({
          templateKey,
          recipientKind: "customer",
          variables: templateKey === "customer.password_changed" ? {} : { tokenId: randomUUID() },
          authTokenExpiresAt: new Date(world().clock.now().getTime() + 30 * MINUTE),
        });
        await settle(original, "failed");
        const result = await ctx.call<ProblemBody>(
          "POST",
          `/admin/email/messages/${original}/resend`,
        );
        expect(result.status, templateKey).toBe(409);
        expect(result.body, templateKey).toMatchObject({
          code: "rule_violation",
          rule: "not_resendable",
        });
      }
    });

    it("refuses a message whose template is no longer registered", async () => {
      const original = await world().enqueued();
      await world().pool.query(
        "update email_message set template_key = 'gone.template', status = 'failed', attempts = 1, last_error_code = 'template_unavailable' where id = $1",
        [original],
      );
      const result = await ctx.call<ProblemBody>(
        "POST",
        `/admin/email/messages/${original}/resend`,
      );
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ code: "rule_violation", rule: "template_unavailable" });
    });

    it("renders the copy with the CURRENT template version when the original has another (step 5 decision 6)", async () => {
      const original = await world().enqueued();
      await world().pool.query(
        "update email_message set template_version = 7, status = 'failed', attempts = 1, last_error_code = 'template_unavailable' where id = $1",
        [original],
      );
      const result = await ctx.call<{ messageId: string }>(
        "POST",
        `/admin/email/messages/${original}/resend`,
      );
      expect(result.status).toBe(202);
      expect((await world().row(result.body.messageId)).template_version).toBe(1);
      await untilStatus(result.body.messageId, "sent");
    });

    it("refuses variables the current schema no longer accepts", async () => {
      const original = await world().enqueued({
        templateKey: "order.paid",
        recipientKind: "guest",
        variables: { orderNumber: "AAAA-0006", currency: "UAH", total: 1 },
      });
      await world().pool.query(
        `update email_message set variables = '{"orderNumber":"AAAA-0006","legacy":true}', status = 'failed', attempts = 1, last_error_code = 'variables_invalid' where id = $1`,
        [original],
      );
      const result = await ctx.call<ProblemBody>(
        "POST",
        `/admin/email/messages/${original}/resend`,
      );
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ code: "rule_violation", rule: "variables_invalid" });
      expect(await world().count()).toBe(1);
    });

    it("resends admin.test to the address of the CALLER, never to the first admin (decision for ADR open question 8)", async () => {
      const original = await world().enqueued({ to: owner.email });
      await world().pool.query("update email_message set admin_user_id = $2 where id = $1", [
        original,
        owner.id,
      ]);
      await settle(original, "sent");
      const second = await ctx.signInAs("manager");
      const result = await ctx.call<{ messageId: string }>(
        "POST",
        `/admin/email/messages/${original}/resend`,
      );
      expect(result.status).toBe(202);
      await untilStatus(result.body.messageId, "sent");
      const copy = await world().pool.query(
        "select to_address, admin_user_id, created_by_admin_id, resend_of from email_message where id = $1",
        [result.body.messageId],
      );
      expect(copy.rows[0]).toEqual({
        to_address: second.email.toLowerCase(),
        admin_user_id: second.id,
        created_by_admin_id: second.id,
        resend_of: original,
      });
      expect(
        world()
          .provider()
          .sent.map((mail) => mail.message.to.address),
      ).toEqual([second.email.toLowerCase()]);
    });

    it("limits resends to 30 per hour per admin user (email review F2), and another admin keeps their own window", async () => {
      const original = await world().enqueued({
        templateKey: "order.cancelled",
        recipientKind: "guest",
        variables: { orderNumber: "AAAA-0009" },
      });
      await settle(original, "sent");
      const path = `/admin/email/messages/${original}/resend`;
      for (let resent = 0; resent < 30; resent += 1) {
        expect((await ctx.call("POST", path)).status, `resend ${String(resent)}`).toBe(202);
      }
      const before = await world().count();
      const limited = await ctx.call<ProblemBody>("POST", path);
      expect(limited.status).toBe(429);
      expect(limited.body).toMatchObject({ code: "too_many_requests" });
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await world().count()).toBe(before);
      await ctx.signInAs("manager");
      expect((await ctx.call("POST", path)).status).toBe(202);
      ctx.switchTo(owner);
      world().clock.advanceMinutes(61);
      expect((await ctx.call("POST", path)).status).toBe(202);
    });

    it("answers 404 for an unknown id", async () => {
      expect((await ctx.call("POST", `/admin/email/messages/${randomUUID()}/resend`)).status).toBe(
        404,
      );
    });
  });

  describe("logs", () => {
    it("never carry an address, a variable, a subject or a token (ADR 0031 decision 8)", async () => {
      const logs = captureLogs();
      try {
        const original = await world().enqueued({
          templateKey: "order.cancelled",
          recipientKind: "guest",
          to: "private.person@example.net",
          variables: { orderNumber: "AAAA-9999" },
        });
        await settle(original, "failed");
        const test = await ctx.call<{ messageId: string }>("POST", "/admin/email/test", {
          body: {},
        });
        const resent = await ctx.call<{ messageId: string }>(
          "POST",
          `/admin/email/messages/${original}/resend`,
        );
        const pending = await world().enqueued({ to: "other.person@example.net" });
        await ctx.call("POST", `/admin/email/messages/${pending}/cancel`);
        await ctx.call("GET", "/admin/email/messages?recipient=private.person");
        await ctx.call("GET", `/admin/email/messages/${original}`);
        await ctx.call("GET", "/admin/email/status");
        await untilStatus(test.body.messageId, "sent");
        await untilStatus(resent.body.messageId, "sent");
        const text = logs.text();
        for (const secret of [
          "private.person",
          "other.person",
          owner.email,
          "AAAA-9999",
          "Test email from",
        ]) {
          expect(text, secret).not.toContain(secret);
        }
      } finally {
        logs.stop();
      }
    });
  });
});
