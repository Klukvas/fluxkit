import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { ProblemBody } from "../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";

describe("admin email routes with EMAIL_PROVIDER=none (no provider loaded)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let running: RunningApp;
  const rowId = randomUUID();

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ emailFrom: null, storefrontPublicUrl: null });
    await pool.query("delete from email_message");
    // A mail an earlier configuration left behind: pending and sent rows exist while the provider is off.
    await pool.query(
      `insert into email_message (id, template_key, template_version, locale, to_address, recipient_kind, variables, status, attempts, next_attempt_at, deadline_at, created_at, updated_at)
       values ($1, 'order.paid', 1, 'uk', 'old.buyer@example.net', 'guest', '{"orderNumber":"AAAA-0001","currency":"UAH","total":1}', 'pending', 0, now(), now() + interval '11 hours', now(), now())`,
      [rowId],
    );
  });

  afterAll(async () => {
    await pool.query("delete from email_message");
    await running.app.close();
    await pool.end();
  });

  const call = <T = unknown>(method: "GET" | "POST", path: string, body?: unknown) =>
    http<T>(running.baseUrl, method, path, body === undefined ? {} : { body });

  it("status works and says it is not configured", async () => {
    const result = await call<Record<string, unknown>>("GET", "/admin/email/status");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      configured: false,
      providerCode: null,
      from: null,
      replyTo: null,
      queueDepth: 1,
    });
  });

  it("test send and resend answer 409 rule_violation email_not_configured and write nothing", async () => {
    const test = await call<ProblemBody>("POST", "/admin/email/test", {});
    expect(test.status).toBe(409);
    expect(test.body).toMatchObject({ code: "rule_violation", rule: "email_not_configured" });
    await pool.query(
      "update email_message set status = 'failed', attempts = 1, last_error_code = 'deadline_passed' where id = $1",
      [rowId],
    );
    const resend = await call<ProblemBody>("POST", `/admin/email/messages/${rowId}/resend`);
    expect(resend.status).toBe(409);
    expect(resend.body).toMatchObject({ code: "rule_violation", rule: "email_not_configured" });
    const count = await pool.query("select count(*)::int as count from email_message");
    expect(count.rows[0].count).toBe(1);
  });

  it("the list, the detail, the template list and the preview still work", async () => {
    const list = await call<{ items: { id: string }[]; total: number }>(
      "GET",
      "/admin/email/messages",
    );
    expect(list.status).toBe(200);
    expect(list.body.items.map((item) => item.id)).toEqual([rowId]);
    expect((await call("GET", `/admin/email/messages/${rowId}`)).status).toBe(200);
    expect((await call("GET", "/admin/email/templates")).status).toBe(200);
    const preview = await call<{ html: string }>(
      "GET",
      "/admin/email/templates/order.paid/preview?locale=en",
    );
    expect(preview.status).toBe(200);
    expect(preview.body.html).toContain("<");
  });

  it("cancel still works on a message the provider can no longer send (it is a database change only)", async () => {
    await pool.query(
      "update email_message set status = 'pending', attempts = 0, last_error_code = null where id = $1",
      [rowId],
    );
    const result = await call<{ status: string }>("POST", `/admin/email/messages/${rowId}/cancel`);
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("cancelled");
  });
});
