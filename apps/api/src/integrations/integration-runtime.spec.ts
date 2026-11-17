import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { EmailOutbox } from "../email/outbox/email-outbox.service.js";
import { EmailSender } from "../email/outbox/email-sender.js";
import { createTestAdminUser, deleteTestAdminUsers } from "../test/admin-user-fixtures.js";
import { startApp, type RunningApp } from "../test/app.js";
import { sessionCookieOf } from "../test/auth-http.js";
import { requireEnv } from "../test/env.js";
import { http } from "../test/http.js";
import {
  createIntegrationProviderFixture,
  testSecretsKeyRing,
  type IntegrationProviderFixture,
} from "../test/integration-provider-fixture.js";
import { ensureMigrated } from "../test/migrate.js";
import { withTransaction } from "../common/transaction.js";

const PASSWORD = "correct horse battery staple";
const MAIL_KEY = "tm_SENTINELkey0123456789";

interface Listed {
  id: string;
  providerCode: string;
  enabled: boolean;
}
interface ListBody {
  revision: number;
  items: Listed[];
}
interface DetailBody {
  revision: number;
  integration: Listed;
}
interface ProblemBody {
  code: string;
  rule?: string;
  errors?: { path: string; code: string }[];
}

describe("stored email credential at runtime (real Postgres and Redis)", () => {
  const prefix = `runtime_${randomUUID()}`;
  let fixture: IntegrationProviderFixture;
  let running: RunningApp;
  let db: Database;
  let sentIds: () => string[];
  const userIds: string[] = [];
  let addressCounter = 0;

  const nextAddress = (): string => {
    addressCounter += 1;
    return `203.0.113.${addressCounter}`;
  };

  async function signIn() {
    const user = await createTestAdminUser(db, { role: "owner", password: PASSWORD });
    userIds.push(user.id);
    const address = nextAddress();
    const signedIn = await http(running.baseUrl, "POST", "/admin/auth/login", {
      headers: { "x-forwarded-for": address },
      body: { email: user.email, password: PASSWORD },
    });
    const cookie = sessionCookieOf(signedIn);
    if (signedIn.status !== 200 || cookie === undefined) {
      throw new Error(`Test setup bug: login answered ${String(signedIn.status)}`);
    }
    const call = <T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown) =>
      http<T>(running.baseUrl, method, path, {
        headers: { cookie, "x-forwarded-for": address },
        ...(body === undefined ? {} : { body }),
      });
    return { user, call };
  }

  async function listed(session: Awaited<ReturnType<typeof signIn>>): Promise<ListBody> {
    const result = await session.call<ListBody>("GET", "/admin/integrations");
    expect(result.status).toBe(200);
    return result.body;
  }

  async function wipe(): Promise<void> {
    await db.execute(
      sql`update integration set enabled = false, active_outbound_version_id = null`,
    );
    await db.execute(sql`update email_message set integration_credential_version_id = null`);
    await db.execute(sql`delete from integration_secret`);
    await db.execute(sql`delete from integration_credential_version`);
  }

  beforeAll(async () => {
    await ensureMigrated();
    fixture = await createIntegrationProviderFixture();
    const loaded = (await import(
      pathToFileURL(join(fixture.dir, "testmail", "index.js")).href
    )) as {
      sentMessageIds: () => string[];
    };
    sentIds = loaded.sentMessageIds;
    running = await startApp({
      adminAuthenticator: "production-default",
      redisUrl: requireEnv("REDIS_URL"),
      rateLimitKeyPrefix: prefix,
      trustProxy: 1,
      secretsKeyRing: testSecretsKeyRing("runtime-key"),
      integrationProvidersDir: fixture.dir,
      integrationEnvironment: {},
      emailRouteDelegated: true,
    });
    db = running.app.get<Database>(DRIZZLE);
    await wipe();
  });

  afterEach(async () => {
    await wipe();
    await deleteTestAdminUsers(db, userIds.splice(0));
  });

  afterAll(async () => {
    await running?.app.close();
    await fixture?.remove();
  });

  async function saveAndRead(session: Awaited<ReturnType<typeof signIn>>, code: string) {
    const item = (await listed(session)).items.find((entry) => entry.providerCode === code);
    if (item === undefined) throw new Error(`fixture: ${code} is not listed`);
    return item;
  }

  it("sends with the activated stored key and records the version on the mail", async () => {
    const session = await signIn();
    const testmail = await saveAndRead(session, "testmail");
    const before = await listed(session);
    const saved = await session.call<DetailBody>(
      "PUT",
      `/admin/integrations/${testmail.id}/secrets/api_key`,
      { expectedRevision: before.revision, value: MAIL_KEY, currentPassword: PASSWORD },
    );
    expect(saved.status).toBe(200);
    const activated = await session.call<DetailBody>(
      "POST",
      `/admin/integrations/${testmail.id}/activate`,
      { expectedRevision: saved.body.revision, currentPassword: PASSWORD },
    );
    expect(activated.status).toBe(200);
    expect(activated.body.integration.enabled).toBe(true);

    const outbox = running.app.get(EmailOutbox);
    const sender = running.app.get(EmailSender);
    const queued = await withTransaction(db, (tx) =>
      outbox.enqueue(tx, {
        templateKey: "admin.test",
        locale: "en",
        to: "owner@example.com",
        recipientKind: "admin",
        adminUserId: session.user.id,
        createdByAdminId: session.user.id,
        variables: { providerCode: "testmail" },
        now: new Date(),
      }),
    );
    expect(queued.status).toBe("enqueued");
    if (queued.status !== "enqueued") return;
    expect((await sender.sendNow(queued.id)).kind).toBe("sent");
    expect(sentIds()).toContain(queued.id);
    const bound = await db.execute<{ integration_credential_version_id: string | null }>(sql`
      select integration_credential_version_id from email_message where id = ${queued.id}::uuid`);
    expect(bound.rows[0]?.integration_credential_version_id).toBeTypeOf("string");
  });

  it("does not call the provider after the version is revoked", async () => {
    const session = await signIn();
    const testmail = await saveAndRead(session, "testmail");
    const before = await listed(session);
    const saved = await session.call<
      DetailBody & { integration: { secrets: { versionId: string | null }[] } }
    >("PUT", `/admin/integrations/${testmail.id}/secrets/api_key`, {
      expectedRevision: before.revision,
      value: MAIL_KEY,
      currentPassword: PASSWORD,
    });
    expect(saved.status).toBe(200);
    const versionId = saved.body.integration.secrets[0]?.versionId;
    if (versionId === null || versionId === undefined) throw new Error("fixture: no version");
    const activated = await session.call<DetailBody>(
      "POST",
      `/admin/integrations/${testmail.id}/activate`,
      { expectedRevision: saved.body.revision, currentPassword: PASSWORD },
    );
    expect(activated.status).toBe(200);
    const queued = await withTransaction(db, (tx) =>
      running.app.get(EmailOutbox).enqueue(tx, {
        templateKey: "admin.test",
        locale: "en",
        to: "owner@example.com",
        recipientKind: "admin",
        adminUserId: session.user.id,
        createdByAdminId: session.user.id,
        variables: { providerCode: "testmail" },
        now: new Date(),
      }),
    );
    expect(queued.status).toBe("enqueued");
    if (queued.status !== "enqueued") return;
    const provider = running.app.get(EmailSender).provider();
    const revoked = await session.call<ProblemBody>(
      "POST",
      `/admin/integrations/${testmail.id}/revoke-secret`,
      { expectedRevision: activated.body.revision, versionId, currentPassword: PASSWORD },
    );
    expect(revoked.status).toBe(200);
    const beforeCount = sentIds().length;
    const answer = await provider?.send(
      {
        from: { address: "shop@example.com", displayName: null },
        to: { address: "owner@example.com", displayName: null },
        subject: "Hello",
        text: "Hello",
        html: "<p>Hello</p>",
        tags: { category: "admin" },
      },
      { idempotencyKey: queued.id },
      new AbortController().signal,
    );
    expect(answer).toMatchObject({ ok: false, reason: "not_sent" });
    expect(sentIds()).toHaveLength(beforeCount);
  });

  it("refuses a second email provider, a wrong password, and a missing password", async () => {
    const session = await signIn();
    const testmail = await saveAndRead(session, "testmail");
    const other = await saveAndRead(session, "fake");
    let revision = (await listed(session)).revision;
    const saved = await session.call<DetailBody>(
      "PUT",
      `/admin/integrations/${testmail.id}/secrets/api_key`,
      { expectedRevision: revision, value: MAIL_KEY, currentPassword: PASSWORD },
    );
    expect(saved.status).toBe(200);
    revision = saved.body.revision;
    const first = await session.call<DetailBody>(
      "POST",
      `/admin/integrations/${testmail.id}/activate`,
      { expectedRevision: revision, currentPassword: PASSWORD },
    );
    expect(first.status).toBe(200);
    revision = first.body.revision;
    const otherSaved = await session.call<DetailBody>(
      "PUT",
      `/admin/integrations/${other.id}/secrets/api_key`,
      { expectedRevision: revision, value: "anything-accepted", currentPassword: PASSWORD },
    );
    expect(otherSaved.status).toBe(200);
    const blocked = await session.call<ProblemBody>(
      "POST",
      `/admin/integrations/${other.id}/activate`,
      { expectedRevision: otherSaved.body.revision, currentPassword: PASSWORD },
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.rule).toBe("integration_route_unset");
    const wrong = await session.call<ProblemBody>(
      "POST",
      `/admin/integrations/${testmail.id}/disable`,
      { expectedRevision: otherSaved.body.revision, currentPassword: "not the password" },
    );
    expect(wrong.status).toBe(403);
    expect(wrong.body.rule).toBe("current_password_incorrect");
    const still = await saveAndRead(session, "testmail");
    expect(still.enabled).toBe(true);
    const missing = await session.call<ProblemBody>(
      "POST",
      `/admin/integrations/${testmail.id}/disable`,
      { expectedRevision: otherSaved.body.revision },
    );
    expect(missing.status).toBe(400);
    expect(missing.body.errors?.[0]?.path).toBe("currentPassword");
  });
});
