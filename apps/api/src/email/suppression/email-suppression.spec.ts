import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { HttpException, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { EmailSuppressionFact, EmailWebhookVerifier } from "@fluxkit/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../common/transaction.js";
import { customer } from "../../database/schema/index.js";
import { AdminAuditWriter } from "../../privacy/audit/admin-audit.writer.js";
import { PrivacyErasureService } from "../../privacy/erasure/privacy-erasure.service.js";
import { PersonalDataExportService } from "../../privacy/export/personal-data-export.service.js";
import { PersonalDataReader } from "../../privacy/export/personal-data.reader.js";
import { createTestCustomer } from "../../test/customer-fixtures.js";
import { EmailWorld } from "../../test/email-world.js";
import { http } from "../../test/http.js";
import { startApp } from "../../test/app.js";
import { EmailProviderRegistry } from "../registry/index.js";
import { lockEmailSuppressionAddress } from "./email-suppression-lock.js";
import { WINDOW_STORE, type WindowStore } from "../../rate-limit/window-store.js";
import { EmailSuppressionService } from "./email-suppression.service.js";

const ADDRESS = "suppression-sentinel@example.test";
const DAY = 86_400_000;

describe("shared suppression (real Postgres, two API instances)", () => {
  let world: EmailWorld;
  const now = () => world.clock.now();
  const service = () => world.get(EmailSuppressionService);
  const fact = (
    eventKey: string = randomUUID(),
    age = 0,
    reason: EmailSuppressionFact["reason"] = "hard_bounce",
  ): EmailSuppressionFact => ({
    eventKey,
    recipient: ADDRESS,
    reason,
    eventAt: new Date(now().getTime() - age),
  });
  const ingest = (...facts: EmailSuppressionFact[]) => service().ingest("resend", facts, now());
  const rows = async () => (await world.pool.query("select * from email_suppression")).rows;
  const receipts = async () => (await world.pool.query("select * from email_webhook_receipt")).rows;

  beforeAll(async () => {
    world = await EmailWorld.start();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await world.clear();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await world.stop();
  });

  it("atomically deduplicates the same receipt across two instances and preserves receipt time", async () => {
    const second = await world.secondInstance();
    const event = fact();
    await Promise.all([
      ingest(event),
      world.get(EmailSuppressionService, second).ingest("resend", [event], now()),
    ]);
    expect(await rows()).toHaveLength(1);
    const before = await receipts();
    expect(before).toHaveLength(1);
    await service().ingest("resend", [event], new Date(now().getTime() + 60_000));
    expect(await receipts()).toEqual(before);
    expect(await service().isSuppressed(" Suppression-Sentinel@Example.Test ")).toBe(true);
  });

  it("keeps earliest/latest event times and prevents older feedback replacing a newer reason/source", async () => {
    await ingest(fact("new", 1000, "complaint"));
    await service().ingest("brevo", [fact("old", 5000, "hard_bounce")], now());
    expect((await rows())[0]).toMatchObject({
      reason: "complaint",
      source_provider: "resend",
      first_seen_at: new Date(now().getTime() - 5000),
      last_seen_at: new Date(now().getTime() - 1000),
    });
    await service().ingest("brevo", [fact("newest", 0, "blocked")], now());
    expect((await rows())[0]).toMatchObject({ reason: "blocked", source_provider: "brevo" });
  });

  it("rolls back every receipt and suppression on a later insert failure", async () => {
    await expect(
      ingest(fact("first"), { ...fact("second"), recipient: "zzz-not-an-address" }),
    ).rejects.toThrow();
    expect(await rows()).toHaveLength(0);
    expect(await receipts()).toHaveLength(0);
  });

  it("lists full normalized and masked addresses, bounds pagination, and rejects address queries and invalid IDs", async () => {
    await ingest(fact());
    const list = await http<{
      items: { id: string; toAddress: string; toAddressMasked: string }[];
      total: number;
    }>(world.running.baseUrl, "GET", "/admin/email/suppressions?limit=1&offset=0");
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]?.toAddressMasked).toBe("s***@e***.t***");
    expect(list.body.items[0]?.toAddress).toBe(ADDRESS);
    expect(
      (await http(world.running.baseUrl, "GET", "/admin/email/suppressions?limit=101")).status,
    ).toBe(400);
    expect(
      (await http(world.running.baseUrl, "GET", "/admin/email/suppressions?recipient=anything"))
        .status,
    ).toBe(400);
    expect(
      (await http(world.running.baseUrl, "DELETE", "/admin/email/suppressions/not-a-uuid")).status,
    ).toBe(400);
  });

  it("requires permission/session and CSRF for removal; an authorized removal is audited without an address", async () => {
    await ingest(fact());
    const id = String((await rows())[0]?.["id"]);
    const viewer = await startApp({ adminPrincipal: { role: "viewer" } });
    const anonymous = await startApp({ adminAuthenticator: { authenticate: () => undefined } });
    try {
      for (const method of ["GET", "DELETE"] as const) {
        const path = `/admin/email/suppressions${method === "DELETE" ? `/${id}` : ""}`;
        const forbidden = await http(viewer.baseUrl, method, path);
        const unauthenticated = await http(anonymous.baseUrl, method, path);
        expect(forbidden.status).toBe(403);
        expect(unauthenticated.status).toBe(401);
        expect(JSON.stringify(forbidden.body)).not.toContain(ADDRESS);
        expect(JSON.stringify(unauthenticated.body)).not.toContain(ADDRESS);
      }
      expect(
        (
          await http(world.running.baseUrl, "DELETE", `/admin/email/suppressions/${id}`, {
            csrf: false,
          })
        ).status,
      ).toBe(403);
      expect(
        (await http(world.running.baseUrl, "DELETE", `/admin/email/suppressions/${id}`)).status,
      ).toBe(204);
      const audit = await world.pool.query(
        "select action,target_kind,target_id,detail from admin_audit_event where target_id=$1",
        [id],
      );
      expect(audit.rows).toEqual([
        {
          action: "email_suppression.removed",
          target_kind: "email_suppression",
          target_id: id,
          detail: {},
        },
      ]);
      expect(JSON.stringify(audit.rows)).not.toContain(ADDRESS);
      expect(await receipts()).toHaveLength(1);
    } finally {
      await viewer.app.close();
      await anonymous.app.close();
    }
  });

  it("distinguishes two recipients with identical masks for an authorized admin", async () => {
    const otherAddress = "second-recipient@example.test";
    await ingest(fact(), { ...fact(), recipient: otherAddress });
    const list = await http<{ items: { toAddress: string; toAddressMasked: string }[] }>(
      world.running.baseUrl,
      "GET",
      "/admin/email/suppressions",
    );
    expect(list.status).toBe(200);
    expect(list.body.items.map((item) => item.toAddress).sort()).toEqual(
      [ADDRESS, otherAddress].sort(),
    );
    expect(list.body.items.map((item) => item.toAddressMasked)).toEqual([
      "s***@e***.t***",
      "s***@e***.t***",
    ]);
  });

  it("rolls back removal if its audit cannot commit, and replay after removal never recreates the block", async () => {
    const event = fact();
    await ingest(event);
    const id = String((await rows())[0]?.["id"]);
    const audit = vi
      .spyOn(world.get(AdminAuditWriter), "record")
      .mockRejectedValue(new Error("audit_unavailable"));
    await expect(service().remove(id, randomUUID())).rejects.toThrow("audit_unavailable");
    expect(await rows()).toHaveLength(1);
    audit.mockRestore();
    await service().remove(id, randomUUID());
    await ingest(event);
    expect(await rows()).toHaveLength(0);
    await ingest(fact());
    expect(await rows()).toHaveLength(1);
  });

  it("refuses rollback while suppression, receipts or suppression audit history exist", async () => {
    const down = await readFile(
      new URL("../../../drizzle/0017_email_suppression.down.sql", import.meta.url),
      "utf8",
    );
    const statements = [
      `insert into email_suppression (to_address,reason,source_provider,first_seen_at,last_seen_at) values ('rollback@example.test','blocked','resend',now(),now())`,
      `insert into email_webhook_receipt (provider_code,event_key,to_address,event_at,received_at) values ('resend','rollback','rollback@example.test',now(),now())`,
      `insert into admin_audit_event (action,target_kind,target_id) values ('email_suppression.removed','email_suppression',gen_random_uuid())`,
    ];
    for (const statement of statements) {
      const client = await world.pool.connect();
      try {
        await client.query("begin");
        await client.query(statement);
        await expect(client.query(down)).rejects.toThrow("email_suppression_rollback_incompatible");
      } finally {
        await client.query("rollback");
        client.release();
      }
    }
    expect(
      (await world.pool.query("select to_regclass('email_suppression')::text name")).rows[0]?.[
        "name"
      ],
    ).toBe("email_suppression");
  });

  it("exports and erases safety state only for verified address scope", async () => {
    const account = await createTestCustomer(world.database, { email: ADDRESS });
    const reader = world.get(PersonalDataReader);
    const exporter = world.get(PersonalDataExportService);
    const erasure = world.get(PrivacyErasureService);
    await ingest(fact());
    const unverified = await reader.byCustomer(world.database, account.id);
    if (unverified === undefined) throw new Error("missing test subject");
    expect(
      (await exporter.build(world.database, unverified, now())).document.emailSuppressions,
    ).toEqual([]);
    await withTransaction(world.database, (tx) => erasure.erase(tx, unverified, now()));
    expect(await rows()).toHaveLength(1);
    expect(await receipts()).toHaveLength(1);
    const verifiedAccount = await createTestCustomer(world.database, { email: ADDRESS });
    await world.database
      .update(customer)
      .set({ emailVerifiedAt: now() })
      .where(eq(customer.id, verifiedAccount.id));
    const verified = await reader.byCustomer(world.database, verifiedAccount.id);
    if (verified === undefined) throw new Error("missing test subject");
    const exported = (await exporter.build(world.database, verified, now())).document
      .emailSuppressions;
    expect(exported).toEqual([
      {
        reason: "hard_bounce",
        sourceProvider: "resend",
        firstSeenAt: now().toISOString(),
        lastSeenAt: now().toISOString(),
      },
    ]);
    expect(JSON.stringify(exported)).not.toContain(ADDRESS);
    await withTransaction(world.database, (tx) => erasure.erase(tx, verified, now()));
    expect(await rows()).toHaveLength(0);
    expect(await receipts()).toHaveLength(0);
  });

  it("serializes webhook feedback after an in-progress verified-address erasure", async () => {
    await ingest(fact());
    const subject = await world.get(PersonalDataReader).byEmail(world.database, ADDRESS);
    const erased = barrier();
    const finish = barrier();
    const erasing = withTransaction(world.database, async (tx) => {
      await world.get(PrivacyErasureService).erase(tx, subject, now());
      erased.release();
      await finish.promise;
    });
    await erased.promise;
    const incoming = ingest(fact());
    try {
      await waitForAdvisoryWaiters(1);
    } finally {
      finish.release();
    }
    await Promise.all([erasing, incoming]);
    expect(await rows()).toHaveLength(1);
    expect(await receipts()).toHaveLength(1);
  });

  it("serializes verified-address erasure after feedback already queued for the same address", async () => {
    const subject = await world.get(PersonalDataReader).byEmail(world.database, ADDRESS);
    const locked = barrier();
    const finish = barrier();
    const holding = withTransaction(world.database, async (tx) => {
      await lockEmailSuppressionAddress(tx, ADDRESS);
      locked.release();
      await finish.promise;
    });
    await locked.promise;
    const incoming = ingest(fact());
    let erasing: Promise<unknown> | undefined;
    try {
      await waitForAdvisoryWaiters(1);
      erasing = withTransaction(world.database, (tx) =>
        world.get(PrivacyErasureService).erase(tx, subject, now()),
      );
      await waitForAdvisoryWaiters(2);
    } finally {
      finish.release();
    }
    await Promise.all([holding, incoming, erasing]);
    expect(await rows()).toHaveLength(0);
    expect(await receipts()).toHaveLength(0);
  });

  async function waitForAdvisoryWaiters(expected: number): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await world.pool.query<{ total: string }>(
        "select count(*) total from pg_locks where locktype='advisory' and not granted",
      );
      if (Number(result.rows[0]?.total) >= expected) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Suppression transaction did not wait for the address lock");
  }

  it("answers window-store and unexpected controller failures with retryable problems, never 5xx", async () => {
    const registry = world.get(EmailProviderRegistry);
    const store = world.running.app.get<WindowStore>(WINDOW_STORE);
    const logs = vi.spyOn(Logger.prototype, "error");
    const post = () =>
      http(world.running.baseUrl, "POST", "/webhooks/email/fake", {
        rawBody: "{}",
        csrf: false,
      });
    for (const error of [
      new Error(`${ADDRESS} secret-sentinel`),
      new HttpException("secret-sentinel", 503),
    ]) {
      const failure = vi.spyOn(store, "hit").mockRejectedValue(error);
      const answer = await post();
      expect(answer.status).toBe(429);
      expect(answer.headers.get("retry-after")).toBe("5");
      expect(answer.headers.get("content-type")).toContain("application/problem+json");
      expect(answer.body).toMatchObject({ status: 429, code: "too_many_requests" });
      failure.mockRestore();
    }
    vi.spyOn(registry, "get").mockImplementation(() => {
      throw new Error(`${ADDRESS} secret-sentinel`);
    });
    const unexpected = await post();
    expect(unexpected.status).toBe(429);
    expect(unexpected.headers.get("retry-after")).toBe("5");
    expect(JSON.stringify(unexpected.body)).not.toContain("secret-sentinel");
    expect(logs.mock.calls.flat().join(" ")).not.toContain(ADDRESS);
    expect(logs.mock.calls.flat().join(" ")).not.toContain("secret-sentinel");
  });

  it("bounds a held advisory lock with 429, rolls back, and commits a later retry", async () => {
    const registry = world.get(EmailProviderRegistry);
    const provider = registry.get();
    if (provider === undefined) throw new Error("missing test provider");
    vi.spyOn(registry, "get").mockReturnValue({
      ...provider,
      webhookVerifier: () => ({ ok: true, ignored: false, facts: [fact("lock-retry")] }),
    });
    const post = () =>
      http(world.running.baseUrl, "POST", `/webhooks/email/${provider.code}`, {
        rawBody: "{}",
        csrf: false,
      });
    const holder = await world.pool.connect();
    try {
      await holder.query("begin");
      await holder.query(
        "select pg_advisory_xact_lock(hashtextextended('email-suppression:' || $1::text, 0))",
        [ADDRESS],
      );
      const started = Date.now();
      const answer = await Promise.race([
        post(),
        new Promise<never>((_resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Webhook exceeded the lock wait bound")),
            4000,
          );
          timer.unref();
        }),
      ]);
      expect(Date.now() - started).toBeLessThan(4000);
      expect(answer.status).toBe(429);
      expect(answer.headers.get("retry-after")).toBe("5");
      expect(await rows()).toHaveLength(0);
      expect(await receipts()).toHaveLength(0);
    } finally {
      await holder.query("rollback");
      holder.release();
    }
    expect((await post()).status).toBe(204);
    expect(await rows()).toHaveLength(1);
    expect(await receipts()).toHaveLength(1);
  });

  it("ingests raw bytes without JSON middleware, enforces authentication, age, shape and 429 retry semantics", async () => {
    const registry = world.get(EmailProviderRegistry);
    const provider = registry.get();
    if (provider === undefined) throw new Error("missing test provider");
    let outcome: ReturnType<NonNullable<typeof provider.webhookVerifier>> = {
      ok: true,
      facts: [fact()],
      ignored: false,
    };
    const verifier = vi.fn<EmailWebhookVerifier>(() => outcome);
    vi.spyOn(registry, "get").mockReturnValue({ ...provider, webhookVerifier: verifier });
    const post = (code = provider.code, rawBody = '{"keep":  1}') =>
      http(world.running.baseUrl, "POST", `/webhooks/email/${code}`, { rawBody, csrf: false });
    expect((await post("unknown")).status).toBe(404);
    expect((await post()).status).toBe(204);
    expect(Buffer.from(verifier.mock.calls[0]?.[0]?.rawBody ?? []).toString()).toBe('{"keep":  1}');
    outcome = { ok: false, reason: "unauthenticated" };
    expect((await post()).status).toBe(401);
    outcome = { ok: false, reason: "malformed" };
    expect((await post()).status).toBe(400);
    outcome = { ok: true, facts: [fact("old", 7 * DAY + 1)], ignored: false };
    const warning = vi.spyOn(Logger.prototype, "warn");
    expect((await post()).status).toBe(400);
    expect(warning.mock.calls.flat().join(" ")).toContain("email_webhook_event_stale");
    outcome = { ok: true, facts: [], ignored: true };
    expect((await post()).status).toBe(204);
    outcome = { ok: true, facts: [fact()], ignored: false };
    const failure = vi
      .spyOn(service(), "ingest")
      .mockRejectedValue(new Error(`${ADDRESS} secret-sentinel`));
    const logs = vi.spyOn(Logger.prototype, "error");
    const retry = await post();
    expect(retry.status).toBe(429);
    expect(retry.headers.get("retry-after")).toBe("5");
    expect(logs.mock.calls.flat().join(" ")).not.toContain(ADDRESS);
    expect(logs.mock.calls.flat().join(" ")).not.toContain("secret-sentinel");
    failure.mockRestore();
    expect((await post(provider.code, "x".repeat(64 * 1024 + 1))).status).toBe(413);
    vi.restoreAllMocks();
    expect((await post()).status).toBe(404);
  });
});

function barrier(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {
    throw new Error("Barrier not initialized");
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
