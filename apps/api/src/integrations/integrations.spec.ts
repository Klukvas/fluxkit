import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PasswordHasher } from "../auth/password-hasher.js";
import { AdminStepUpService } from "../auth/step-up/admin-step-up.service.js";
import { withTransaction } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { createTestAdminUser, deleteTestAdminUsers } from "../test/admin-user-fixtures.js";
import { startApp, type RunningApp } from "../test/app.js";
import { loginCookie, sessionCookieOf } from "../test/auth-http.js";
import { requireEnv } from "../test/env.js";
import { http, type HttpResult } from "../test/http.js";
import {
  createIntegrationProviderFixture,
  testSecretsKeyRing,
  type IntegrationProviderFixture,
} from "../test/integration-provider-fixture.js";
import { ensureMigrated } from "../test/migrate.js";
import type { AdminPrincipal } from "../auth/admin-authenticator.js";
import { SecretCipher, SecretUnavailableError, type SealedSecret } from "./secret-cipher.js";

const PASSWORD = "correct horse battery staple";
const SENTINEL = "SENTINELkey0123456789";
const MAIL_KEY = `tm_${SENTINEL}`;

interface SecretView {
  field: string;
  purpose: string;
  envVariable: string;
  state: string;
  last4: null;
  versionId: string | null;
  generation: number | null;
  savedAt: string | null;
  keyAvailable: boolean | null;
  versionState: "candidate" | "active" | "draining" | "revoked" | null;
}
interface IntegrationView {
  id: string;
  kind: string;
  providerCode: string;
  secrets: SecretView[];
  updatedAt: string;
}
interface ListBody {
  revision: number;
  storage: string;
  items: IntegrationView[];
}
interface DetailBody {
  revision: number;
  storage: string;
  integration: IntegrationView;
}
interface ProblemBody {
  code: string;
  rule?: string;
  detail?: string;
  errors?: { path: string; code: string; message?: string }[];
}
interface StoredRow extends Record<string, unknown> {
  secret_id: string;
  version_id: string;
  integration_id: string;
  field: string;
  key_id: string;
  nonce: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
  generation: number;
  state: string;
}

describe("admin integrations (real Postgres and Redis, session sign-in)", () => {
  const keyRing = testSecretsKeyRing("spec-key-1");
  const prefix = `integrations_${randomUUID()}`;
  let fixture: IntegrationProviderFixture;
  let running: RunningApp;
  let db: Database;
  const userIds: string[] = [];
  let addressCounter = 0;

  /** A fresh client address per test: the per-address step-up window is shared by the whole file otherwise. */
  const nextAddress = (): string => {
    addressCounter += 1;
    return `198.51.100.${addressCounter}`;
  };

  async function signIn(role: "owner" | "manager" | "viewer" = "owner", base = running) {
    const user = await createTestAdminUser(db, { role, password: PASSWORD });
    userIds.push(user.id);
    const address = nextAddress();
    // Signed in from the test's own address as well: the login window of one address would fill up otherwise.
    const signedIn = await http(base.baseUrl, "POST", "/admin/auth/login", {
      headers: { "x-forwarded-for": address },
      body: { email: user.email, password: PASSWORD },
    });
    const cookie = sessionCookieOf(signedIn);
    if (signedIn.status !== 200 || cookie === undefined) {
      throw new Error(`Test setup bug: login answered ${String(signedIn.status)}`);
    }
    const call = <T>(
      method: "GET" | "POST" | "PUT",
      path: string,
      body?: unknown,
    ): Promise<HttpResult<T>> =>
      http<T>(base.baseUrl, method, path, {
        headers: { cookie, "x-forwarded-for": address },
        ...(body === undefined ? {} : { body }),
      });
    return { user, cookie, call };
  }

  type Session = Awaited<ReturnType<typeof signIn>>;

  async function listOf(session: Session): Promise<ListBody> {
    const result = await session.call<ListBody>("GET", "/admin/integrations");
    expect(result.status).toBe(200);
    return result.body;
  }
  async function integrationOf(session: Session, code: string): Promise<IntegrationView> {
    const found = (await listOf(session)).items.find((item) => item.providerCode === code);
    if (found === undefined) throw new Error(`fixture: ${code} is not listed`);
    return found;
  }
  const secretOf = (integration: IntegrationView, field: string): SecretView => {
    const found = integration.secrets.find((secret) => secret.field === field);
    if (found === undefined) throw new Error(`fixture: ${field} is not declared`);
    return found;
  };
  async function put(
    session: Session,
    integration: IntegrationView,
    field: string,
    value: string,
    overrides: Record<string, unknown> = {},
  ): Promise<HttpResult<DetailBody & ProblemBody>> {
    const { revision } = await listOf(session);
    return session.call("PUT", `/admin/integrations/${integration.id}/secrets/${field}`, {
      expectedRevision: revision,
      value,
      currentPassword: PASSWORD,
      ...overrides,
    });
  }
  async function stored(integrationId: string): Promise<StoredRow[]> {
    const result = await db.execute<StoredRow>(sql`
      select s.id as secret_id, v.id as version_id, v.integration_id, s.field, s.key_id, s.nonce, s.ciphertext,
             s.tag, v.generation, v.state
      from integration_secret s join integration_credential_version v on v.id = s.version_id
      where v.integration_id = ${integrationId}::uuid order by v.generation`);
    return result.rows;
  }
  const sealedOf = (row: StoredRow): SealedSecret => ({
    keyId: row.key_id,
    nonce: row.nonce,
    ciphertext: row.ciphertext,
    tag: row.tag,
  });
  /** The audit log is append-only and outlives a test, so a test reads only what its own admin did. */
  async function auditOf(
    action: string,
    targetId: string,
    actorId: string,
  ): Promise<Record<string, unknown>[]> {
    const result = await db.execute<{ detail: Record<string, unknown> }>(sql`
      select detail from admin_audit_event
      where action = ${action} and target_id = ${targetId}::uuid and admin_user_id = ${actorId}::uuid
      order by created_at`);
    return result.rows.map((row) => row.detail);
  }
  async function wipeStore(): Promise<void> {
    await db.execute(sql`delete from integration_secret`);
    await db.execute(sql`delete from integration_credential_version`);
  }

  beforeAll(async () => {
    await ensureMigrated();
    fixture = await createIntegrationProviderFixture();
    running = await startApp({
      adminAuthenticator: "production-default",
      redisUrl: requireEnv("REDIS_URL"),
      rateLimitKeyPrefix: prefix,
      trustProxy: 1,
      secretsKeyRing: keyRing,
      integrationProvidersDir: fixture.dir,
      integrationEnvironment: { TESTMAIL_WEBHOOK_SECRET: "set-on-the-server", TESTPAY_TOKEN: " " },
    });
    db = running.app.get<Database>(DRIZZLE);
    await wipeStore();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await wipeStore();
    await deleteTestAdminUsers(db, userIds.splice(0));
  });
  afterAll(async () => {
    await running.app.close();
    await fixture.remove();
  });

  describe("reading", () => {
    it("lists the installed providers with the state of each secret and nothing of a value", async () => {
      const owner = await signIn();
      const list = await listOf(owner);
      expect(list.storage).toBe("ready");
      expect(Number.isSafeInteger(list.revision)).toBe(true);
      expect(list.items.map((item) => `${item.kind}/${item.providerCode}`)).toEqual([
        "email/asyncmail",
        "email/brokenmail",
        "email/fake",
        "email/testmail",
        "payment/testpay",
      ]);
      const testmail = await integrationOf(owner, "testmail");
      expect(secretOf(testmail, "api_key")).toEqual({
        field: "api_key",
        purpose: "outbound",
        envVariable: "TESTMAIL_API_KEY",
        state: "not_set",
        last4: null,
        versionId: null,
        generation: null,
        savedAt: null,
        keyAvailable: null,
        versionState: null,
      });
      expect(secretOf(testmail, "webhook_secret").state).toBe("env");
      // A blank variable is no override.
      expect(secretOf(await integrationOf(owner, "testpay"), "token").state).toBe("not_set");
      // The environment value itself never appears.
      expect(JSON.stringify(list)).not.toContain("set-on-the-server");
    });

    it("keeps the same ids across reads and does not move the revision by reading", async () => {
      const owner = await signIn();
      const first = await listOf(owner);
      const second = await listOf(owner);
      expect(second.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id));
      expect(second.revision).toBe(first.revision);
      const one = await owner.call<DetailBody>("GET", `/admin/integrations/${first.items[0]?.id}`);
      expect(one.status).toBe(200);
      expect(one.body.integration).toEqual(first.items[0]);
      expect(one.headers.get("cache-control")).toContain("no-store");
    });

    it("answers 404 for an unknown id and 400 for a malformed one", async () => {
      const owner = await signIn();
      expect((await owner.call("GET", `/admin/integrations/${randomUUID()}`)).status).toBe(404);
      expect((await owner.call("GET", "/admin/integrations/not-an-id")).status).toBe(400);
    });
  });

  describe("authorization", () => {
    it.each(["manager", "viewer"] as const)("refuses every route to a %s", async (role) => {
      const owner = await signIn();
      const testmail = await integrationOf(owner, "testmail");
      const other = await signIn(role);
      const body = { expectedRevision: 0, value: MAIL_KEY, currentPassword: PASSWORD };
      const answers = await Promise.all([
        other.call<ProblemBody>("GET", "/admin/integrations"),
        other.call<ProblemBody>("GET", `/admin/integrations/${testmail.id}`),
        other.call<ProblemBody>("PUT", `/admin/integrations/${testmail.id}/secrets/api_key`, body),
        other.call<ProblemBody>("POST", `/admin/integrations/${testmail.id}/retire-secret`, {
          expectedRevision: 0,
          versionId: randomUUID(),
          currentPassword: PASSWORD,
        }),
      ]);
      expect(answers.map((answer) => answer.status)).toEqual([403, 403, 403, 403]);
      // A missing permission is not the step-up refusal.
      expect(answers.every((answer) => answer.body.rule === undefined)).toBe(true);
      expect(await stored(testmail.id)).toEqual([]);
    });

    it("refuses an anonymous caller and a change without the CSRF header", async () => {
      const owner = await signIn();
      const testmail = await integrationOf(owner, "testmail");
      expect((await http(running.baseUrl, "GET", "/admin/integrations")).status).toBe(401);
      const noCsrf = await http(
        running.baseUrl,
        "PUT",
        `/admin/integrations/${testmail.id}/secrets/api_key`,
        {
          headers: { cookie: owner.cookie },
          csrf: false,
          body: { expectedRevision: 0, value: MAIL_KEY, currentPassword: PASSWORD },
        },
      );
      expect(noCsrf.status).toBe(403);
      expect(await stored(testmail.id)).toEqual([]);
    });
  });

  describe("storing a credential", () => {
    it("encrypts the value, binds it to its row, audits codes only and never returns it", async () => {
      const owner = await signIn();
      const testmail = await integrationOf(owner, "testmail");
      const before = await listOf(owner);
      const logged: string[] = [];
      for (const stream of [process.stdout, process.stderr]) {
        vi.spyOn(stream, "write").mockImplementation((chunk: unknown) => {
          logged.push(String(chunk));
          return true;
        });
      }
      const result = await put(owner, testmail, "api_key", MAIL_KEY);
      const after = await listOf(owner);
      vi.restoreAllMocks();

      expect(result.status).toBe(200);
      expect(result.body.revision).toBe(before.revision + 1);
      expect(after.revision).toBe(before.revision + 1);
      const view = secretOf(result.body.integration, "api_key");
      expect(view).toMatchObject({
        state: "set",
        last4: null,
        generation: 1,
        keyAvailable: true,
        versionState: "candidate",
      });
      expect(view.versionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(view.savedAt).not.toBeNull();
      for (const text of [JSON.stringify(result.body), JSON.stringify(after), logged.join("")]) {
        expect(text).not.toContain(SENTINEL);
        expect(text).not.toContain(PASSWORD);
      }

      const [row] = await stored(testmail.id);
      if (row === undefined) throw new Error("nothing was stored");
      expect(row).toMatchObject({ field: "api_key", key_id: "spec-key-1", state: "candidate" });
      expect(row.nonce).toHaveLength(12);
      expect(row.tag).toHaveLength(16);
      expect(row.ciphertext.includes(Buffer.from(SENTINEL))).toBe(false);
      const binding = {
        secretId: row.secret_id,
        integrationId: testmail.id,
        kind: "email" as const,
        providerCode: "testmail",
        field: "api_key",
        generation: 1,
      };
      const cipher = running.app.get(SecretCipher, { strict: false });
      expect(cipher.open(binding, sealedOf(row))).toBe(MAIL_KEY);

      const audit = await auditOf("integration.secret_changed", testmail.id, owner.user.id);
      expect(audit).toEqual([
        {
          kind: "email",
          provider: "testmail",
          field: "api_key",
          purpose: "outbound",
          generation: 1,
          version: row.version_id,
          replaced: false,
        },
      ]);
      const [touched] = (
        await db.execute<{ updated_by: string }>(
          sql`select updated_by from integration where id = ${testmail.id}::uuid`,
        )
      ).rows;
      expect(touched?.updated_by).toBe(owner.user.id);
    });

    it("a second save makes a new generation with a fresh nonce and retires the earlier candidate", async () => {
      const owner = await signIn();
      const testmail = await integrationOf(owner, "testmail");
      expect((await put(owner, testmail, "api_key", MAIL_KEY)).status).toBe(200);
      const [first] = await stored(testmail.id);
      const second = await put(owner, testmail, "api_key", MAIL_KEY);
      expect(second.status).toBe(200);
      expect(secretOf(second.body.integration, "api_key").generation).toBe(2);

      const rows = await stored(testmail.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.generation).toBe(2);
      // The same plaintext again: another nonce and another ciphertext.
      expect(rows[0]?.nonce.equals(first?.nonce ?? Buffer.alloc(0))).toBe(false);
      expect(rows[0]?.ciphertext.equals(first?.ciphertext ?? Buffer.alloc(0))).toBe(false);
      const versions = await db.execute<{
        generation: number;
        state: string;
        retired: boolean;
      }>(sql`
        select generation, state, retired_at is not null as retired from integration_credential_version
        where integration_id = ${testmail.id}::uuid order by generation`);
      expect(versions.rows).toEqual([
        { generation: 1, state: "retired", retired: true },
        { generation: 2, state: "candidate", retired: false },
      ]);
      const audit = await auditOf("integration.secret_changed", testmail.id, owner.user.id);
      expect(audit.map((entry) => entry["replaced"])).toEqual([false, true]);
    });

    it("an envelope moved to another row no longer opens", async () => {
      const owner = await signIn();
      const testmail = await integrationOf(owner, "testmail");
      const testpay = await integrationOf(owner, "testpay");
      expect((await put(owner, testmail, "api_key", MAIL_KEY)).status).toBe(200);
      expect((await put(owner, testpay, "token", "pay-token-0123456789")).status).toBe(200);
      const [mail] = await stored(testmail.id);
      const [pay] = await stored(testpay.id);
      if (mail === undefined || pay === undefined) throw new Error("nothing was stored");
      const cipher = running.app.get(SecretCipher, { strict: false });
      const payBinding = {
        secretId: pay.secret_id,
        integrationId: testpay.id,
        kind: "payment" as const,
        providerCode: "testpay",
        field: "token",
        generation: 1,
      };
      expect(cipher.open(payBinding, sealedOf(pay))).toBe("pay-token-0123456789");
      // What an attacker with database write access would do: put the mail envelope under the payment row.
      expect(() => cipher.open(payBinding, sealedOf(mail))).toThrow(SecretUnavailableError);
    });

    it("accepts a provider without a format rule and refuses a value the plugin's rule rejects", async () => {
      const owner = await signIn();
      const testpay = await integrationOf(owner, "testpay");
      expect((await put(owner, testpay, "token", "anything-printable")).status).toBe(200);
      const testmail = await integrationOf(owner, "testmail");
      const refused = await put(owner, testmail, "api_key", `wrong_${SENTINEL}`);
      expect(refused.status).toBe(400);
      expect(refused.body.errors).toEqual([
        { path: "value", code: "invalid_format", message: expect.stringContaining("not shown") },
      ]);
      expect(JSON.stringify(refused.body)).not.toContain(SENTINEL);
      expect(await stored(testmail.id)).toEqual([]);
    });

    it.each([
      ["a space", "has space", "invalid_characters"],
      ["a line break", "line\nbreak", "invalid_characters"],
      ["a non-ASCII letter", "ключ-0123456789", "invalid_characters"],
    ])("refuses a value with %s before asking for the password", async (_name, value, code) => {
      const owner = await signIn();
      const verify = vi.spyOn(running.app.get(PasswordHasher), "verify");
      const testmail = await integrationOf(owner, "testmail");
      const refused = await put(owner, testmail, "api_key", value);
      expect(refused.status).toBe(400);
      expect(refused.body.errors).toEqual([{ path: "value", code }]);
      expect(verify).not.toHaveBeenCalled();
    });

    it.each([
      ["an unknown body member", { extra: 1 }],
      ["a missing password", { currentPassword: undefined }],
      ["an empty value", { value: "" }],
      ["a value over 4096 characters", { value: "a".repeat(4097) }],
      ["a revision that is not a number", { expectedRevision: "1" }],
    ])("refuses %s as 400", async (_name, overrides) => {
      const owner = await signIn();
      const testmail = await integrationOf(owner, "testmail");
      const refused = await put(owner, testmail, "api_key", MAIL_KEY, overrides);
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).not.toContain(SENTINEL);
      expect(await stored(testmail.id)).toEqual([]);
    });

    it("answers 404 for a field the provider does not declare and for an unknown integration", async () => {
      const owner = await signIn();
      const testpay = await integrationOf(owner, "testpay");
      expect((await put(owner, testpay, "api_key", MAIL_KEY)).status).toBe(404);
      expect(
        (await put(owner, { ...testpay, id: randomUUID() }, "token", "pay-token-0123456789"))
          .status,
      ).toBe(404);
    });

    it("refuses a secret that the server environment sets, without a password check", async () => {
      const owner = await signIn();
      const verify = vi.spyOn(running.app.get(PasswordHasher), "verify");
      const testmail = await integrationOf(owner, "testmail");
      const refused = await put(owner, testmail, "webhook_secret", "tmwh_abcdefghijkl0123");
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        code: "rule_violation",
        rule: "integration_env_override",
      });
      expect(verify).not.toHaveBeenCalled();
      expect(await stored(testmail.id)).toEqual([]);
    });

    it("saves nothing for a provider whose package cannot be loaded", async () => {
      const owner = await signIn();
      const broken = await integrationOf(owner, "brokenmail");
      const refused = await put(owner, broken, "api_key", "any-key-0123456789");
      expect(refused.status).toBe(409);
      expect(refused.body.rule).toBe("integration_unavailable");
      expect(await stored(broken.id)).toEqual([]);
    });
  });

  describe("revision", () => {
    it("refuses a stale revision before the password is checked", async () => {
      const owner = await signIn();
      const testmail = await integrationOf(owner, "testmail");
      const { revision } = await listOf(owner);
      expect((await put(owner, testmail, "api_key", MAIL_KEY)).status).toBe(200);
      const verify = vi.spyOn(running.app.get(PasswordHasher), "verify");
      const stale = await put(owner, testmail, "api_key", MAIL_KEY, { expectedRevision: revision });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({
        code: "rule_violation",
        rule: "integration_revision_stale",
      });
      expect(verify).not.toHaveBeenCalled();
      expect((await stored(testmail.id)).map((row) => row.generation)).toEqual([1]);
    });

    it("lets exactly one of two concurrent changes with the same revision through", async () => {
      const owner = await signIn();
      const testmail = await integrationOf(owner, "testmail");
      const testpay = await integrationOf(owner, "testpay");
      const { revision } = await listOf(owner);
      const body = (value: string) => ({
        expectedRevision: revision,
        value,
        currentPassword: PASSWORD,
      });
      const answers = await Promise.all([
        owner.call<ProblemBody>(
          "PUT",
          `/admin/integrations/${testmail.id}/secrets/api_key`,
          body(MAIL_KEY),
        ),
        owner.call<ProblemBody>(
          "PUT",
          `/admin/integrations/${testpay.id}/secrets/token`,
          body("pay-token-0123456789"),
        ),
      ]);
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
      const loser = answers.find((answer) => answer.status === 409);
      expect(loser?.body.rule).toBe("integration_revision_stale");
      expect((await listOf(owner)).revision).toBe(revision + 1);
      expect([...(await stored(testmail.id)), ...(await stored(testpay.id))]).toHaveLength(1);
    });
  });

  describe("password re-entry", () => {
    it("a wrong password answers 403 with its rule, stores nothing, counts and is audited", async () => {
      const owner = await signIn();
      const testmail = await integrationOf(owner, "testmail");
      const before = await listOf(owner);
      const refused = await put(owner, testmail, "api_key", MAIL_KEY, {
        currentPassword: "not the password",
      });
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ code: "forbidden", rule: "current_password_incorrect" });
      expect(JSON.stringify(refused.body)).not.toContain(SENTINEL);
      expect(await stored(testmail.id)).toEqual([]);
      expect((await listOf(owner)).revision).toBe(before.revision);
      expect(await auditOf("integration.secret_changed", testmail.id, owner.user.id)).toEqual([]);
      // The refusal is on record although the change was rolled back.
      expect(await auditOf("admin_user.step_up_failed", owner.user.id, owner.user.id)).toEqual([
        { operation: "integration.secret_changed" },
      ]);
      const [counted] = (
        await db.execute<{ failed_login_count: number }>(
          sql`select failed_login_count from admin_user where id = ${owner.user.id}::uuid`,
        )
      ).rows;
      expect(counted?.failed_login_count).toBe(1);
    });

    it("after five attempts the sixth is refused with 429 before any password work, a right password included", async () => {
      const owner = await signIn();
      const testmail = await integrationOf(owner, "testmail");
      const { revision } = await listOf(owner);
      const attempt = (currentPassword: string) =>
        owner.call<ProblemBody>("PUT", `/admin/integrations/${testmail.id}/secrets/api_key`, {
          expectedRevision: revision,
          value: MAIL_KEY,
          currentPassword,
        });
      for (let index = 0; index < 5; index += 1) {
        expect((await attempt(`wrong-${String(index)}`)).status).toBe(403);
      }
      const hasher = running.app.get(PasswordHasher);
      const verify = vi.spyOn(hasher, "verify");
      const dummy = vi.spyOn(hasher, "verifyDummy");
      const limited = await attempt(PASSWORD);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(verify).not.toHaveBeenCalled();
      expect(dummy).not.toHaveBeenCalled();
      expect(await stored(testmail.id)).toEqual([]);
    });

    it("the limit is shared by saving and removing", async () => {
      const owner = await signIn();
      const testmail = await integrationOf(owner, "testmail");
      expect((await put(owner, testmail, "api_key", MAIL_KEY)).status).toBe(200);
      const versionId = secretOf(await integrationOf(owner, "testmail"), "api_key").versionId;
      const { revision } = await listOf(owner);
      const retire = (currentPassword: string) =>
        owner.call<ProblemBody>("POST", `/admin/integrations/${testmail.id}/retire-secret`, {
          expectedRevision: revision,
          versionId,
          currentPassword,
        });
      // One attempt went to the save; four wrong removals fill the window of five.
      for (let index = 0; index < 4; index += 1) expect((await retire("wrong")).status).toBe(403);
      expect((await retire(PASSWORD)).status).toBe(429);
      expect(await stored(testmail.id)).toHaveLength(1);
    });

    it("a change is refused when the account changed between the password check and the write", async () => {
      const owner = await signIn();
      const stepUp = running.app.get(AdminStepUpService);
      const [session] = (
        await db.execute<{ id: string }>(
          sql`select id from admin_session where user_id = ${owner.user.id}::uuid`,
        )
      ).rows;
      if (session === undefined) throw new Error("fixture: the owner has no session");
      const principal: AdminPrincipal = {
        userId: owner.user.id,
        email: owner.user.email,
        role: "owner",
        permissions: ["integrations.manage"],
        sessionId: session.id,
      };
      const verified = await stepUp.verify({
        principal,
        currentPassword: PASSWORD,
        clientAddress: nextAddress(),
        operation: "integration.secret_changed",
      });
      const check = () =>
        withTransaction(db, (transaction) =>
          stepUp.assertStillValid(transaction, verified, "integrations.manage"),
        );
      await expect(check()).resolves.toBeUndefined();

      await db.execute(
        sql`update admin_user set role = 'manager' where id = ${owner.user.id}::uuid`,
      );
      await expect(check()).rejects.toMatchObject({ code: "forbidden" });
      await db.execute(sql`update admin_user set role = 'owner' where id = ${owner.user.id}::uuid`);
      await expect(check()).resolves.toBeUndefined();

      await db.execute(
        sql`update admin_user set password_hash = 'scrypt$16$8$1$other$other' where id = ${owner.user.id}::uuid`,
      );
      await expect(check()).rejects.toMatchObject({ code: "forbidden" });
      await db.execute(
        sql`update admin_user set password_hash = ${verified.passwordHash}, is_active = false where id = ${owner.user.id}::uuid`,
      );
      await expect(check()).rejects.toMatchObject({ code: "forbidden" });
      await db.execute(
        sql`update admin_user set is_active = true where id = ${owner.user.id}::uuid`,
      );
      await expect(check()).resolves.toBeUndefined();

      // Signed out everywhere while the password was being checked: the session row is gone.
      await db.execute(sql`delete from admin_session where id = ${session.id}::uuid`);
      await expect(check()).rejects.toMatchObject({ code: "unauthorized" });
    });

    it("a locked account gets the dummy check and is refused even with the right password", async () => {
      const owner = await signIn();
      const testmail = await integrationOf(owner, "testmail");
      await db.execute(
        sql`update admin_user set locked_until = now() + interval '10 minutes' where id = ${owner.user.id}::uuid`,
      );
      const hasher = running.app.get(PasswordHasher);
      const verify = vi.spyOn(hasher, "verify");
      // The session of a locked account still works, so the list is readable; the change is not.
      const refused = await put(owner, testmail, "api_key", MAIL_KEY);
      expect(refused.status).toBe(403);
      expect(refused.body.rule).toBe("current_password_incorrect");
      expect(verify).not.toHaveBeenCalled();
      expect(await stored(testmail.id)).toEqual([]);
    });
  });

  describe("removing a stored credential", () => {
    it("deletes the envelope, keeps a tombstone, audits and returns the field to not set", async () => {
      const owner = await signIn();
      const testmail = await integrationOf(owner, "testmail");
      expect((await put(owner, testmail, "api_key", MAIL_KEY)).status).toBe(200);
      const saved = secretOf(await integrationOf(owner, "testmail"), "api_key");
      const { revision } = await listOf(owner);
      const body = {
        expectedRevision: revision,
        versionId: saved.versionId,
        currentPassword: PASSWORD,
      };
      const retired = await owner.call<DetailBody>(
        "POST",
        `/admin/integrations/${testmail.id}/retire-secret`,
        body,
      );
      expect(retired.status).toBe(200);
      expect(retired.body.revision).toBe(revision + 1);
      expect(secretOf(retired.body.integration, "api_key")).toMatchObject({
        state: "not_set",
        versionId: null,
        generation: null,
        keyAvailable: null,
      });
      expect(await stored(testmail.id)).toEqual([]);
      const versions = await db.execute<{ state: string }>(
        sql`select state from integration_credential_version where integration_id = ${testmail.id}::uuid`,
      );
      expect(versions.rows).toEqual([{ state: "retired" }]);
      expect(await auditOf("integration.secret_retired", testmail.id, owner.user.id)).toEqual([
        {
          kind: "email",
          provider: "testmail",
          purpose: "outbound",
          generation: 1,
          version: saved.versionId,
        },
      ]);

      // The generation of a retired version is never reused.
      const again = await put(owner, testmail, "api_key", MAIL_KEY);
      expect(secretOf(again.body.integration, "api_key").generation).toBe(2);
      // A retired version cannot be retired twice.
      const twice = await owner.call<ProblemBody>(
        "POST",
        `/admin/integrations/${testmail.id}/retire-secret`,
        { ...body, expectedRevision: (await listOf(owner)).revision },
      );
      expect(twice.status).toBe(409);
      expect(twice.body).toMatchObject({
        code: "invalid_transition",
        rule: "integration_version_not_retirable",
      });
    });

    it("answers 404 for a version of another integration", async () => {
      const owner = await signIn();
      const testmail = await integrationOf(owner, "testmail");
      const testpay = await integrationOf(owner, "testpay");
      expect((await put(owner, testmail, "api_key", MAIL_KEY)).status).toBe(200);
      const saved = secretOf(await integrationOf(owner, "testmail"), "api_key");
      const refused = await owner.call("POST", `/admin/integrations/${testpay.id}/retire-secret`, {
        expectedRevision: (await listOf(owner)).revision,
        versionId: saved.versionId,
        currentPassword: PASSWORD,
      });
      expect(refused.status).toBe(404);
      expect(await stored(testmail.id)).toHaveLength(1);
    });
  });

  describe("other API instances", () => {
    it("an instance without the master key sees the stored value as unreadable, cannot save, and can remove it", async () => {
      const owner = await signIn();
      const testmail = await integrationOf(owner, "testmail");
      expect((await put(owner, testmail, "api_key", MAIL_KEY)).status).toBe(200);

      const keyless = await startApp({
        adminAuthenticator: "production-default",
        redisUrl: requireEnv("REDIS_URL"),
        rateLimitKeyPrefix: prefix,
        trustProxy: 1,
        integrationProvidersDir: fixture.dir,
      });
      try {
        const other = await signIn("owner", keyless);
        const seen = await listOf(other);
        expect(seen.storage).toBe("disabled");
        const view = secretOf(
          seen.items.find((item) => item.id === testmail.id) ?? testmail,
          "api_key",
        );
        // Written by the first instance and visible here at once: nothing is cached.
        expect(view).toMatchObject({ state: "set", keyAvailable: false });

        const refused = await put(other, testmail, "api_key", MAIL_KEY);
        expect(refused.status).toBe(409);
        expect(refused.body.rule).toBe("integration_storage_disabled");

        const retired = await other.call<DetailBody>(
          "POST",
          `/admin/integrations/${testmail.id}/retire-secret`,
          { expectedRevision: seen.revision, versionId: view.versionId, currentPassword: PASSWORD },
        );
        expect(retired.status).toBe(200);
        expect(await stored(testmail.id)).toEqual([]);
      } finally {
        await keyless.app.close();
      }
    });

    it("an instance with a rotated key ring still reads the old envelope and seals new ones under the new key", async () => {
      const owner = await signIn();
      const testmail = await integrationOf(owner, "testmail");
      expect((await put(owner, testmail, "api_key", MAIL_KEY)).status).toBe(200);
      const rotated = await startApp({
        adminAuthenticator: "production-default",
        redisUrl: requireEnv("REDIS_URL"),
        rateLimitKeyPrefix: prefix,
        trustProxy: 1,
        secretsKeyRing: {
          current: testSecretsKeyRing("spec-key-2").current,
          previous: keyRing.current,
        },
        integrationProvidersDir: fixture.dir,
      });
      try {
        const other = await signIn("owner", rotated);
        const view = secretOf(await integrationOf(other, "testmail"), "api_key");
        expect(view).toMatchObject({ state: "set", keyAvailable: true });
        const testpay = await integrationOf(other, "testpay");
        expect((await put(other, testpay, "token", "pay-token-0123456789")).status).toBe(200);
        expect((await stored(testpay.id))[0]?.key_id).toBe("spec-key-2");
        // The first instance does not hold the new key.
        expect(secretOf(await integrationOf(owner, "testpay"), "token").keyAvailable).toBe(false);
      } finally {
        await rotated.app.close();
      }
    });
  });

  it("refuses activation while email and payment enablement are env-owned", async () => {
    const session = await signIn();
    const testmail = await integrationOf(session, "testmail");
    const payment = await integrationOf(session, "testpay");
    const { revision } = await listOf(session);
    const email = await session.call<ProblemBody>(
      "POST",
      `/admin/integrations/${testmail.id}/activate`,
      {
        expectedRevision: revision,
        currentPassword: PASSWORD,
      },
    );
    expect(email.status).toBe(409);
    expect(email.body.rule).toBe("integration_env_override");
    const online = await session.call<ProblemBody>(
      "POST",
      `/admin/integrations/${payment.id}/activate`,
      { expectedRevision: revision, currentPassword: PASSWORD },
    );
    expect(online.status).toBe(409);
    expect(online.body.rule).toBe("integration_env_override");
    const audits = await db.execute(
      sql`select 1 from admin_audit_event where admin_user_id = ${session.user.id}::uuid and action = 'admin_user.step_up_failed'`,
    );
    expect(audits.rows).toEqual([]);
  });
});

describe("admin integrations without Redis", () => {
  let fixture: IntegrationProviderFixture;
  let db: Database;
  const userIds: string[] = [];
  const apps: RunningApp[] = [];

  beforeAll(async () => {
    await ensureMigrated();
    fixture = await createIntegrationProviderFixture();
  });
  afterAll(async () => {
    await deleteTestAdminUsers(db, userIds);
    for (const running of apps) await running.app.close();
    await fixture.remove();
  });

  it.each([
    ["no REDIS_URL", undefined],
    // Port 1 on loopback: nothing listens there.
    ["an unreachable Redis", "redis://127.0.0.1:1"],
  ])(
    "with %s a change answers 503 and does no password work and no write",
    async (_name, redisUrl) => {
      const running = await startApp({
        adminAuthenticator: "production-default",
        ...(redisUrl === undefined ? {} : { redisUrl }),
        rateLimitKeyPrefix: `integrations_${randomUUID()}`,
        secretsKeyRing: testSecretsKeyRing(),
        integrationProvidersDir: fixture.dir,
      });
      apps.push(running);
      db = running.app.get<Database>(DRIZZLE);
      const user = await createTestAdminUser(db, { role: "owner", password: PASSWORD });
      userIds.push(user.id);
      const cookie = await loginCookie(running.baseUrl, user.email, PASSWORD);
      const list = await http<ListBody>(running.baseUrl, "GET", "/admin/integrations", {
        headers: { cookie },
      });
      expect(list.status).toBe(200);
      const testmail = list.body.items.find((item) => item.providerCode === "testmail");
      if (testmail === undefined) throw new Error("fixture");

      const hasher = running.app.get(PasswordHasher);
      const verify = vi.spyOn(hasher, "verify");
      const dummy = vi.spyOn(hasher, "verifyDummy");
      const refused = await http<ProblemBody>(
        running.baseUrl,
        "PUT",
        `/admin/integrations/${testmail.id}/secrets/api_key`,
        {
          headers: { cookie },
          body: {
            expectedRevision: list.body.revision,
            value: MAIL_KEY,
            currentPassword: PASSWORD,
          },
        },
      );
      expect(refused.status).toBe(503);
      expect(refused.body).toMatchObject({
        code: "service_unavailable",
        rule: "step_up_unavailable",
      });
      expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(verify).not.toHaveBeenCalled();
      expect(dummy).not.toHaveBeenCalled();
      const rows = await db.execute(
        sql`select 1 from integration_credential_version where integration_id = ${testmail.id}::uuid`,
      );
      expect(rows.rows).toEqual([]);
      vi.restoreAllMocks();
    },
  );
});
