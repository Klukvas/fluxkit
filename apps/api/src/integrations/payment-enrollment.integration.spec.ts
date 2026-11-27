import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { IntegrationResponse as AdminIntegration } from "./integrations.schemas.js";
import { DRIZZLE, PG_POOL, type Database } from "../database/database.module.js";
import { createTestAdminUser } from "../test/admin-user-fixtures.js";
import { startApp, type RunningApp, type StartAppOptions } from "../test/app.js";
import { sessionCookieOf } from "../test/auth-http.js";
import { requireEnv } from "../test/env.js";
import { http, type HttpResult } from "../test/http.js";
import { testSecretsKeyRing } from "../test/integration-provider-fixture.js";
import { ensureMigrated } from "../test/migrate.js";
import { STRICT_WINDOWS, type StrictWindows } from "../rate-limit/strict-windows.js";
import { payment, salesOrder } from "../database/schema/index.js";
import { MerchantBaselineCipher } from "./merchant-baseline-cipher.js";

const PASSWORD = "correct horse battery staple";
const CODES = [
  "enrollpay",
  "failpay",
  "budgetpay",
  "stalepay",
  "pairpay",
  "envpay",
  "oldpay",
  "racepay",
  "currencypay",
  "urlpay",
  "proofpay",
  "lockpay",
  "ttlpay",
  "merchantpair",
];
type Problem = { rule?: string; detail?: string };
type List = { revision: number; items: AdminIntegration[] };
type Detail = { revision: number; integration: AdminIntegration };

function plugin(code: string, origin: string): string {
  return `
export function createOutboundClient(secrets) {
 if (["pairpay","merchantpair"].includes(${JSON.stringify(code)}) && (!secrets.public_key || !secrets.private_key)) throw new Error("incomplete");
 const unsupported=async()=>({ok:false,error:{code:"unavailable",retryable:true}});
 return {code:${JSON.stringify(code)},capabilities:{currencies:["UAH"],partialRefunds:true,multipleRefunds:true,invalidateUnpaid:true,webhooks:true,formHandoff:false},
 createPayment:unsupported,getPayment:unsupported,invalidatePayment:unsupported,refund:unsupported,verifyWebhook:unsupported,buildCheckoutHandoff:unsupported};
}
export function locateWebhook(){return null;}
let gateReady;let gateContinue;
export const beforeGate = new Promise(resolve=>{gateReady=resolve;});
export function proceed(){gateContinue();}
${
  code === "pairpay"
    ? ""
    : `export async function accountIdentity(secrets,context,signal) {
 ${code === "lockpay" ? "await new Promise(resolve=>{gateContinue=resolve;gateReady();});" : ""}
 ${code === "merchantpair" ? 'if (!secrets.public_key || !secrets.private_key) throw new Error("incomplete_identity_bundle");' : ""}
 return context.transport.start(signal,()=>({completion:fetch(${JSON.stringify(origin)}, {headers:{"x-test-token":${code === "merchantpair" ? "secrets.private_key" : "secrets.token"}},signal}).then(r=>r.json())}));
}`
}
`;
}

describe("managed payment enrollment and activation (real HTTP/Postgres/Redis)", () => {
  const keyRing = testSecretsKeyRing("enrollment-test");
  let running: RunningApp;
  let server: Server;
  let root: string;
  let db: Database;
  let address = 80;
  let calls = 0;
  const extraApps: RunningApp[] = [];
  let pause: (() => void) | undefined;
  let release: (() => void) | undefined;

  beforeAll(async () => {
    await ensureMigrated();
    server = createServer((request, response) => {
      calls += 1;
      const token = request.headers["x-test-token"];
      const reply = () => {
        const result =
          token === "invalid"
            ? { ok: false, code: "invalid_credentials" }
            : token === "offline"
              ? { ok: false, code: "unavailable" }
              : { ok: true, identity: token === "foreign" ? "merchant-B" : "merchant-A" };
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(result));
      };
      if (token === "pause") {
        release = reply;
        pause?.();
      } else reply();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = server.address();
    if (endpoint === null || typeof endpoint === "string") throw new Error("test_server_missing");
    root = await mkdtemp(join(tmpdir(), "fluxkit-payment-enrollment-"));
    for (const code of CODES) {
      const folder = join(root, code);
      await mkdir(folder);
      const fields = ["pairpay", "merchantpair"].includes(code)
        ? ["public_key", "private_key"]
        : ["token"];
      await writeFile(
        join(folder, "package.json"),
        JSON.stringify({
          type: "module",
          main: "./index.js",
          fluxkit: {
            kind: "payment",
            provider: code,
            secrets: fields.map((field) => ({
              field,
              purpose: "outbound",
              env: `${code.toUpperCase()}_${field.toUpperCase()}`,
            })),
          },
        }),
      );
      await writeFile(join(folder, "index.js"), plugin(code, `http://127.0.0.1:${endpoint.port}`));
    }
    running = await startApp({
      adminAuthenticator: "production-default",
      trustProxy: 1,
      redisUrl: requireEnv("REDIS_URL"),
      rateLimitKeyPrefix: `enrollment_${randomUUID()}`,
      secretsKeyRing: keyRing,
      integrationProvidersDir: root,
      paymentDelegated: true,
    });
    db = running.app.get<Database>(DRIZZLE);
  });
  afterAll(async () => {
    for (const extra of extraApps) await extra.app.close();
    if (running !== undefined) await running.app.close();
    if (server !== undefined)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    if (root !== undefined) await rm(root, { recursive: true, force: true });
    await ensureMigrated([], { reset: true });
  });
  async function owner(code: string, base = running) {
    address += 1;
    const user = await createTestAdminUser(db, { role: "owner", password: PASSWORD });
    const signed = await http(base.baseUrl, "POST", "/admin/auth/login", {
      headers: { "x-forwarded-for": `198.51.100.${address}` },
      body: { email: user.email, password: PASSWORD },
    });
    const cookie = sessionCookieOf(signed);
    if (cookie === undefined) throw new Error("login_failed");
    const headers = { cookie, "x-forwarded-for": `198.51.100.${address}` };
    const call = <T>(
      method: "GET" | "POST" | "PUT",
      path: string,
      body?: unknown,
    ): Promise<HttpResult<T>> =>
      http<T>(base.baseUrl, method, path, { headers, ...(body === undefined ? {} : { body }) });
    const list = await call<List>("GET", "/admin/integrations");
    expect(list.status).toBe(200);
    const item = list.body.items.find((item) => item.providerCode === code);
    if (item === undefined) throw new Error("fixture_not_listed");
    return {
      user,
      item,
      call,
      revision: async () => (await call<List>("GET", "/admin/integrations")).body.revision,
    };
  }
  type Owner = Awaited<ReturnType<typeof owner>>;
  async function save(actor: Owner, value: string, field = "token", revision?: number) {
    return actor.call<Detail & Problem>(
      "PUT",
      `/admin/integrations/${actor.item.id}/secrets/${field}`,
      { expectedRevision: revision ?? (await actor.revision()), currentPassword: PASSWORD, value },
    );
  }
  async function change(actor: Owner, action: string) {
    return actor.call<Detail & Problem>("POST", `/admin/integrations/${actor.item.id}/${action}`, {
      expectedRevision: await actor.revision(),
      currentPassword: PASSWORD,
    });
  }
  async function baselines(id: string) {
    return (
      await db.execute<{
        id: string;
        key_id: string;
        nonce: Buffer;
        ciphertext: Buffer;
        tag: Buffer;
      }>(
        sql`select id,key_id,nonce,ciphertext,tag from integration_merchant_baseline where integration_id=${id}::uuid`,
      )
    ).rows;
  }

  async function extraApp(options: StartAppOptions) {
    const base = await startApp({
      adminAuthenticator: "production-default",
      trustProxy: 1,
      redisUrl: requireEnv("REDIS_URL"),
      rateLimitKeyPrefix: `enrollment_extra_${randomUUID()}`,
      secretsKeyRing: keyRing,
      integrationProvidersDir: root,
      paymentDelegated: true,
      ...options,
    });
    extraApps.push(base);
    return base;
  }

  it("rejects invalid/unavailable credentials without saving, then enrolls first successful save", async () => {
    const actor = await owner("failpay");
    const revision = await actor.revision();
    const invalid = await save(actor, "invalid");
    expect(invalid.status).toBe(409);
    expect(invalid.body.rule).toBe("invalid_credentials");
    const failed = await save(actor, "offline");
    expect(failed.status).toBe(503);
    expect(failed.body.rule).toBe("integration_credential_check_unavailable");
    expect(await actor.revision()).toBe(revision);
    expect(await baselines(actor.item.id)).toHaveLength(0);
    const good = await save(actor, "valid");
    expect(good.status).toBe(200);
    expect(await baselines(actor.item.id)).toHaveLength(1);
    expect(JSON.stringify(good.body)).not.toContain("merchant-A");
  });

  it("locks first merchant permanently, rotates same merchant, and re-enables a disabled draining pointer", async () => {
    const actor = await owner("enrollpay");
    const first = await save(actor, "valid");
    expect(first.status).toBe(200);
    const foreign = await save(actor, "foreign");
    expect(foreign.status).toBe(409);
    expect(foreign.body.rule).toBe("integration_merchant_mismatch");
    const activation = await change(actor, "activate");
    expect(activation.status).toBe(200);
    expect(activation.body.integration.enabled).toBe(true);
    const disabled = await change(actor, "disable");
    expect(disabled.status).toBe(200);
    const resumed = await change(actor, "activate");
    expect(resumed.status).toBe(200);
    expect(resumed.body.integration.enabled).toBe(true);
    const rows = await baselines(actor.item.id);
    expect(rows).toHaveLength(1);
    const baseline = rows[0];
    if (baseline === undefined) throw new Error("baseline_missing");
    expect(
      running.app.get(MerchantBaselineCipher).open(
        {
          baselineId: baseline.id,
          integrationId: actor.item.id,
          kind: "payment",
          providerCode: "enrollpay",
          environment: "default",
        },
        {
          keyId: baseline.key_id,
          nonce: baseline.nonce,
          ciphertext: baseline.ciphertext,
          tag: baseline.tag,
        },
      ),
    ).toBe("merchant-A");
  });

  it("spends check budget before any provider call and saves nothing when limits fail closed", async () => {
    const actor = await owner("budgetpay");
    const count = calls;
    const windows = running.app.get<StrictWindows>(STRICT_WINDOWS);
    const original = windows.attempt.bind(windows);
    const spy = vi
      .spyOn(windows, "attempt")
      .mockImplementation((requests) =>
        requests.some((request) => request.name === "integrationCheckProvider")
          ? Promise.resolve({ outcome: "unavailable" })
          : original(requests),
      );
    try {
      const result = await save(actor, "valid");
      expect(result.status).toBe(503);
      expect(result.body.rule).toBe("integration_credential_check_unavailable");
    } finally {
      spy.mockRestore();
    }
    expect(calls).toBe(count);
    expect(await baselines(actor.item.id)).toHaveLength(0);
  });

  it("does not keep save locks while the merchant read is pending and rolls back stale completion", async () => {
    const actor = await owner("stalepay");
    const arrived = new Promise<void>((resolve) => {
      pause = resolve;
    });
    const pending = save(actor, "pause");
    await arrived;
    await db.execute(sql`update integration_revision set revision=revision+1 where id=1`);
    release?.();
    const result = await pending;
    expect(result.status).toBe(409);
    expect(result.body.rule).toBe("integration_revision_stale");
    expect(await baselines(actor.item.id)).toHaveLength(0);
    pause = undefined;
    release = undefined;
  });

  it("requires both fields without an identity hook, then activates two providers together", async () => {
    const actor = await owner("pairpay");
    expect((await save(actor, "public", "public_key")).status).toBe(200);
    const incomplete = await change(actor, "activate");
    expect(incomplete.status).toBe(409);
    expect(incomplete.body.rule).toBe("integration_not_activatable");
    expect((await save(actor, "private", "private_key")).status).toBe(200);
    expect((await change(actor, "activate")).status).toBe(200);
    expect(await baselines(actor.item.id)).toHaveLength(0);
    const config = await actor.call<{ onlinePayment: boolean }>("GET", "/admin/config");
    expect(config.body.onlinePayment).toBe(true);
  });
  it("refuses env-owned enablement and a partial env credential override", async () => {
    const actor = await owner("envpay");
    expect((await save(actor, "valid")).status).toBe(200);
    const before = calls;
    for (const options of [
      { paymentDelegated: false },
      { integrationEnvironment: { ENVPAY_TOKEN: "override" } },
    ]) {
      const base = await extraApp(options);
      const controlled = await owner("envpay", base);
      const result = await change(controlled, "activate");
      expect(result.status).toBe(409);
      expect(result.body.rule).toBe("integration_env_override");
    }
    expect(calls).toBe(before);
  });

  it("refuses unsupported currency and an unset public storefront URL", async () => {
    for (const [code, options, rule] of [
      ["currencypay", { shopCurrency: "EUR" }, "integration_currency_unsupported"],
      ["urlpay", { storefrontPublicUrl: null }, "integration_public_url_required"],
    ] as const) {
      const actor = await owner(code);
      expect((await save(actor, "valid")).status).toBe(200);
      const controlled = await owner(code, await extraApp(options));
      const result = await change(controlled, "activate");
      expect(result.status).toBe(409);
      expect(result.body.rule).toBe(rule);
    }
  });

  it("refuses activation while a null-bound legacy payment still needs provider work", async () => {
    const actor = await owner("oldpay");
    expect((await save(actor, "valid")).status).toBe(200);
    const orderId = randomUUID();
    await db.insert(salesOrder).values({
      id: orderId,
      number: "ABCD-1234",
      status: "awaiting_payment",
      contactErasedAt: new Date(),
      locale: "uk",
      currency: "UAH",
      subtotalAmount: 100,
      shippingTotal: 0,
      discountTotal: 0,
      taxTotal: 0,
      totalAmount: 100,
      idempotencyKey: randomUUID(),
      requestFingerprint: "0".repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(payment).values({
      orderId,
      providerCode: "oldpay",
      amount: 100,
      currency: "UAH",
      status: "creating",
      createdBy: "guest",
      idempotencyKey: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      nextCheckAt: new Date(),
    });
    const result = await change(actor, "activate");
    expect(result.status).toBe(409);
    expect(result.body.rule).toBe("integration_legacy_work_open");
  });

  it("authenticates the baseline envelope again when its old encryption key is unavailable", async () => {
    const actor = await owner("proofpay");
    expect((await save(actor, "valid")).status).toBe(200);
    const rotated = testSecretsKeyRing("enrollment-rotated");
    const rotating = await owner(
      "proofpay",
      await extraApp({ secretsKeyRing: { current: rotated.current, previous: keyRing.current } }),
    );
    expect((await save(rotating, "replacement")).status).toBe(200);
    const currentOnly = await owner("proofpay", await extraApp({ secretsKeyRing: rotated }));
    const result = await change(currentOnly, "activate");
    expect(result.status).toBe(503);
    expect(result.body.rule).toBe("integration_credential_check_unavailable");
    expect(JSON.stringify(result.body)).not.toContain("merchant-A");
  });
  it("checks revision after waiting for the integration lock before any merchant request", async () => {
    const actor = await owner("lockpay");
    const count = calls;
    const plugin = (await import(pathToFileURL(join(root, "lockpay", "index.js")).href)) as {
      beforeGate: Promise<void>;
      proceed: () => void;
    };
    const pending = save(actor, "valid");
    await plugin.beforeGate;
    const client = await running.app.get<pg.Pool>(PG_POOL).connect();
    try {
      await client.query("begin");
      await client.query("select id from integration where id=$1 for update", [actor.item.id]);
      plugin.proceed();
      const deadline = Date.now() + 3_000;
      for (;;) {
        const waiting = await db.execute<{ count: string }>(
          sql`select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and pid<>pg_backend_pid()`,
        );
        if (Number(waiting.rows[0]?.count) > 0) break;
        if (Date.now() > deadline) throw new Error("integration_lock_was_not_requested");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await client.query("update integration_revision set revision=revision+1 where id=1");
      await client.query("commit");
      const result = await pending;
      expect(result.status).toBe(409);
      expect(result.body.rule).toBe("integration_revision_stale");
      expect(calls).toBe(count);
      expect(await baselines(actor.item.id)).toHaveLength(0);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
  it("refuses a five-minute payment window and accepts the supported eight-minute minimum", async () => {
    const actor = await owner("ttlpay");
    expect((await save(actor, "valid")).status).toBe(200);
    const tooShort = await owner("ttlpay", await extraApp({ orderPaymentTtlMinutes: 5 }));
    const refused = await change(tooShort, "activate");
    expect(refused.status).toBe(409);
    expect(refused.body.rule).toBe("integration_payment_window_too_short");
    const minimum = await owner("ttlpay", await extraApp({ orderPaymentTtlMinutes: 8 }));
    expect((await change(minimum, "activate")).status).toBe(200);
  });
  it("saves an incomplete identity bundle without probing and retains it after a failed complete check", async () => {
    const actor = await owner("merchantpair");
    const before = calls;
    const partial = await save(actor, "public", "public_key");
    expect(partial.status).toBe(200);
    expect(calls).toBe(before);
    expect(await baselines(actor.item.id)).toHaveLength(0);
    const partialVersion = partial.body.integration.versions.find(
      (version) => version.state === "candidate",
    );
    expect(partialVersion?.fields).toEqual(["public_key"]);
    const revision = await actor.revision();
    const incomplete = await change(actor, "activate");
    expect(incomplete.status).toBe(409);
    expect(incomplete.body.rule).toBe("integration_not_activatable");
    const failed = await save(actor, "invalid", "private_key");
    expect(failed.status).toBe(409);
    expect(failed.body.rule).toBe("invalid_credentials");
    expect(calls).toBe(before + 1);
    expect(await baselines(actor.item.id)).toHaveLength(0);
    expect(await actor.revision()).toBe(revision);
    const retained = await actor.call<Detail>("GET", `/admin/integrations/${actor.item.id}`);
    expect(
      retained.body.integration.versions.find((version) => version.state === "candidate"),
    ).toEqual(partialVersion);
    const complete = await save(actor, "valid", "private_key");
    expect(complete.status).toBe(200);
    expect(calls).toBe(before + 2);
    expect(await baselines(actor.item.id)).toHaveLength(1);
    const activated = await change(actor, "activate");
    expect(activated.status).toBe(200);
    expect(activated.body.integration.enabled).toBe(true);
  });
});
