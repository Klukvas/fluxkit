import { AUTH_TOKEN_LIFETIME_MINUTES } from "@fluxkit/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import {
  ACCOUNT_PASSWORD,
  AccountEmailWorld,
  LINK_ORIGIN,
} from "../../test/account-email-world.js";
import { customerCookieOf, customerLoginCookie } from "../../test/customer-http.js";
import { http } from "../../test/http.js";

const RESEND = "/store/account/verify-email/resend";
const MINUTE = 60_000;

describe("customer email verification (ADR 0031 decision 10, optional)", () => {
  let world: AccountEmailWorld;

  beforeAll(async () => {
    world = await AccountEmailWorld.start({
      rateLimits: {
        registration: { maxAttempts: 1_000, windowMinutes: 60 },
        passwordResetConfirm: { maxAttempts: 1_000, windowMinutes: 10 },
        login: { maxAttempts: 1_000, windowMinutes: 10 },
      },
    });
  });

  afterEach(async () => {
    await world.between();
  });

  afterAll(async () => {
    await world.stop();
  });

  async function register(email: string): Promise<{ id: string; cookie: string; body: unknown }> {
    const answer = await world.post<{ customer: { id: string } }>("/store/account/register", {
      email,
      password: ACCOUNT_PASSWORD,
      firstName: "Vera",
      lastName: "Fication",
    });
    expect(answer.status).toBe(201);
    world.customers.push(answer.body.customer.id);
    const cookie = customerCookieOf(answer);
    if (cookie === undefined) {
      throw new Error("no cookie");
    }
    return { id: answer.body.customer.id, cookie, body: answer.body };
  }

  const me = (cookie: string) =>
    http<{ customer: { emailVerified: boolean } }>(world.baseUrl, "GET", "/store/account/me", {
      headers: { cookie },
    });

  it("registration keeps its answer (plus emailVerified: false) and mails a verification link in DEFAULT_LOCALE", async () => {
    const email = "new-shopper@example.test";
    const created = await register(email);
    expect(created.body).toMatchObject({
      customer: { email, emailVerified: false },
      cartNotices: [],
    });
    const captured = await world.tokenMailTo(email);
    expect(captured.link).toBe(`${LINK_ORIGIN}/uk/account/verify-email#t=${captured.token}`);
    const [token] = await world.tokenRows(created.id);
    expect(token).toMatchObject({ purpose: "email_verification", used_at: null, email });
    expect(token?.expires_at.getTime()).toBe(
      world.clock.now().getTime() + AUTH_TOKEN_LIFETIME_MINUTES.email_verification * MINUTE,
    );
    const [outbox] = await world.outboxRows(created.id);
    expect(outbox).toMatchObject({
      template_key: "customer.verify_email",
      locale: "uk",
      variables: { tokenId: token?.id },
    });
    // The outbox deadline of a 48 h token is min(expiry, created + 1 h).
    expect((outbox?.deadline_at as Date).getTime()).toBe(world.clock.now().getTime() + 60 * MINUTE);
    // A taken email still answers 409 (owner answer 2).
    const taken = await world.post<ProblemBody>("/store/account/register", {
      email,
      password: ACCOUNT_PASSWORD,
      firstName: "Vera",
      lastName: "Again",
    });
    expect(taken.status).toBe(409);
  });

  it("verifies with the link (emailVerified becomes true) and answers 204 again for the used link of a verified customer", async () => {
    const email = "verify-me@example.test";
    const created = await register(email);
    const { token } = await world.tokenMailTo(email);
    expect((await me(created.cookie)).body.customer.emailVerified).toBe(false);
    const verified = await world.verify(token);
    expect(verified.status).toBe(204);
    expect(verified.headers.get("cache-control")).toBe("no-store");
    expect((await me(created.cookie)).body.customer.emailVerified).toBe(true);
    expect((await world.customerRow(created.id))["email_verified_at"]).toEqual(world.clock.now());
    world.clock.advanceMinutes(5);
    expect((await world.verify(token)).status).toBe(204);
    // The second use did not move the verification time.
    expect((await world.customerRow(created.id))["email_verified_at"]).toEqual(
      new Date(world.clock.now().getTime() - 5 * MINUTE),
    );
    // Login answers carry the flag too.
    const login = await http<{ customer: { emailVerified: boolean } }>(
      world.baseUrl,
      "POST",
      "/store/account/login",
      { body: { email, password: ACCOUNT_PASSWORD } },
    );
    expect(login.body.customer.emailVerified).toBe(true);
  });

  it("refuses an expired link, a reset token, an unknown token and a link replaced by a resend with the one 400", async () => {
    const email = "slow-clicker@example.test";
    const created = await register(email);
    const first = (await world.tokenMailTo(email)).token;
    world.clock.advanceMinutes(1);
    const resent = await http(world.baseUrl, "POST", RESEND, {
      headers: { cookie: created.cookie },
    });
    expect(resent.status).toBe(204);
    const second = (await world.tokenMailTo(email, 2)).token;
    expect(second).not.toBe(first);

    const replaced = await world.verify(first);
    expect(replaced.status).toBe(400);
    expect(replaced.body).toMatchObject({
      code: "validation_failed",
      errors: [{ path: "token", code: "invalid_or_expired" }],
    });
    // The replaced link stays refused: used but the customer is not verified.
    await world.requestReset(email);
    const reset = (await world.tokenMailTo(email, 3)).token;
    expect((await world.verify(reset)).body).toEqual(replaced.body);
    expect((await world.verify("D".repeat(43))).body).toEqual(replaced.body);

    world.clock.advanceMinutes(AUTH_TOKEN_LIFETIME_MINUTES.email_verification);
    expect((await world.verify(second)).body).toEqual(replaced.body);
    expect((await world.customerRow(created.id))["email_verified_at"]).toBeNull();
  });

  it("resend: 409 already_verified once verified, at most 3 per hour per customer, 401 when signed out", async () => {
    const email = "resender@example.test";
    const created = await register(email);
    const resend = (cookie?: string) =>
      http<ProblemBody>(
        world.baseUrl,
        "POST",
        RESEND,
        cookie === undefined ? {} : { headers: { cookie } },
      );
    expect((await resend()).status).toBe(401);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await resend(created.cookie)).status).toBe(204);
    }
    const limited = await resend(created.cookie);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe(String(60 * 60));
    // A second session of the same customer shares the limit.
    const other = await customerLoginCookie(world.baseUrl, email, ACCOUNT_PASSWORD);
    expect((await resend(other)).status).toBe(429);

    const mails = await world.waitForMails(email, 4);
    const rows = await world.tokenRows(created.id);
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.used_at === null)).toHaveLength(1);
    expect((await world.verify(mails[3]?.token ?? "")).status).toBe(204);

    world.clock.advanceMinutes(61);
    const verified = await resend(created.cookie);
    expect(verified.status).toBe(409);
    expect(verified.body).toMatchObject({ code: "rule_violation", rule: "already_verified" });
  });

  it("two concurrent verifications with one link both answer 204 and verify once", async () => {
    const email = "double-click@example.test";
    const created = await register(email);
    const { token } = await world.tokenMailTo(email);
    const answers = await Promise.all([world.verify(token), world.verify(token)]);
    expect(answers.map((answer) => answer.status)).toEqual([204, 204]);
    const [row] = await world.tokenRows(created.id);
    expect(row?.used_at).toEqual(world.clock.now());
  });

  it("deactivation ends the links still out: activating the customer again does not revive them", async () => {
    const email = "deactivated-later@example.test";
    const created = await register(email);
    const { token } = await world.tokenMailTo(email);
    const admin = (isActive: boolean) =>
      http(world.baseUrl, "PATCH", `/admin/customers/${created.id}`, { body: { isActive } });
    expect((await admin(false)).status).toBe(200);
    expect((await admin(true)).status).toBe(200);
    expect((await world.verify(token)).status).toBe(400);
    expect((await world.tokenRows(created.id)).every((row) => row.used_at !== null)).toBe(true);
  });
});
