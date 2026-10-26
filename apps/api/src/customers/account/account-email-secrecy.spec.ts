import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  ACCOUNT_PASSWORD,
  AccountEmailWorld,
  NEW_PASSWORD,
} from "../../test/account-email-world.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { deleteTestCustomers } from "../../test/customer-fixtures.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";

describe("password reset and verification: no address, token, link or password in logs or stored rows", () => {
  let world: AccountEmailWorld;
  let output: string[] = [];

  beforeAll(async () => {
    world = await AccountEmailWorld.start();
    for (const stream of [process.stdout, process.stderr]) {
      vi.spyOn(stream, "write").mockImplementation(((chunk: string | Uint8Array) => {
        output.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      }) as typeof stream.write);
    }
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await world.stop();
  });

  it("logs reason codes and message ids only, and stores only the token hash and {tokenId}", async () => {
    const email = "secret-person@example.test";
    output = [];
    const registered = await world.post<{ customer: { id: string } }>("/store/account/register", {
      email,
      password: ACCOUNT_PASSWORD,
      firstName: "Secret",
      lastName: "Person",
    });
    expect(registered.status).toBe(201);
    world.customers.push(registered.body.customer.id);
    const verification = await world.tokenMailTo(email);
    expect((await world.verify(verification.token)).status).toBe(204);
    expect((await world.requestReset(email.toUpperCase(), "en")).status).toBe(202);
    const reset = await world.tokenMailTo(email, 2);
    expect((await world.confirmReset(`${reset.token.slice(0, 42)}x`)).status).toBe(400);
    expect((await world.confirmReset(reset.token)).status).toBe(204);
    expect((await world.confirmReset(reset.token)).status).toBe(400);
    expect((await world.requestReset("unknown-secret@example.test")).status).toBe(202);
    await world.waitForMails(email, 3);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const printed = output.join("");
    // The loggers did speak, so the absence below is meaningful.
    expect(printed).toContain("Password reset request: issued");
    expect(printed).toContain("Password reset request: no_account");
    expect(printed).toContain("Customer reset token refused: used");
    expect(printed).toMatch(
      /Email [0-9a-f-]{36} \(customer\.password_reset\) attempt 1 via fake: sent/,
    );
    for (const secret of [
      email,
      "secret-person",
      "unknown-secret",
      verification.token,
      reset.token,
      ACCOUNT_PASSWORD,
      NEW_PASSWORD,
      "#t=",
      "reset-password",
      "verify-email#",
    ]) {
      expect(printed, secret).not.toContain(secret);
    }

    const tokens = await world.tokenRows(registered.body.customer.id);
    const outbox = await world.outboxRows(registered.body.customer.id);
    const tokenOf = (purpose: string) => tokens.find((row) => row.purpose === purpose)?.id;
    expect(
      outbox
        .map((row) => [row["template_key"], row["variables"]])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["customer.password_changed", {}],
      ["customer.password_reset", { tokenId: tokenOf("password_reset") }],
      ["customer.verify_email", { tokenId: tokenOf("email_verification") }],
    ]);
    const stored = JSON.stringify([tokens, outbox]);
    for (const token of [verification.token, reset.token]) {
      expect(stored).not.toContain(token);
    }
    expect(stored).not.toContain("#t=");
  });
});

describe("without a mail provider (EMAIL_PROVIDER=none, ADR 0031 decision 11)", () => {
  let running: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp();
  });

  afterAll(async () => {
    await running.app.close();
  });

  it("the four routes answer 404 like an unknown route, registration creates no token or mail, and /store/config says emailDelivery: false", async () => {
    const unknownRoute = await http(running.baseUrl, "POST", "/store/account/no-such-route", {
      body: {},
    });
    expect(unknownRoute.status).toBe(404);
    for (const [path, body] of [
      ["/store/account/password-reset", { email: "a@example.test", locale: "en" }],
      [
        "/store/account/password-reset/confirm",
        { token: "A".repeat(43), newPassword: NEW_PASSWORD },
      ],
      ["/store/account/verify-email", { token: "A".repeat(43) }],
    ] as const) {
      const answer = await http(running.baseUrl, "POST", path, { body });
      expect(answer.status, path).toBe(404);
      expect(answer.body, path).toEqual(unknownRoute.body);
      expect(answer.headers.get("cache-control"), path).toBe("no-store");
    }
    const email = `no-provider-${String(Date.now())}@example.test`;
    const registered = await http<{ customer: { id: string; emailVerified: boolean } }>(
      running.baseUrl,
      "POST",
      "/store/account/register",
      { body: { email, password: ACCOUNT_PASSWORD, firstName: "No", lastName: "Mail" } },
    );
    expect(registered.status).toBe(201);
    expect(registered.body.customer.emailVerified).toBe(false);
    const cookie = registered.headers.getSetCookie()[0]?.split(";")[0] ?? "";
    const resend = await http(running.baseUrl, "POST", "/store/account/verify-email/resend", {
      headers: { cookie },
    });
    expect(resend.status).toBe(404);
    expect(resend.body).toEqual(unknownRoute.body);
    // Signed out, the resend is a customer route first: 401.
    expect((await http(running.baseUrl, "POST", "/store/account/verify-email/resend")).status).toBe(
      401,
    );
    const db = running.app.get<Database>(DRIZZLE);
    const id = registered.body.customer.id;
    const tokens = await db.execute(
      sql`select id from customer_auth_token where customer_id = ${id}`,
    );
    const mails = await db.execute(sql`select id from email_message where customer_id = ${id}`);
    expect([tokens.rows, mails.rows]).toEqual([[], []]);
    await deleteTestCustomers(db, [id]);
    const config = await http<{ emailDelivery: boolean }>(running.baseUrl, "GET", "/store/config");
    expect(config.body.emailDelivery).toBe(false);
  });
});
