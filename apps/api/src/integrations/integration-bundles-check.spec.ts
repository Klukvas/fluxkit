import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { PG_POOL, DRIZZLE, type Database } from "../database/database.module.js";
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
import type {
  IntegrationDetailResponse,
  IntegrationListResponse,
  IntegrationCheckResponse,
} from "./integrations.schemas.js";
import { AdminAuditWriter } from "../privacy/audit/admin-audit.writer.js";
import { InstalledIntegrations } from "./installed-integrations.js";
import { AdminStepUpService } from "../auth/step-up/admin-step-up.service.js";
import { SecretCipher } from "./secret-cipher.js";
import { IntegrationsRepository } from "./integrations.repository.js";
import { testEmailProviders } from "../test/test-email-provider.js";
import { IntegrationAlerts } from "./integration-alerts.service.js";
import { EmailOutbox } from "../email/outbox/email-outbox.service.js";
import { Logger } from "@nestjs/common";
import { STRICT_WINDOWS, type StrictWindows } from "../rate-limit/strict-windows.js";

const PASSWORD = "correct horse battery staple";
const PUBLIC = "PUBLICsentinel0123456789";
const PRIVATE = "PRIVATEsentinel0123456789";
const PROVIDER = `
let calls=0; let outcome={code:"ok"}; let beforeCheck=async()=>{};
export function setBeforeCheck(value){beforeCheck=value;}
export function count(){return calls;}
export function setOutcome(value){outcome=value;}
export async function checkCredentials(secrets, context, signal){
  await beforeCheck();
  if (secrets.public_key === undefined || secrets.private_key === undefined) throw new Error("incomplete");
  return context.transport.start(signal,()=>{calls+=1;return {completion:outcome.hang ? new Promise(resolve=>signal.addEventListener("abort",()=>resolve({code:"unavailable"}),{once:true})) : Promise.resolve(outcome)};});
}
`;

describe("candidate bundles and explicit checks (real Postgres/Redis)", () => {
  let running: RunningApp;
  let db: Database;
  let fixture: IntegrationProviderFixture;
  let plugin: {
    count(): number;
    setOutcome(value: unknown): void;
    setBeforeCheck(value: () => Promise<void>): void;
  };
  const environment: Record<string, string | undefined> = {};
  const users: string[] = [];
  let address = 0;
  beforeAll(async () => {
    await ensureMigrated();
    fixture = await createIntegrationProviderFixture();
    await mkdir(join(fixture.dir, "bundle"));
    await writeFile(
      join(fixture.dir, "bundle", "package.json"),
      JSON.stringify({
        name: "fixture-bundle",
        type: "module",
        main: "./index.js",
        fluxkit: {
          kind: "payment",
          provider: "bundle",
          secrets: [
            { field: "public_key", purpose: "outbound", env: "BUNDLE_PUBLIC_KEY" },
            { field: "private_key", purpose: "outbound", env: "BUNDLE_PRIVATE_KEY" },
          ],
          environments: {
            values: ["default", "sandbox"],
            default: "default",
            env: "BUNDLE_ENVIRONMENT",
          },
        },
      }),
    );
    await writeFile(join(fixture.dir, "bundle", "index.js"), PROVIDER);
    await mkdir(join(fixture.dir, "shipbundle"));
    await writeFile(
      join(fixture.dir, "shipbundle", "package.json"),
      JSON.stringify({
        name: "fixture-shipbundle",
        type: "module",
        main: "./index.js",
        fluxkit: {
          kind: "shipping",
          provider: "shipbundle",
          secrets: [
            { field: "public_key", purpose: "outbound", env: "SHIPBUNDLE_PUBLIC_KEY" },
            { field: "private_key", purpose: "outbound", env: "SHIPBUNDLE_PRIVATE_KEY" },
          ],
        },
      }),
    );
    await writeFile(join(fixture.dir, "shipbundle", "index.js"), PROVIDER);

    plugin = (await import(
      pathToFileURL(join(fixture.dir, "bundle", "index.js")).href
    )) as typeof plugin;
    running = await startApp({
      adminAuthenticator: "production-default",
      redisUrl: requireEnv("REDIS_URL"),
      rateLimitKeyPrefix: `bundle_${randomUUID()}`,
      trustProxy: 1,
      secretsKeyRing: testSecretsKeyRing(),
      integrationProvidersDir: fixture.dir,
      integrationEnvironment: environment,
      extraEmailProviders: testEmailProviders(),
      defaultLocale: "en",
    });
    db = running.app.get<Database>(DRIZZLE);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    delete environment.BUNDLE_ENVIRONMENT;
    plugin.setBeforeCheck(async () => undefined);
    plugin.setOutcome({ code: "ok" });
    await db.execute(sql`update integration set enabled=false,active_outbound_version_id=null`);
    await db.execute(sql`update email_message set integration_credential_version_id=null`);
    await db.execute(sql`delete from integration_secret`);
    await db.execute(sql`delete from integration_credential_version`);
    await db.execute(
      sql`delete from email_message where template_key='integration.security_alert'`,
    );
    await deleteTestAdminUsers(db, users.splice(0));
  });
  afterAll(async () => {
    await running?.app.close();
    await fixture?.remove();
  });
  async function session(role: "owner" | "manager" | "viewer" = "owner") {
    const user = await createTestAdminUser(db, { role, password: PASSWORD });
    users.push(user.id);
    address += 1;
    const headers = { "x-forwarded-for": `192.0.2.${String(address)}` };
    const signed = await http(running.baseUrl, "POST", "/admin/auth/login", {
      headers,
      body: { email: user.email, password: PASSWORD },
    });
    const cookie = sessionCookieOf(signed);
    if (cookie === undefined) throw new Error("login_failed");
    const call = <T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown) =>
      http<T>(running.baseUrl, method, path, {
        headers: { ...headers, cookie },
        ...(body === undefined ? {} : { body }),
      });
    return { user, call, cookie };
  }
  type Session = Awaited<ReturnType<typeof session>>;
  async function list(owner: Session) {
    const res = await owner.call<IntegrationListResponse>("GET", "/admin/integrations");
    expect(res.status).toBe(200);
    return res.body;
  }
  async function saved(
    owner: Session,
    field = "public_key",
    value = PUBLIC,
    environment?: string,
    code = "bundle",
  ) {
    const before = await list(owner);
    const item = before.items.find((v) => v.providerCode === code);
    if (item === undefined) throw new Error("bundle_missing");
    return owner.call<IntegrationDetailResponse & { rule?: string }>(
      "PUT",
      `/admin/integrations/${item.id}/secrets/${field}`,
      {
        expectedRevision: before.revision,
        currentPassword: PASSWORD,
        value,
        ...(environment === undefined ? {} : { environment }),
      },
    );
  }
  async function complete(owner: Session) {
    expect((await saved(owner)).status).toBe(200);
    const res = await saved(owner, "private_key", PRIVATE);
    expect(res.status).toBe(200);
    return res.body;
  }
  async function check(
    owner: Session,
    detail: IntegrationDetailResponse,
    versionId = detail.integration.versions[0]?.id,
  ) {
    return owner.call<IntegrationCheckResponse & { rule?: string }>(
      "POST",
      `/admin/integrations/${detail.integration.id}/check`,
      { expectedRevision: detail.revision, versionId },
    );
  }
  it("commits check_requested before the hook and records check_completed afterwards", async () => {
    const owner = await session();
    const detail = await complete(owner);
    let observed = false;
    plugin.setBeforeCheck(async () => {
      const audit = await db.execute<{ action: string; detail: unknown }>(
        sql`select action,detail from admin_audit_event where target_id=${detail.integration.id}::uuid and admin_user_id=${owner.user.id}::uuid and action in ('integration.check_requested','integration.check_completed')`,
      );
      expect(audit.rows).toEqual([
        {
          action: "integration.check_requested",
          detail: {
            kind: "payment",
            provider: "bundle",
            version: detail.integration.versions[0]?.id,
          },
        },
      ]);
      observed = true;
    });
    expect((await check(owner, detail)).status).toBe(200);
    expect(observed).toBe(true);
    expect(
      (
        await db.execute(
          sql`select id from admin_audit_event where target_id=${detail.integration.id}::uuid and action='integration.check_completed'`,
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("refuses a check before decryption and network when requested audit cannot commit", async () => {
    const owner = await session();
    const detail = await complete(owner);
    const open = vi.spyOn(running.app.get(SecretCipher), "open");
    const count = plugin.count();
    vi.spyOn(running.app.get(AdminAuditWriter), "record").mockRejectedValue(new Error(PRIVATE));
    const answer = await check(owner, detail);
    expect(answer.status).toBe(503);
    expect(answer.body.rule).toBe("check_unavailable");
    expect(open).not.toHaveBeenCalled();
    expect(plugin.count()).toBe(count);
  });
  it("logs only the check failure code and error class", async () => {
    const owner = await session();
    const detail = await complete(owner);
    plugin.setBeforeCheck(async () => {
      throw new TypeError(PRIVATE, { cause: new Error(PRIVATE) });
    });
    const log = vi.spyOn(Logger.prototype, "error");
    expect((await check(owner, detail)).body.code).toBe("unavailable");
    expect(log).toHaveBeenCalledWith("integration_check_failed TypeError");
    expect(JSON.stringify(log.mock.calls)).not.toContain(PRIVATE);
  });
  it("enforces the shipping thirty-check ten-minute per-admin budget in real Redis", async () => {
    const owner = await session();
    expect((await saved(owner, "public_key", PUBLIC, undefined, "shipbundle")).status).toBe(200);
    const detail = (await saved(owner, "private_key", PRIVATE, undefined, "shipbundle")).body;
    const windows = running.app.get<StrictWindows>(STRICT_WINDOWS);
    const shippingWindow = {
      name: "integrationCheckShippingAdmin",
      key: `admin-user:${owner.user.id}`,
      limit: { maxAttempts: 30, windowMinutes: 10 },
    };
    for (let attempt = 0; attempt < 30; attempt += 1)
      expect(await windows.attempt([shippingWindow])).toEqual({ outcome: "allowed" });
    const open = vi.spyOn(running.app.get(SecretCipher), "open");
    const answer = await check(owner, detail);
    expect(answer.status).toBe(429);
    expect(open).not.toHaveBeenCalled();
  });
  it.each(["", "sandbox"])(
    "locks the environment when its variable is present (%j)",
    async (value) => {
      const owner = await session();
      const detail = await complete(owner);
      environment.BUNDLE_ENVIRONMENT = value;
      const locked = value === "" ? "default" : value;
      const other = locked === "default" ? "sandbox" : "default";
      const open = vi.spyOn(running.app.get(SecretCipher), "open");
      const stepUp = vi.spyOn(running.app.get(AdminStepUpService), "verify");
      const refused = await saved(owner, "public_key", PUBLIC, other);
      expect(refused.status).toBe(409);
      expect(refused.body.rule).toBe("integration_env_override");
      expect(stepUp).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      const read = await list(owner);
      expect(read.items.find((item) => item.id === detail.integration.id)).toMatchObject({
        environmentSource: "env",
        environment: locked,
      });
      if (locked === "sandbox") {
        expect((await saved(owner)).body.rule).toBe("integration_env_override");
        expect((await check(owner, detail)).body.rule).toBe("integration_env_override");
        expect(open).not.toHaveBeenCalled();
        expect(stepUp).not.toHaveBeenCalled();
      }
      const accepted = await saved(owner, "public_key", PUBLIC, locked);
      expect(accepted.status).toBe(200);
      expect(accepted.body.integration.versions[0]?.environment).toBe(locked);
    },
  );
  it("makes a plugin with an invalid environment override unavailable", async () => {
    const installed = new InstalledIntegrations({
      keyRing: testSecretsKeyRing(),
      providersDir: fixture.dir,
      isProduction: false,
      environment: { BUNDLE_ENVIRONMENT: "invalid" },
      emailRouteDelegated: false,
      emailFromAddress: null,
      paymentDelegated: false,
      shippingDelegated: false,
      shopCurrency: "UAH",
      orderPaymentTtlMinutes: 30,
      storefrontPublicUrl: null,
    });
    expect(await installed.find("payment", "bundle")).toBeUndefined();
  });
  it("bundles both fields in a new generation and reseals the retained field", async () => {
    const owner = await session();
    const first = await saved(owner);
    expect(first.status).toBe(200);
    const oldId = first.body.integration.secrets.find((v) => v.field === "public_key")?.versionId;
    if (oldId === null || oldId === undefined) throw new Error("missing_candidate");
    const repo = running.app.get(IntegrationsRepository);
    const old = await repo.secretEnvelopes(oldId);
    const second = await saved(owner, "private_key", PRIVATE);
    expect(second.status).toBe(200);
    const ids = second.body.integration.secrets.map((v) => v.versionId);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).not.toBe(oldId);
    const nextId = ids[0];
    if (nextId === undefined || nextId === null) throw new Error("missing_bundle");
    const next = await repo.secretEnvelopes(nextId);
    expect(next).toHaveLength(2);
    const retained = next.find((v) => v.field === "public_key");
    expect(retained?.id).not.toBe(old[0]?.id);
    expect(retained?.nonce.equals(old[0]?.nonce ?? Buffer.alloc(0))).toBe(false);
    const generation = second.body.integration.secrets[0]?.generation;
    if (generation === null || generation === undefined || retained === undefined)
      throw new Error("missing_generation");
    expect(
      running.app.get(SecretCipher).open(
        {
          secretId: retained.id,
          integrationId: second.body.integration.id,
          kind: "payment",
          providerCode: "bundle",
          field: "public_key",
          generation,
        },
        retained,
      ),
    ).toBe(PUBLIC);
    expect((await repo.findVersion(oldId))?.state).toBe("retired");
    expect(second.body.integration.versions[0]?.fields).toEqual(["private_key", "public_key"]);
    expect(JSON.stringify(second.body)).not.toContain(PUBLIC);
    expect(JSON.stringify(second.body)).not.toContain(PRIVATE);
  });
  it("does not carry fields into a different environment", async () => {
    const owner = await session();
    await complete(owner);
    const switched = await saved(owner, "public_key", "newPublic", "sandbox");
    expect(switched.status).toBe(200);
    expect(switched.body.integration.versions[0]).toMatchObject({
      environment: "sandbox",
      fields: ["public_key"],
    });
    expect((await check(owner, switched.body)).status).toBe(409);
  });
  it("checks only complete authorised versions, without a password, and audits codes", async () => {
    const owner = await session();
    const incomplete = await saved(owner);
    expect(incomplete.status).toBe(200);
    const count = plugin.count();
    expect((await check(owner, incomplete.body)).status).toBe(409);
    expect(plugin.count()).toBe(count);
    const detail = (await saved(owner, "private_key", PRIVATE)).body;
    const checked = await check(owner, detail);
    expect(checked.status).toBe(200);
    expect(checked.body).toMatchObject({
      versionId: detail.integration.versions[0]?.id,
      code: "ok",
    });
    expect(plugin.count()).toBe(count + 1);
    const audit = await db.execute<{ detail: unknown }>(
      sql`select detail from admin_audit_event where action='integration.check_completed' and target_id=${detail.integration.id}::uuid and admin_user_id=${owner.user.id}::uuid`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.detail).toMatchObject({
      kind: "payment",
      provider: "bundle",
      code: "ok",
    });
    const other = await session("manager");
    expect((await check(other, detail)).status).toBe(403);
    const viewer = await session("viewer");
    expect((await check(viewer, detail)).status).toBe(403);
  });
  it("clones the complete active bundle when a replacement field is saved", async () => {
    const owner = await session();
    const detail = await complete(owner);
    const version = detail.integration.versions[0];
    if (version === undefined) throw new Error("missing_version");
    await db.execute(
      sql`update integration_credential_version set state='active' where id=${version.id}::uuid`,
    );
    await db.execute(
      sql`update integration set active_outbound_version_id=${version.id}::uuid,enabled=true where id=${detail.integration.id}::uuid`,
    );
    const replacement = await saved(owner, "public_key", "anotherPublic");
    expect(replacement.status).toBe(200);
    expect(replacement.body.integration.versions[0]?.fields).toEqual(["private_key", "public_key"]);
    expect(replacement.body.integration.versions[1]?.state).toBe("active");
  });
  it("rolls back the bundle and revision if a retained envelope is unreadable", async () => {
    const owner = await session();
    const detail = await complete(owner);
    const version = detail.integration.versions[0];
    if (version === undefined) throw new Error("missing_version");
    await db.execute(
      sql`update integration_secret set tag=decode(repeat('00',16),'hex') where version_id=${version.id}::uuid and field='private_key'`,
    );
    const refused = await saved(owner, "public_key", "replacement");
    expect(refused.status).toBe(500);
    const after = await list(owner);
    expect(after.revision).toBe(detail.revision);
    expect(after.items.find((v) => v.id === detail.integration.id)?.versions[0]?.id).toBe(
      version.id,
    );
  });
  it("returns only allowlisted outcomes and bounded retry seconds", async () => {
    const owner = await session();
    const detail = await complete(owner);
    plugin.setOutcome({ code: "rate_limited", retryAfterSeconds: 20, providerText: PRIVATE });
    const rate = await check(owner, detail);
    expect(rate.status).toBe(200);
    expect(rate.body.code).toBe("rate_limited");
    expect(rate.body.retryAfterSeconds).toBe(20);
    expect(JSON.stringify(rate.body)).not.toContain(PRIVATE);
    plugin.setOutcome({ code: PRIVATE, retryAfterSeconds: 86401 });
    const hostile = await check(owner, detail);
    expect(hostile.body.code).toBe("unavailable");
    expect(JSON.stringify(hostile.body)).not.toContain(PRIVATE);
  });
  it("fails closed before decryption or network when strict windows are unavailable", async () => {
    const owner = await session();
    const detail = await complete(owner);
    const count = plugin.count();
    const open = vi.spyOn(running.app.get(SecretCipher), "open");
    const limits = vi
      .spyOn(running.app.get<StrictWindows>(STRICT_WINDOWS), "attempt")
      .mockResolvedValue({ outcome: "unavailable" });
    const refused = await check(owner, detail);
    expect(refused.status).toBe(503);
    expect(refused.body.rule).toBe("check_unavailable");
    expect(open).not.toHaveBeenCalled();
    expect(plugin.count()).toBe(count);
    expect(limits).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: "integrationCheckAdmin",
          limit: { maxAttempts: 10, windowMinutes: 1 },
        }),
        expect.objectContaining({
          name: "integrationCheckAddress",
          limit: { maxAttempts: 30, windowMinutes: 1 },
        }),
        expect.objectContaining({
          name: "integrationCheckProvider",
          limit: { maxAttempts: 30, windowMinutes: 1 },
        }),
      ]),
    );
  });
  it("refuses revoked, foreign and stale versions without calling the provider", async () => {
    const owner = await session();
    const detail = await complete(owner);
    const count = plugin.count();
    const id = detail.integration.versions[0]?.id;
    if (id === undefined) throw new Error("missing_version");
    const foreign = await check(owner, detail, randomUUID());
    expect(foreign.status).toBe(404);
    const stale = await check(owner, { ...detail, revision: detail.revision - 1 });
    expect(stale.status).toBe(409);
    await db.execute(
      sql`update integration_credential_version set state='revoked',revoked_at=now() where id=${id}::uuid`,
    );
    expect((await check(owner, detail)).status).toBe(409);
    expect(plugin.count()).toBe(count);
  });
  it("has no online check when the package does not export the hook", async () => {
    const owner = await session();
    const before = await list(owner);
    const item = before.items.find((v) => v.providerCode === "testpay");
    if (item === undefined) throw new Error("fixture");
    const save = await owner.call<IntegrationDetailResponse>(
      "PUT",
      `/admin/integrations/${item.id}/secrets/token`,
      { expectedRevision: before.revision, value: "token", currentPassword: PASSWORD },
    );
    expect(save.status).toBe(200);
    const count = plugin.count();
    const result = await check(owner, save.body);
    expect(result.body.code).toBe("not_supported");
    expect(plugin.count()).toBe(count);
  });
  it("enqueues one code-only alert per active owner after commit with per-owner dedupe", async () => {
    const owner = await session();
    const other = await session();
    const manager = await session("manager");
    const inactive = await session();
    await db.execute(sql`update admin_user set is_active=false where id=${inactive.user.id}::uuid`);
    const result = await saved(owner);
    expect(result.status).toBe(200);
    const emails = await db.execute<{
      admin_user_id: string;
      variables: unknown;
      dedupe_key: string;
      locale: string;
      recipient_kind: string;
    }>(
      sql`select admin_user_id,variables,dedupe_key,locale,recipient_kind from email_message where template_key='integration.security_alert'`,
    );
    expect(emails.rows.map((v) => v.admin_user_id).sort()).toEqual(
      [owner.user.id, other.user.id].sort(),
    );
    expect(emails.rows.map((v) => v.admin_user_id)).not.toContain(manager.user.id);
    expect(new Set(emails.rows.map((v) => v.dedupe_key)).size).toBe(2);
    for (const email of emails.rows) {
      expect(email.locale).toBe("en");
      expect(email.recipient_kind).toBe("admin");
      expect(email.variables).toEqual({
        action: "integration.secret_changed",
        kind: "payment",
        providerCode: "bundle",
        generation: 1,
        occurredAt: expect.any(String),
      });
    }
    const audit = await db.execute<{ id: string; created_at: Date }>(
      sql`select id,created_at from admin_audit_event where action='integration.secret_changed' and target_id=${result.body.integration.id}::uuid and admin_user_id=${owner.user.id}::uuid order by created_at desc limit 1`,
    );
    const event = audit.rows[0];
    if (event === undefined) throw new Error("missing_audit");
    await running.app.get(IntegrationAlerts).notify({
      auditEventId: event.id,
      action: "integration.secret_changed",
      kind: "payment",
      providerCode: "bundle",
      generation: 1,
      occurredAt: new Date(event.created_at),
    });
    expect(
      (
        await db.execute(
          sql`select id from email_message where template_key='integration.security_alert'`,
        )
      ).rows,
    ).toHaveLength(2);
  });
  it("keeps a committed mutation successful when alert enqueue fails and logs only a code", async () => {
    const owner = await session();
    const log = vi.spyOn(Logger.prototype, "error");
    vi.spyOn(running.app.get(EmailOutbox), "enqueue").mockRejectedValue(new Error(PRIVATE));
    const result = await saved(owner);
    expect(result.status).toBe(200);
    expect(result.body.integration.versions).toHaveLength(1);
    expect(log).toHaveBeenCalledWith("integration_alert_failed");
    expect(JSON.stringify(log.mock.calls)).not.toContain(PRIVATE);
  });
  it("enforces the per-admin ten-check budget in Redis", async () => {
    const owner = await session();
    const detail = await complete(owner);
    const answers = await Promise.all(Array.from({ length: 11 }, () => check(owner, detail)));
    expect(answers.filter((answer) => answer.status === 200)).toHaveLength(10);
    expect(answers.filter((answer) => answer.status === 429)).toHaveLength(1);
  });
  it("does not lose deliverable alerts when one owner has an undeliverable address", async () => {
    const owner = await session();
    const other = await session();
    const undeliverable = await session();
    await db.execute(
      sql`update admin_user set email='власник@example.com' where id=${undeliverable.user.id}::uuid`,
    );
    const savedResult = await saved(owner);
    expect(savedResult.status).toBe(200);
    const messages = await db.execute<{ admin_user_id: string }>(
      sql`select admin_user_id from email_message where template_key='integration.security_alert'`,
    );
    expect(messages.rows.map((row) => row.admin_user_id).sort()).toEqual(
      [owner.user.id, other.user.id].sort(),
    );
  });

  it("aborts an unresponsive check after ten seconds", async () => {
    const owner = await session();
    const detail = await complete(owner);
    plugin.setOutcome({ hang: true });
    const started = Date.now();
    const answer = await check(owner, detail);
    expect(answer.status).toBe(200);
    expect(answer.body.code).toBe("unavailable");
    expect(Date.now() - started).toBeGreaterThanOrEqual(9900);
  });
  it("lists at most twenty most recent non-retired versions", async () => {
    const owner = await session();
    const before = await list(owner);
    const item = before.items.find((row) => row.providerCode === "bundle");
    if (item === undefined) throw new Error("fixture");
    for (let generation = 1; generation <= 24; generation += 1) {
      await db.execute(
        sql`insert into integration_credential_version(id,integration_id,generation,purpose,state,revoked_at) values(${randomUUID()}::uuid,${item.id}::uuid,${generation},'outbound','revoked',now())`,
      );
    }
    const result = await owner.call<IntegrationDetailResponse>(
      "GET",
      `/admin/integrations/${item.id}`,
    );
    expect(result.status).toBe(200);
    expect(result.body.integration.versions).toHaveLength(20);
    expect(result.body.integration.versions[0]?.generation).toBe(24);
    expect(result.body.integration.versions[19]?.generation).toBe(5);
    expect((await list(owner)).items.find((row) => row.id === item.id)?.versions).toEqual(
      result.body.integration.versions,
    );
  });
  it("retirement waits on integration before locking the version needed by a final gate", async () => {
    const owner = await session();
    const detail = await complete(owner);
    const versionId = detail.integration.versions[0]?.id;
    if (versionId === undefined) throw new Error("missing_version");
    const pool = running.app.get<pg.Pool>(PG_POOL);
    const gate = await pool.connect();
    let retiring: ReturnType<typeof owner.call> | undefined;
    try {
      await gate.query("begin");
      const { rows } = await gate.query<{ pid: number }>("select pg_backend_pid() as pid");
      const pid = rows[0]?.pid;
      await gate.query("select id from integration where id=$1 for share", [detail.integration.id]);
      retiring = owner.call("POST", `/admin/integrations/${detail.integration.id}/retire-secret`, {
        expectedRevision: detail.revision,
        versionId,
        currentPassword: PASSWORD,
      });
      const deadline = Date.now() + 3000;
      let blocked = false;
      while (!blocked && Date.now() < deadline) {
        const waiting = await pool.query<{ blocked: boolean }>(
          "select exists(select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid))) as blocked",
          [pid],
        );
        blocked = waiting.rows[0]?.blocked === true;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      // A version-first retire would hold this lock while waiting for our integration lock: a deadlock cycle.
      await gate.query(
        "select id from integration_credential_version where id=$1 for share nowait",
        [versionId],
      );
    } finally {
      await gate.query("rollback");
      gate.release();
      if (retiring !== undefined) expect((await retiring).status).toBe(200);
    }
  });
});
