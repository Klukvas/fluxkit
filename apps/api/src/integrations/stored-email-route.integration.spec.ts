import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { EmailRoutePolicy } from "../email/outbox/email-route-policy.js";
import { EmailOutbox } from "../email/outbox/email-outbox.service.js";
import { EmailSender } from "../email/outbox/email-sender.js";
import { createTestAdminUser, deleteTestAdminUsers } from "../test/admin-user-fixtures.js";
import { startApp, type RunningApp } from "../test/app.js";
import { sessionCookieOf } from "../test/auth-http.js";
import { requireEnv } from "../test/env.js";
import { http } from "../test/http.js";
import {
  createStoredRouteFixture,
  testSecretsKeyRing,
  type IntegrationProviderFixture,
} from "../test/integration-provider-fixture.js";
import { ensureMigrated } from "../test/migrate.js";
import { withTransaction } from "../common/transaction.js";

const PASSWORD = "correct horse battery staple";

interface Listed {
  id: string;
  providerCode: string;
  enabled: boolean;
}
interface ListBody {
  revision: number;
  emailRouteMode: "equal" | "resend";
  items: Listed[];
}
interface RouteBody {
  revision: number;
  emailRouteMode: "equal" | "resend";
}
interface SecretBody {
  revision: number;
  integration: { secrets: { versionId: string | null }[] };
}
interface DetailBody {
  revision: number;
  integration: Listed;
}
interface StatusBody {
  providers: { code: string; role: string }[];
}

describe("stored Resend then Brevo (real Postgres and Redis)", () => {
  const prefix = `route_${randomUUID()}`;
  let fixture: IntegrationProviderFixture;
  let running: RunningApp;
  let db: Database;
  const sentCodes = async (): Promise<string[]> => {
    const text = await readFile(join(fixture.dir, "sent.log"), "utf8");
    return text.split("\n").filter((code) => code !== "");
  };
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

  async function wipe(): Promise<void> {
    await db.execute(
      sql`update integration set enabled = false, active_outbound_version_id = null`,
    );
    await db.execute(sql`update email_message set integration_credential_version_id = null`);
    await db.execute(sql`delete from integration_secret`);
    await db.execute(sql`delete from integration_credential_version`);
    await db.execute(sql`delete from email_provider_state`);
    await db.execute(sql`update email_route_setting set mode = 'equal', turn = 0 where id = 1`);
    await writeFile(join(fixture.dir, "sent.log"), "");
  }

  beforeAll(async () => {
    await ensureMigrated();
    fixture = await createStoredRouteFixture();
    running = await startApp({
      adminAuthenticator: "production-default",
      redisUrl: requireEnv("REDIS_URL"),
      rateLimitKeyPrefix: prefix,
      trustProxy: 1,
      secretsKeyRing: testSecretsKeyRing("route-key"),
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

  it("saves the route mode from the admin", async () => {
    const session = await signIn();
    const listed = await session.call<ListBody>("GET", "/admin/integrations");
    expect(listed.status).toBe(200);
    expect(listed.body.emailRouteMode).toBe("equal");
    const saved = await session.call<RouteBody>("PUT", "/admin/integrations/email-route", {
      mode: "resend",
      expectedRevision: listed.body.revision,
      currentPassword: PASSWORD,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.emailRouteMode).toBe("resend");
    const again = await session.call<ListBody>("GET", "/admin/integrations");
    expect(again.body.emailRouteMode).toBe("resend");
  });

  it("activates both, lists Resend first, and sends through Brevo after Resend's proven refusal", async () => {
    await db.execute(sql`update email_route_setting set mode = 'resend', turn = 0 where id = 1`);
    const session = await signIn();
    const listed = await session.call<ListBody>("GET", "/admin/integrations");
    expect(listed.status).toBe(200);
    const brevo = listed.body.items.find((item) => item.providerCode === "brevo");
    const resend = listed.body.items.find((item) => item.providerCode === "resend");
    if (brevo === undefined || resend === undefined) throw new Error("fixture: route is missing");

    const savedBrevo = await session.call<SecretBody>(
      "PUT",
      `/admin/integrations/${brevo.id}/secrets/api_key`,
      {
        expectedRevision: listed.body.revision,
        value: "brevokey01",
        currentPassword: PASSWORD,
      },
    );
    expect(savedBrevo.status).toBe(200);
    const brevoVersionId = savedBrevo.body.integration.secrets[0]?.versionId;
    if (brevoVersionId === null || brevoVersionId === undefined) {
      throw new Error("fixture: brevo has no version");
    }
    const activatedBrevo = await session.call<DetailBody>(
      "POST",
      `/admin/integrations/${brevo.id}/activate`,
      { expectedRevision: savedBrevo.body.revision, currentPassword: PASSWORD },
    );
    expect(activatedBrevo.status).toBe(200);

    const savedResend = await session.call<SecretBody>(
      "PUT",
      `/admin/integrations/${resend.id}/secrets/api_key`,
      {
        expectedRevision: activatedBrevo.body.revision,
        value: "resendkey1",
        currentPassword: PASSWORD,
      },
    );
    expect(savedResend.status).toBe(200);
    const activatedResend = await session.call<DetailBody>(
      "POST",
      `/admin/integrations/${resend.id}/activate`,
      { expectedRevision: savedResend.body.revision, currentPassword: PASSWORD },
    );
    expect(activatedResend.status).toBe(200);
    expect(activatedResend.body.integration.enabled).toBe(true);

    const status = await session.call<StatusBody>("GET", "/admin/email/status");
    expect(status.status).toBe(200);
    expect(status.body.providers.map((provider) => [provider.code, provider.role])).toEqual([
      ["resend", "primary"],
      ["brevo", "fallback"],
    ]);
    const resendDaily = (
      status.body.providers[0] as {
        usage?: { daily: { accepted: number; limit: number | null } };
      }
    ).usage?.daily;
    expect(resendDaily).toMatchObject({ accepted: 0, limit: 100 });

    const queued = await withTransaction(db, (tx) =>
      running.app.get(EmailOutbox).enqueue(tx, {
        templateKey: "admin.test",
        locale: "en",
        to: "owner@example.com",
        recipientKind: "admin",
        adminUserId: session.user.id,
        createdByAdminId: session.user.id,
        variables: { providerCode: "resend" },
        now: new Date(),
      }),
    );
    expect(queued.status).toBe("enqueued");
    if (queued.status !== "enqueued") return;
    expect((await running.app.get(EmailSender).sendNow(queued.id)).kind).toBe("sent");
    expect(await sentCodes()).toEqual(["resend", "brevo"]);
    const bound = await db.execute<{ integration_credential_version_id: string | null }>(sql`
      select integration_credential_version_id from email_message where id = ${queued.id}::uuid`);
    expect(bound.rows[0]?.integration_credential_version_id).toBe(brevoVersionId);
  });

  it("alternates the first provider when the mode is equal", async () => {
    const session = await signIn();
    const listed = await session.call<ListBody>("GET", "/admin/integrations");
    const brevo = listed.body.items.find((item) => item.providerCode === "brevo");
    const resend = listed.body.items.find((item) => item.providerCode === "resend");
    if (brevo === undefined || resend === undefined) throw new Error("fixture: route is missing");
    const savedBrevo = await session.call<SecretBody>(
      "PUT",
      `/admin/integrations/${brevo.id}/secrets/api_key`,
      { expectedRevision: listed.body.revision, value: "brevokey01", currentPassword: PASSWORD },
    );
    const activatedBrevo = await session.call<DetailBody>(
      "POST",
      `/admin/integrations/${brevo.id}/activate`,
      { expectedRevision: savedBrevo.body.revision, currentPassword: PASSWORD },
    );
    const savedResend = await session.call<SecretBody>(
      "PUT",
      `/admin/integrations/${resend.id}/secrets/api_key`,
      {
        expectedRevision: activatedBrevo.body.revision,
        value: "resendkey1",
        currentPassword: PASSWORD,
      },
    );
    const activatedResend = await session.call<DetailBody>(
      "POST",
      `/admin/integrations/${resend.id}/activate`,
      { expectedRevision: savedResend.body.revision, currentPassword: PASSWORD },
    );
    expect(activatedResend.status).toBe(200);
    await db.execute(sql`update email_route_setting set mode = 'equal', turn = 0 where id = 1`);
    expect(await running.app.get(EmailRoutePolicy).mode()).toBe("equal");

    const send = async () => {
      const queued = await withTransaction(db, (tx) =>
        running.app.get(EmailOutbox).enqueue(tx, {
          templateKey: "admin.test",
          locale: "en",
          to: "owner@example.com",
          recipientKind: "admin",
          adminUserId: session.user.id,
          createdByAdminId: session.user.id,
          variables: { providerCode: "resend" },
          now: new Date(),
        }),
      );
      if (queued.status !== "enqueued") throw new Error("fixture: mail was not queued");
      expect((await running.app.get(EmailSender).sendNow(queued.id)).kind).toBe("sent");
      return queued.id;
    };
    const first = await send();
    const second = await send();
    expect(await sentCodes()).toEqual(["resend", "brevo", "brevo"]);
    const assigned = await db.execute<{ id: string; assigned_provider_code: string | null }>(sql`
      select id, assigned_provider_code from email_message
      where id = ${first}::uuid or id = ${second}::uuid`);
    expect(assigned.rows.find((row) => row.id === first)?.assigned_provider_code).toBe("resend");
    expect(assigned.rows.find((row) => row.id === second)?.assigned_provider_code).toBe("brevo");
  });
});
