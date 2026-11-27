import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Logger } from "@nestjs/common";
import { IntegrationRuntime } from "./integration-runtime.js";
import { InstalledIntegrations } from "./installed-integrations.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
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
import { AdminStepUpService } from "../auth/step-up/admin-step-up.service.js";
import { SecretCipher } from "./secret-cipher.js";
import type { IntegrationDetailResponse } from "./integrations.schemas.js";

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
  const environment: Record<string, string | undefined> = {};
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
    const manifestPath = join(fixture.dir, "testmail", "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      fluxkit: Record<string, unknown>;
    };
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...manifest,
        fluxkit: {
          ...manifest.fluxkit,
          environments: {
            values: ["default", "sandbox", "production"],
            default: "default",
            env: "TESTMAIL_ENVIRONMENT",
          },
        },
      }),
    );
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
      integrationEnvironment: environment,
      emailRouteDelegated: true,
    });
    db = running.app.get<Database>(DRIZZLE);
    await wipe();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete environment.TESTMAIL_ENVIRONMENT;
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

  it.each([
    ["locked elsewhere", "before step-up"],
    ["locked elsewhere", "during step-up"],
    ["absent from the manifest", "before step-up"],
    ["absent from the manifest", "during step-up"],
  ])(
    "refuses activation when the candidate environment is %s %s without changing state",
    async (restriction, timing) => {
      const session = await signIn();
      const item = await saveAndRead(session, "testmail");
      const before = await listed(session);
      const saved = await session.call<IntegrationDetailResponse>(
        "PUT",
        `/admin/integrations/${item.id}/secrets/api_key`,
        {
          expectedRevision: before.revision,
          currentPassword: PASSWORD,
          value: MAIL_KEY,
          environment: "sandbox",
        },
      );
      expect(saved.status).toBe(200);
      expect(saved.body.integration.versions[0]).toMatchObject({
        environment: "sandbox",
        state: "candidate",
      });
      const installed = running.app.get(InstalledIntegrations);
      const provider = await installed.find("email", "testmail");
      if (provider?.environments === undefined) throw new Error("fixture_environments");
      const values = [...provider.environments.values];
      vi.spyOn(installed, "find").mockResolvedValue({
        ...provider,
        environments: { ...provider.environments, values },
      });
      const restrictEnvironment = (): void => {
        if (restriction === "locked elsewhere") environment.TESTMAIL_ENVIRONMENT = "production";
        else values.splice(values.indexOf("sandbox"), 1);
      };
      const stepUp = running.app.get(AdminStepUpService);
      const verify = stepUp.verify.bind(stepUp);
      const verified = vi.spyOn(stepUp, "verify");
      if (timing === "before step-up") restrictEnvironment();
      else
        verified.mockImplementation(async (request) => {
          const result = await verify(request);
          restrictEnvironment();
          return result;
        });
      const open = vi.spyOn(running.app.get(SecretCipher), "open");
      const construct = vi.spyOn(running.app.get(IntegrationRuntime), "validateEmailCandidate");
      const alertsBefore = await db.execute(sql`select id from email_message`);
      const auditBefore = await db.execute(sql`select id from admin_audit_event`);
      const refused = await session.call<ProblemBody>(
        "POST",
        `/admin/integrations/${item.id}/activate`,
        { expectedRevision: saved.body.revision, currentPassword: PASSWORD },
      );
      expect(refused.status).toBe(409);
      expect(refused.body.rule).toBe("integration_env_override");
      if (timing === "before step-up") expect(verified).not.toHaveBeenCalled();
      else expect(verified).toHaveBeenCalledOnce();
      expect(open).not.toHaveBeenCalled();
      expect(construct).not.toHaveBeenCalled();
      const after = await session.call<IntegrationDetailResponse>(
        "GET",
        `/admin/integrations/${item.id}`,
      );
      expect(after.body.revision).toBe(saved.body.revision);
      expect(after.body.integration.enabled).toBe(false);
      expect(after.body.integration.versions).toEqual(saved.body.integration.versions);
      const pointer = await db.execute<{ active_outbound_version_id: string | null }>(
        sql`select active_outbound_version_id from integration where id=${item.id}::uuid`,
      );
      expect(pointer.rows[0]?.active_outbound_version_id).toBeNull();
      expect((await db.execute(sql`select id from email_message`)).rows).toEqual(alertsBefore.rows);
      expect((await db.execute(sql`select id from admin_audit_event`)).rows).toEqual(
        auditBefore.rows,
      );
    },
  );

  it("observes a rejected async factory and logs only a code", async () => {
    const dir = join(fixture.dir, "asyncfactory");
    await mkdir(dir);
    await writeFile(
      join(dir, "index.js"),
      `export const rejected = Promise.reject(new Error("FACTORY_SECRET_SENTINEL")); rejected.catch(()=>{}); export function createOutboundClient(){return rejected;}`,
    );
    const imported = (await import(pathToFileURL(join(dir, "index.js")).href)) as {
      rejected: Promise<unknown>;
    };
    const observed = vi.spyOn(imported.rejected, "catch");
    const log = vi.spyOn(Logger.prototype, "error");
    const session = await signIn();
    const item = await saveAndRead(session, "testmail");
    const list = await listed(session);
    const saved = await session.call<{
      revision: number;
      integration: { secrets: { versionId: string; generation: number }[] };
    }>("PUT", `/admin/integrations/${item.id}/secrets/api_key`, {
      expectedRevision: list.revision,
      currentPassword: PASSWORD,
      value: MAIL_KEY,
    });
    const version = saved.body.integration.secrets[0];
    if (version === undefined) throw new Error("fixture_version");
    const installed = await running.app.get(InstalledIntegrations).find("email", "testmail");
    if (installed === undefined) throw new Error("fixture_package");
    await expect(
      running.app
        .get(IntegrationRuntime)
        .validateEmailCandidate(
          item.id,
          { ...installed, entryPath: join(dir, "index.js") },
          { id: version.versionId, generation: version.generation, environment: "default" },
          db,
        ),
    ).rejects.toThrow();
    expect(observed).toHaveBeenCalledWith(expect.any(Function));
    expect(JSON.stringify(log.mock.calls)).not.toContain("FACTORY_SECRET_SENTINEL");
    vi.restoreAllMocks();
  });
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
  it("refuses activation when the complete candidate cannot be decrypted", async () => {
    const session = await signIn();
    const item = await saveAndRead(session, "testmail");
    const saved = await session.call<DetailBody>(
      "PUT",
      `/admin/integrations/${item.id}/secrets/api_key`,
      {
        expectedRevision: (await listed(session)).revision,
        value: MAIL_KEY,
        currentPassword: PASSWORD,
      },
    );
    expect(saved.status).toBe(200);
    await db.execute(
      sql`update integration_secret set tag=decode(repeat('00',16),'hex') where version_id in (select id from integration_credential_version where integration_id=${item.id}::uuid)`,
    );
    const answer = await session.call<ProblemBody>(
      "POST",
      `/admin/integrations/${item.id}/activate`,
      { expectedRevision: saved.body.revision, currentPassword: PASSWORD },
    );
    expect(answer.status).toBe(409);
    expect(answer.body.rule).toBe("integration_unavailable");
  });
});
