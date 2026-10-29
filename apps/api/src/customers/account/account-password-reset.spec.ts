import { createHash } from "node:crypto";
import { AUTH_TOKEN_LIFETIME_MINUTES } from "@fluxkit/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import {
  ACCOUNT_PASSWORD,
  AccountEmailWorld,
  LINK_ORIGIN,
  NEW_PASSWORD,
} from "../../test/account-email-world.js";
import { customerLogin, customerLoginCookie } from "../../test/customer-http.js";
import { http } from "../../test/http.js";
import { PASSWORD_RESET_ANSWER_FLOOR_MS } from "./account-email.service.js";

const RESET = "/store/account/password-reset";
const CONFIRM = "/store/account/password-reset/confirm";
const MINUTE = 60_000;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The headers of an answer that may differ between two identical requests (time, connection). */
const VOLATILE_HEADERS = new Set(["date", "keep-alive", "connection"]);

function stableHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    [...headers.entries()].filter(([name]) => !VOLATILE_HEADERS.has(name)).sort(),
  );
}

describe("customer password reset (ADR 0031 decision 10)", () => {
  let world: AccountEmailWorld;

  beforeAll(async () => {
    world = await AccountEmailWorld.start({
      // The per-address windows are tested on their own below; most cases make more requests than they allow.
      rateLimits: {
        passwordReset: { maxAttempts: 1_000, windowMinutes: 15 },
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

  describe("request", () => {
    it("mails an active customer a single-use link in the requested locale, built from STOREFRONT_PUBLIC_URL with the token in the fragment", async () => {
      const shopper = await world.customer();
      const answer = await world.requestReset(shopper.email.toUpperCase(), "uk", {
        // Forged origin headers must not reach the link.
        headers: { host: "evil.example", "x-forwarded-host": "evil.example" },
      });
      expect(answer.status).toBe(202);
      expect(answer.body).toEqual({});
      expect(answer.headers.get("cache-control")).toBe("no-store");

      const captured = await world.tokenMailTo(shopper.email);
      expect(captured.link).toBe(`${LINK_ORIGIN}/uk/account/reset-password#t=${captured.token}`);
      expect(captured.mail.message.html).toContain(
        `href="${LINK_ORIGIN}/uk/account/reset-password#t=${captured.token}"`,
      );
      expect(captured.mail.message.html).not.toContain("evil.example");
      expect(captured.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(captured.mail.message.subject).toContain("Відновлення пароля");

      const [token] = await world.tokenRows(shopper.id);
      expect(token).toMatchObject({
        purpose: "password_reset",
        email: shopper.email,
        used_at: null,
        token_hash: sha256(captured.token),
      });
      expect(token?.expires_at.getTime()).toBe(
        world.clock.now().getTime() + AUTH_TOKEN_LIFETIME_MINUTES.password_reset * MINUTE,
      );
      const [outbox] = await world.outboxRows(shopper.id);
      expect(outbox).toMatchObject({
        template_key: "customer.password_reset",
        locale: "uk",
        variables: { tokenId: token?.id },
        dedupe_key: null,
      });
      expect((outbox?.deadline_at as Date).getTime()).toBe(token?.expires_at.getTime());
    });

    it("answers byte-identical bodies and headers for an existing, an unknown, an inactive and a locked account; only the active ones get mail", async () => {
      const active = await world.customer();
      const inactive = await world.customer({ isActive: false });
      const locked = await world.customer();
      await world.pool.query(
        "update customer set failed_login_count = 5, locked_until = $2 where id = $1",
        [locked.id, new Date(world.clock.now().getTime() + 15 * MINUTE)],
      );
      const unknown = "nobody-here@example.test";
      const answers = [];
      for (const email of [active.email, unknown, inactive.email, locked.email]) {
        const result = await http(world.baseUrl, "POST", RESET, { body: { email, locale: "en" } });
        const raw = await fetch(`${world.baseUrl}${RESET}`, {
          method: "POST",
          headers: { "x-fluxkit-csrf": "1", "content-type": "application/json" },
          body: JSON.stringify({ email, locale: "en" }),
        });
        answers.push({
          status: result.status,
          headers: stableHeaders(result.headers),
          bytes: await raw.text(),
          rawStatus: raw.status,
          rawHeaders: stableHeaders(raw.headers),
        });
      }
      for (const answer of answers) {
        expect(answer).toEqual(answers[0]);
      }
      expect(answers[0]).toMatchObject({ status: 202, bytes: "{}", rawStatus: 202 });

      await world.waitForMails(active.email, 2);
      await world.waitForMails(locked.email, 2);
      // Give an (unexpected) mail for the others time to show up.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(world.mailsTo(unknown)).toEqual([]);
      expect(world.mailsTo(inactive.email)).toEqual([]);
      expect(await world.tokenRows(inactive.id)).toEqual([]);
    });

    it("answers no sooner than the 400 ms floor, for an unknown and an existing account alike", async () => {
      const shopper = await world.customer();
      const timings: Record<"known" | "unknown", number[]> = { known: [], unknown: [] };
      for (let round = 0; round < 6; round += 1) {
        world.clock.advanceMinutes(61);
        for (const [kind, email] of [
          ["known", shopper.email],
          ["unknown", `nobody-${String(round)}@example.test`],
        ] as const) {
          const started = performance.now();
          const result = await world.requestReset(email);
          timings[kind].push(performance.now() - started);
          expect(result.status).toBe(202);
        }
      }
      const median = (values: number[]) => [...values].sort((a, b) => a - b)[3] ?? 0;
      for (const value of [...timings.known, ...timings.unknown]) {
        expect(value).toBeGreaterThanOrEqual(395);
      }
      // The floor hides the extra work (lock, count, two inserts) of the existing account.
      expect(Math.abs(median(timings.known) - median(timings.unknown))).toBeLessThan(60);
    });

    it("answers at the floor while another transaction holds the customer's row lock (review F1): that request mails nothing", async () => {
      const shopper = await world.customer();
      const holder = await world.pool.connect();
      try {
        await holder.query("begin");
        await holder.query("select id from customer where id = $1 for update", [shopper.id]);
        // Without a bounded wait the existing address would answer when the lock is given back, the unknown one at the floor.
        const release = setTimeout(() => void holder.query("rollback"), 1_500);
        const timings: Record<"known" | "unknown", number> = { known: 0, unknown: 0 };
        for (const [kind, email] of [
          ["known", shopper.email],
          ["unknown", "nobody-while-locked@example.test"],
        ] as const) {
          const started = performance.now();
          const result = await world.requestReset(email);
          timings[kind] = performance.now() - started;
          expect(result.status).toBe(202);
          expect(result.body).toEqual({});
        }
        clearTimeout(release);
        await holder.query("rollback");
        for (const value of [timings.known, timings.unknown]) {
          expect(value).toBeGreaterThanOrEqual(395);
          expect(value).toBeLessThan(PASSWORD_RESET_ANSWER_FLOOR_MS + 150);
        }
        expect(Math.abs(timings.known - timings.unknown)).toBeLessThan(100);
      } finally {
        holder.release();
      }
      expect(await world.tokenRows(shopper.id)).toEqual([]);
      // With the lock given back the next request issues the link as usual.
      expect((await world.requestReset(shopper.email)).status).toBe(202);
      await world.waitForMails(shopper.email, 1);
      expect(await world.tokenRows(shopper.id)).toHaveLength(1);
    });

    it("gives one customer at most 3 links an hour (counted in the database): the 4th request answers the same 202 and sends nothing", async () => {
      const shopper = await world.customer();
      for (let request = 1; request <= 4; request += 1) {
        const answer = await world.requestReset(shopper.email);
        expect(answer.status, `request ${String(request)}`).toBe(202);
        expect(answer.body).toEqual({});
      }
      await world.waitForMails(shopper.email, 3);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(world.mailsTo(shopper.email)).toHaveLength(3);
      const rows = await world.tokenRows(shopper.id);
      expect(rows).toHaveLength(3);
      // A newer token invalidates the older ones: exactly one is unused.
      expect(rows.filter((row) => row.used_at === null)).toHaveLength(1);
      world.clock.advanceMinutes(61);
      expect((await world.requestReset(shopper.email)).status).toBe(202);
      expect(await world.tokenRows(shopper.id)).toHaveLength(4);
    });

    it("serializes concurrent requests of one customer on the row lock: no unique-index collision, at most 3 tokens, one unused", async () => {
      for (let round = 0; round < 3; round += 1) {
        const shopper = await world.customer();
        // 5: the per-email window allows 5 in 15 minutes.
        const answers = await Promise.all(
          Array.from({ length: 5 }, () => world.requestReset(shopper.email)),
        );
        expect(answers.map((answer) => answer.status)).toEqual(Array(5).fill(202));
        const rows = await world.tokenRows(shopper.id);
        expect(rows).toHaveLength(3);
        expect(rows.filter((row) => row.used_at === null)).toHaveLength(1);
        world.clock.advanceMinutes(61);
      }
    });

    it("allows 5 requests per requested email in 15 minutes, existing or not, then the same 429 for both", async () => {
      const shopper = await world.customer();
      const refusals = [];
      for (const email of [shopper.email, "no-account-for-this@example.test"]) {
        for (let request = 0; request < 5; request += 1) {
          const answer = await world.requestReset(request % 2 === 0 ? email : email.toUpperCase());
          expect(answer.status, `${email} request ${String(request)}`).toBe(202);
        }
        const refused = await world.requestReset(email);
        expect(refused.status).toBe(429);
        refusals.push({ body: refused.body, retryAfter: refused.headers.get("retry-after") });
      }
      expect(refusals[1]).toEqual(refusals[0]);
      // The database count let only 3 of the 5 through for the existing account.
      expect(await world.tokenRows(shopper.id)).toHaveLength(3);
    });

    it("refuses a malformed email or a locale that is not configured with 400, before any lookup", async () => {
      const shopper = await world.customer();
      const cases = [
        [{ email: "not an email", locale: "en" }, "email"],
        [{ email: `${shopper.email}\r\nBcc: victim@example.org`, locale: "en" }, "email"],
        [{ email: `a@b.test, ${shopper.email}`, locale: "en" }, "email"],
        [{ email: shopper.email, locale: "fr" }, "locale"],
        [{ email: shopper.email, locale: "en\r\nBcc: victim@example.org" }, "locale"],
        [{ email: shopper.email, locale: "../../en" }, "locale"],
      ] as const;
      for (const [body, path] of cases) {
        const answer = await world.post<ProblemBody>(RESET, body);
        expect(answer.status, JSON.stringify(body)).toBe(400);
        expect(answer.body.code).toBe("validation_failed");
        expect(answer.body.errors?.map((error) => error.path)).toContain(path);
      }
      for (const body of [
        { email: shopper.email },
        { email: shopper.email, locale: "en", admin: true },
        { email: shopper.email, locale: "x".repeat(36) },
        { email: [shopper.email], locale: "en" },
      ]) {
        expect((await world.post(RESET, body)).status, JSON.stringify(body)).toBe(400);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(world.provider.sent).toEqual([]);
      expect(await world.tokenRows(shopper.id)).toEqual([]);
    });

    it("requires the CSRF header and a JSON body like every store write", async () => {
      const shopper = await world.customer();
      const noHeader = await world.post<ProblemBody>(
        RESET,
        { email: shopper.email, locale: "en" },
        { csrf: false },
      );
      expect(noHeader.status).toBe(403);
      const form = await world.post<ProblemBody>(RESET, undefined, {
        rawBody: `email=${encodeURIComponent(shopper.email)}&locale=en`,
        contentType: "application/x-www-form-urlencoded",
      });
      expect(form.status).toBe(403);
      for (const path of [
        CONFIRM,
        "/store/account/verify-email",
        "/store/account/verify-email/resend",
      ]) {
        expect((await world.post(path, {}, { csrf: false })).status, path).toBe(403);
      }
      expect(await world.tokenRows(shopper.id)).toEqual([]);
    });

    it("keeps the same 202 when the immediate send attempt fails or hangs; job 9 retries the mail later", async () => {
      const shopper = await world.customer();
      world.provider.failNext({ throws: true });
      const thrown = await world.requestReset(shopper.email);
      // The first plan must be used by the first attempt before the second plan replaces it.
      for (let wait = 0; wait < 200 && world.provider.calls.length < 1; wait += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      world.provider.failNext({ hang: true });
      world.clock.advanceMinutes(1);
      const hung = await world.requestReset(shopper.email);
      for (const answer of [thrown, hung]) {
        expect(answer.status).toBe(202);
        expect(answer.body).toEqual({});
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(world.provider.calls).toHaveLength(2);
      expect(world.provider.sent).toEqual([]);
      const rows = await world.outboxRows(shopper.id);
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row["status"])).toEqual(["pending", "pending"]);
    });
  });

  describe("per-address and per-email limits", () => {
    let limited: AccountEmailWorld;

    beforeAll(async () => {
      limited = await AccountEmailWorld.start();
    });

    afterAll(async () => {
      await limited.stop();
    });

    it("allows 5 requests per client address in 15 minutes, then 429 with Retry-After for any email", async () => {
      for (let request = 0; request < 5; request += 1) {
        expect((await limited.requestReset(`someone-${String(request)}@example.test`)).status).toBe(
          202,
        );
      }
      const refused = await limited.requestReset("someone-else@example.test");
      expect(refused.status).toBe(429);
      expect(refused.headers.get("retry-after")).toBe(String(15 * 60));
      limited.clock.advanceMinutes(16);
      expect((await limited.requestReset("someone-else@example.test")).status).toBe(202);
    });
  });

  describe("confirm", () => {
    it("sets the new password, clears the lockout, ends EVERY session, consumes the token and mails the notice; no session is created", async () => {
      const shopper = await world.customer();
      const first = await customerLoginCookie(world.baseUrl, shopper.email, ACCOUNT_PASSWORD);
      const second = await customerLoginCookie(world.baseUrl, shopper.email, ACCOUNT_PASSWORD);
      await world.pool.query(
        "update customer set failed_login_count = 5, locked_until = $2 where id = $1",
        [shopper.id, new Date(world.clock.now().getTime() + 15 * MINUTE)],
      );
      await world.requestReset(shopper.email);
      const { token } = await world.tokenMailTo(shopper.email);

      const confirmed = await world.confirmReset(token);
      expect(confirmed.status).toBe(204);
      expect(confirmed.headers.getSetCookie()).toEqual([]);
      expect(confirmed.headers.get("cache-control")).toBe("no-store");

      for (const cookie of [first, second]) {
        const me = await http(world.baseUrl, "GET", "/store/account/me", { headers: { cookie } });
        expect(me.status).toBe(401);
      }
      const row = await world.customerRow(shopper.id);
      expect(row).toMatchObject({ failed_login_count: 0, locked_until: null });
      expect(row["password_changed_at"]).toEqual(world.clock.now());
      expect((await customerLogin(world.baseUrl, shopper.email, ACCOUNT_PASSWORD)).status).toBe(
        401,
      );
      expect((await customerLogin(world.baseUrl, shopper.email, NEW_PASSWORD)).status).toBe(200);
      const [tokenRow] = await world.tokenRows(shopper.id);
      expect(tokenRow?.used_at).toEqual(world.clock.now());

      const mails = await world.waitForMails(shopper.email, 2);
      const notice = mails[1]?.mail.message;
      expect(notice?.subject).toContain("Ваш пароль");
      expect(notice?.text).not.toContain("#t=");
      const outbox = await world.outboxRows(shopper.id);
      expect(
        outbox
          .map((message) => [message["template_key"], message["variables"]])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ).toEqual([
        ["customer.password_changed", {}],
        ["customer.password_reset", { tokenId: tokenRow?.id }],
      ]);
    });

    it("answers one generic 400 for a used, an unknown, a malformed and a replaced token", async () => {
      const shopper = await world.customer();
      await world.requestReset(shopper.email);
      const older = (await world.tokenMailTo(shopper.email)).token;
      world.clock.advanceMinutes(1);
      await world.requestReset(shopper.email);
      const newer = (await world.tokenMailTo(shopper.email, 2)).token;
      expect(newer).not.toBe(older);

      const replaced = await world.confirmReset(older);
      expect((await world.confirmReset(newer)).status).toBe(204);
      const used = await world.confirmReset(newer, "yet another long passphrase");
      const unknown = await world.confirmReset("A".repeat(43));
      const malformed = await world.confirmReset("not-a-token");
      const answers = [replaced, used, unknown, malformed];
      for (const answer of answers) {
        expect(answer.status).toBe(400);
        expect(answer.body).toEqual(replaced.body);
      }
      expect(replaced.body).toMatchObject({
        code: "validation_failed",
        errors: [{ path: "token", code: "invalid_or_expired" }],
      });
    });

    it("works until the token's expiry and not at it (the boundary is exclusive)", async () => {
      const shopper = await world.customer();
      const issuedAt = world.clock.now().getTime();
      await world.requestReset(shopper.email);
      const { token } = await world.tokenMailTo(shopper.email);
      world.clock.set(new Date(issuedAt + AUTH_TOKEN_LIFETIME_MINUTES.password_reset * MINUTE));
      const atExpiry = await world.confirmReset(token);
      expect(atExpiry.status).toBe(400);
      world.clock.set(new Date(issuedAt + AUTH_TOKEN_LIFETIME_MINUTES.password_reset * MINUTE - 1));
      expect((await world.confirmReset(token)).status).toBe(204);
    });

    it("refuses a token of the other purpose, a token of a deactivated customer and a token sent to an address the account no longer has", async () => {
      // A verification token (issued at registration) is not a reset token.
      const registered = await world.post<{ customer: { id: string } }>("/store/account/register", {
        email: "verify-then-reset@example.test",
        password: ACCOUNT_PASSWORD,
        firstName: "Wrong",
        lastName: "Purpose",
      });
      expect(registered.status).toBe(201);
      world.customers.push(registered.body.customer.id);
      const verification = await world.tokenMailTo("verify-then-reset@example.test");
      const wrongPurpose = await world.confirmReset(verification.token);
      expect(wrongPurpose.status).toBe(400);

      const deactivated = await world.customer();
      await world.requestReset(deactivated.email);
      const deactivatedToken = (await world.tokenMailTo(deactivated.email)).token;
      await world.pool.query("update customer set is_active = false where id = $1", [
        deactivated.id,
      ]);
      expect((await world.confirmReset(deactivatedToken)).status).toBe(400);

      const moved = await world.customer();
      await world.requestReset(moved.email);
      const movedToken = (await world.tokenMailTo(moved.email)).token;
      await world.pool.query("update customer set email = $2 where id = $1", [
        moved.id,
        `moved-${moved.email}`,
      ]);
      const changed = await world.confirmReset(movedToken);
      expect(changed.status).toBe(400);
      expect(changed.body).toEqual(wrongPurpose.body);
      expect(
        (await customerLogin(world.baseUrl, `moved-${moved.email}`, ACCOUNT_PASSWORD)).status,
      ).toBe(200);
    });

    it("applies the registration password policy to the new password and keeps the token usable", async () => {
      const shopper = await world.customer();
      await world.requestReset(shopper.email);
      const { token } = await world.tokenMailTo(shopper.email);
      for (const newPassword of ["short", shopper.email]) {
        const refused = await world.confirmReset(token, newPassword);
        expect(refused.status).toBe(400);
        expect((refused.body as ProblemBody).errors?.[0]?.path).toBe("newPassword");
      }
      expect((await world.confirmReset(token)).status).toBe(204);
    });

    it("lets exactly one of two concurrent confirmations with the same token win", async () => {
      for (let round = 0; round < 5; round += 1) {
        const shopper = await world.customer();
        await world.requestReset(shopper.email);
        const { token } = await world.tokenMailTo(shopper.email);
        const answers = await Promise.all([
          world.confirmReset(token, "first concurrent passphrase"),
          world.confirmReset(token, "second concurrent passphrase"),
        ]);
        expect(answers.map((answer) => answer.status).sort()).toEqual([204, 400]);
        world.provider.reset();
        world.clock.advanceMinutes(61);
      }
    });

    it("a password change in the account ends the reset links still out", async () => {
      const shopper = await world.customer();
      await world.requestReset(shopper.email);
      const { token } = await world.tokenMailTo(shopper.email);
      const cookie = await customerLoginCookie(world.baseUrl, shopper.email, ACCOUNT_PASSWORD);
      const changed = await http(world.baseUrl, "POST", "/store/account/change-password", {
        body: { currentPassword: ACCOUNT_PASSWORD, newPassword: NEW_PASSWORD },
        headers: { cookie },
      });
      expect(changed.status).toBe(204);
      expect((await world.confirmReset(token, "a third long passphrase")).status).toBe(400);
    });

    it("allows 10 confirmations per client address in 10 minutes (shared with verify-email), then 429", async () => {
      const limited = await AccountEmailWorld.start();
      try {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          expect((await limited.confirmReset("B".repeat(43))).status).toBe(400);
          expect((await limited.verify("C".repeat(43))).status).toBe(400);
        }
        const refused = await limited.confirmReset("B".repeat(43));
        expect(refused.status).toBe(429);
        expect((await limited.verify("C".repeat(43))).status).toBe(429);
      } finally {
        await limited.stop();
      }
    });
  });
});
