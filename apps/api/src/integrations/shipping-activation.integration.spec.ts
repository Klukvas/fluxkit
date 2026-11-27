import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { startApp, type RunningApp, type StartAppOptions } from "../test/app.js";
import { createTestAdminUser } from "../test/admin-user-fixtures.js";
import { sessionCookieOf } from "../test/auth-http.js";
import { requireEnv } from "../test/env.js";
import { http } from "../test/http.js";
import { testSecretsKeyRing } from "../test/integration-provider-fixture.js";
import { ensureMigrated } from "../test/migrate.js";
import type { IntegrationResponse } from "./integrations.schemas.js";

const PASSWORD = "correct horse battery staple";
type Detail = { revision: number; integration: IntegrationResponse; rule?: string };
describe("managed shipping activation (real Postgres and Redis)", () => {
  const apps: RunningApp[] = [];
  beforeEach(async () => {
    await ensureMigrated([], { reset: true });
  });
  afterAll(async () => {
    for (const app of apps) await app.app.close();
    await ensureMigrated([], { reset: true });
  });
  async function actor(options: StartAppOptions = {}) {
    const app = await startApp({
      adminAuthenticator: "production-default",
      trustProxy: 1,
      redisUrl: requireEnv("REDIS_URL"),
      rateLimitKeyPrefix: `shipping_${randomUUID()}`,
      secretsKeyRing: testSecretsKeyRing(),
      shippingDelegated: true,
      integrationProvidersDir: fileURLToPath(
        new URL("../../../../packages/providers", import.meta.url),
      ),
      ...options,
    });
    apps.push(app);
    const db = app.app.get<Database>(DRIZZLE);
    const user = await createTestAdminUser(db, { role: "owner", password: PASSWORD });
    const signed = await http(app.baseUrl, "POST", "/admin/auth/login", {
      body: { email: user.email, password: PASSWORD },
    });
    const cookie = sessionCookieOf(signed);
    if (!cookie) throw new Error("login_failed");
    const call = <T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown) =>
      http<T>(app.baseUrl, method, path, { headers: { cookie }, body });
    const list = await call<{ revision: number; items: IntegrationResponse[] }>(
      "GET",
      "/admin/integrations",
    );
    const item = list.body.items.find((row) => row.providerCode === "nova_post");
    if (!item) throw new Error("nova_post_not_listed");
    const revision = async () =>
      (await call<{ revision: number }>("GET", "/admin/integrations")).body.revision;
    return {
      db,
      item,
      call,
      revision,
      save: async (environment = "sandbox") =>
        call<Detail>("PUT", `/admin/integrations/${item.id}/secrets/api_key`, {
          expectedRevision: await revision(),
          currentPassword: PASSWORD,
          value: "invented-nova-post-key",
          environment,
        }),
      change: async (action: string, extra: Record<string, unknown> = {}) =>
        call<Detail>("POST", `/admin/integrations/${item.id}/${action}`, {
          expectedRevision: await revision(),
          currentPassword: PASSWORD,
          ...extra,
        }),
    };
  }
  it("activates, disables, re-enables the draining pointer and revokes without provider HTTP", async () => {
    const owner = await actor();
    const saved = await owner.save();
    expect(saved.status).toBe(200);
    expect((await owner.change("activate")).status).toBe(200);
    const disabled = await owner.change("disable");
    expect(disabled.body.integration.enabled).toBe(false);
    expect(disabled.body.integration.versions.some((row) => row.state === "draining")).toBe(true);
    expect((await owner.change("activate")).body.integration.enabled).toBe(true);
    const active = saved.body.integration.versions[0];
    if (!active) throw new Error("missing_version");
    const revoked = await owner.change("revoke-secret", { versionId: active.id });
    expect(revoked.status).toBe(200);
    expect(revoked.body.integration.enabled).toBe(false);
  });
  it.each([
    { shippingDelegated: false },
    { integrationEnvironment: { NOVA_POST_API_KEY: "invented-env-key" } },
  ])("refuses activation under server enablement or key override %j", async (options) => {
    const owner = await actor(options);
    if (options.shippingDelegated === false) expect((await owner.save()).status).toBe(200);
    const result = await owner.change("activate");
    expect(result.status).toBe(409);
    expect(result.body.rule).toBe("integration_env_override");
  });
  it("locks a blank environment override to sandbox and saves a switch as a new version", async () => {
    const owner = await actor({ integrationEnvironment: { NOVA_POST_ENVIRONMENT: "" } });
    expect((await owner.save("production")).body.rule).toBe("integration_env_override");
    expect((await owner.save("sandbox")).status).toBe(200);
    const other = await actor();
    const first = await other.save("sandbox");
    const second = await other.save("production");
    const current = second.body.integration.versions.find((row) => row.state === "candidate");
    expect(current?.environment).toBe("production");
    expect(current?.id).not.toBe(first.body.integration.versions[0]?.id);
  });
  it("refuses an environment-locked candidate at activation", async () => {
    const initial = await actor();
    expect((await initial.save("production")).status).toBe(200);
    const locked = await actor({ integrationEnvironment: { NOVA_POST_ENVIRONMENT: "sandbox" } });
    const result = await locked.change("activate");
    expect(result.status).toBe(409);
    expect(result.body.rule).toBe("integration_env_override");
  });
  it("refuses a malformed managed shipping port through the shared registry validator", async () => {
    const root = await mkdtemp(join(tmpdir(), "fluxkit-shipping-factory-"));
    try {
      const folder = join(root, "nova-post");
      await mkdir(folder);
      await writeFile(
        join(folder, "package.json"),
        JSON.stringify({
          name: "fixture-shipping",
          type: "module",
          main: "index.js",
          fluxkit: {
            provider: "nova_post",
            kind: "shipping",
            secrets: [{ field: "api_key", purpose: "outbound", env: "NOVA_POST_API_KEY" }],
            environments: {
              values: ["sandbox", "production"],
              default: "sandbox",
              env: "NOVA_POST_ENVIRONMENT",
            },
          },
        }),
      );
      await writeFile(
        join(folder, "index.js"),
        `export function createOutboundClient(){return {code:"nova_post",capabilities:{pickupPoints:true,estimate:true,waybills:true,cancelWaybill:true,tracking:true,labels:true}};}`,
      );
      const owner = await actor({ integrationProvidersDir: root });
      expect((await owner.save()).status).toBe(200);
      const result = await owner.change("activate");
      expect(result.status).toBe(409);
      expect(result.body.rule).toBe("integration_unavailable");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("refuses open null-bound legacy work and never assigns it to the candidate", async () => {
    const owner = await actor();
    expect((await owner.save()).status).toBe(200);
    const order = randomUUID(),
      shipment = randomUUID();
    await owner.db
      .execute(sql`insert into sales_order(id,number,status,locale,currency,subtotal_amount,shipping_total,discount_total,tax_total,total_amount,contact_erased_at,idempotency_key,request_fingerprint,expires_at)
      values(${order}::uuid,'01D1-W0RK','paid','uk','UAH',100,0,0,0,100,now(),gen_random_uuid(),repeat('a',64),now()+interval '1 hour')`);
    await owner.db
      .execute(sql`insert into shipment(id,order_id,provider_code,status,client_reference,declared_value_amount,currency,payer,weight_grams,length_mm,width_mm,height_mm,seats)
      values(${shipment}::uuid,${order}::uuid,'nova_post','pending','01D1-W0RK',100,'UAH','sender',1,1,1,1,1)`);
    const result = await owner.change("activate");
    expect(result.status).toBe(409);
    expect(result.body.rule).toBe("integration_legacy_work_open");
    expect(
      (
        await owner.db.execute(
          sql`select integration_credential_version_id as binding from shipment where id=${shipment}::uuid`,
        )
      ).rows,
    ).toEqual([{ binding: null }]);
  });
});
