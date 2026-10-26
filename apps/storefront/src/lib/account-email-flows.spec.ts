import { describe, expect, it } from "vitest";
import { createAccountEmailFlows } from "./account-email-flows";
import { immediateClient, json, problem, settle, stagedClient } from "./test-fetch";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
const noContent = () => new Response(null, { status: 204 });

describe("password reset request: the neutral answer", () => {
  it("sends {email, locale} to the reset route and is `sent` for 202", async () => {
    const { client, calls } = immediateClient(() => json({}, 202));
    const flows = createAccountEmailFlows(client);
    expect(await flows.requestPasswordReset({ email: "ada@example.test", locale: "uk" })).toEqual({
      status: "sent",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/store/account/password-reset");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({ email: "ada@example.test", locale: "uk" });
  });

  it("gives the identical outcome whatever the body or headers of an accepted answer say (nothing about the account is read)", async () => {
    const bodies = [{}, { sent: true }, { exists: false }, { account: "found" }];
    const outcomes = [];
    for (const body of bodies) {
      const { client } = immediateClient(
        () =>
          new Response(JSON.stringify(body), {
            status: 202,
            headers: { "Content-Type": "application/json", "X-Anything": String(body) },
          }),
      );
      outcomes.push(
        await createAccountEmailFlows(client).requestPasswordReset({
          email: "someone@example.test",
          locale: "en",
        }),
      );
    }
    for (const outcome of outcomes) expect(outcome).toEqual({ status: "sent" });
  });

  it("is `unavailable` for 404 (no mail provider: the same for every address)", async () => {
    const { client } = immediateClient(() => problem(404, "not_found"));
    expect(
      await createAccountEmailFlows(client).requestPasswordReset({
        email: "a@b.test",
        locale: "en",
      }),
    ).toEqual({ status: "unavailable" });
  });

  it("maps 429 to a failure with the wait, 400 to a field error on email, and a network error to a retryable failure", async () => {
    const limited = immediateClient(() =>
      problem(429, "too_many_requests", {}, { "Retry-After": "30" }),
    );
    const tooMany = await createAccountEmailFlows(limited.client).requestPasswordReset({
      email: "a@b.test",
      locale: "en",
    });
    expect(tooMany).toMatchObject({
      status: "failed",
      failure: { status: 429, retryAfterSeconds: 30, messageKey: "errors.too_many_requests" },
    });

    const invalid = immediateClient(() =>
      problem(400, "validation_failed", { errors: [{ path: "email", code: "invalid_format" }] }),
    );
    const bad = await createAccountEmailFlows(invalid.client).requestPasswordReset({
      email: "nope",
      locale: "en",
    });
    expect(bad).toMatchObject({
      status: "failed",
      failure: { fieldErrors: [{ path: "email", messageKey: "errors.field.invalid_format" }] },
    });

    const offline = stagedClient();
    const attempt = createAccountEmailFlows(offline.client).requestPasswordReset({
      email: "a@b.test",
      locale: "en",
    });
    offline.calls[0]?.fail(new TypeError("fetch failed"));
    const network = await attempt;
    expect(network).toMatchObject({ status: "failed", failure: { messageKey: "errors.network" } });
  });

  it("joins a double submit to the request in flight", async () => {
    const { client, calls } = stagedClient();
    const flows = createAccountEmailFlows(client);
    const first = flows.requestPasswordReset({ email: "a@b.test", locale: "en" });
    const second = flows.requestPasswordReset({ email: "a@b.test", locale: "en" });
    expect(calls).toHaveLength(1);
    calls[0]?.answer(json({}, 202));
    expect(await first).toEqual({ status: "sent" });
    expect(await second).toEqual({ status: "sent" });
  });
});

describe("password reset confirm", () => {
  it("sends the token and the new password in the body only and is `done` for 204", async () => {
    const { client, calls } = immediateClient(noContent);
    expect(
      await createAccountEmailFlows(client).confirmPasswordReset(TOKEN, "a long new password"),
    ).toEqual({
      status: "done",
    });
    expect(calls[0]?.url).toBe("/store/account/password-reset/confirm");
    expect(calls[0]?.body).toEqual({ token: TOKEN, newPassword: "a long new password" });
    expect(calls[0]?.url).not.toContain(TOKEN);
  });

  it("is `invalid` for a 400 at `token` (every token problem), whatever its code", async () => {
    for (const code of ["invalid_or_expired", "too_long", "anything"]) {
      const { client } = immediateClient(() =>
        problem(400, "validation_failed", { errors: [{ path: "token", code }] }),
      );
      expect(
        await createAccountEmailFlows(client).confirmPasswordReset(TOKEN, "a long new password"),
        code,
      ).toEqual({
        status: "invalid",
      });
    }
  });

  it("keeps a 400 at `newPassword` as a field failure (the form stays, the token stays usable)", async () => {
    const { client } = immediateClient(() =>
      problem(400, "validation_failed", { errors: [{ path: "newPassword", code: "too_short" }] }),
    );
    expect(
      await createAccountEmailFlows(client).confirmPasswordReset(TOKEN, "short"),
    ).toMatchObject({
      status: "failed",
      failure: { fieldErrors: [{ path: "newPassword", messageKey: "errors.field.too_short" }] },
    });
  });

  it("is `unavailable` for 404 and a failure with the wait for 429", async () => {
    const missing = immediateClient(() => problem(404, "not_found"));
    expect(
      await createAccountEmailFlows(missing.client).confirmPasswordReset(
        TOKEN,
        "a long new password",
      ),
    ).toEqual({
      status: "unavailable",
    });
    const limited = immediateClient(() =>
      problem(429, "too_many_requests", {}, { "Retry-After": "12" }),
    );
    expect(
      await createAccountEmailFlows(limited.client).confirmPasswordReset(
        TOKEN,
        "a long new password",
      ),
    ).toMatchObject({
      status: "failed",
      failure: { retryAfterSeconds: 12 },
    });
  });

  it("never carries the token or the password into a failure it returns", async () => {
    const { client } = immediateClient(() => problem(500, "internal_error"));
    const outcome = await createAccountEmailFlows(client).confirmPasswordReset(
      TOKEN,
      "a long new password",
    );
    expect(JSON.stringify(outcome)).not.toContain(TOKEN);
    expect(JSON.stringify(outcome)).not.toContain("a long new password");
  });
});

describe("email verification confirm", () => {
  it("posts the token once for a page, even when asked twice (strict mode, a double effect)", async () => {
    const { client, calls } = stagedClient();
    const flows = createAccountEmailFlows(client);
    const first = flows.confirmEmail(TOKEN);
    const second = flows.confirmEmail(TOKEN);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/store/account/verify-email");
    expect(calls[0]?.body).toEqual({ token: TOKEN });
    calls[0]?.answer(noContent());
    expect(await first).toEqual({ status: "verified" });
    expect(await second).toEqual({ status: "verified" });
    // A settled success or a settled invalid link is not asked again.
    expect(await flows.confirmEmail(TOKEN)).toEqual({ status: "verified" });
    expect(calls).toHaveLength(1);
  });

  it("is `invalid` for 400 at token and remembers it for the same token", async () => {
    const { client, calls } = immediateClient(() =>
      problem(400, "validation_failed", {
        errors: [{ path: "token", code: "invalid_or_expired" }],
      }),
    );
    const flows = createAccountEmailFlows(client);
    expect(await flows.confirmEmail(TOKEN)).toEqual({ status: "invalid" });
    expect(await flows.confirmEmail(TOKEN)).toEqual({ status: "invalid" });
    expect(calls).toHaveLength(1);
  });

  it("allows a retry after a failure (429, network, 5xx) and after a different token", async () => {
    let answer = problem(429, "too_many_requests", {}, { "Retry-After": "5" });
    const { client, calls } = immediateClient(() => answer);
    const flows = createAccountEmailFlows(client);
    expect(await flows.confirmEmail(TOKEN)).toMatchObject({ status: "failed" });
    answer = noContent();
    expect(await flows.confirmEmail(TOKEN)).toEqual({ status: "verified" });
    expect(calls).toHaveLength(2);
    expect(await flows.confirmEmail(`${TOKEN}x`)).toEqual({ status: "verified" });
    expect(calls).toHaveLength(3);
  });

  it("is `unavailable` for 404", async () => {
    const { client } = immediateClient(() => problem(404, "not_found"));
    expect(await createAccountEmailFlows(client).confirmEmail(TOKEN)).toEqual({
      status: "unavailable",
    });
  });
});

describe("verification resend", () => {
  it("is `sent` for 204 and posts no body", async () => {
    const { client, calls } = immediateClient(noContent);
    expect(await createAccountEmailFlows(client).resendVerification()).toEqual({ status: "sent" });
    expect(calls[0]?.url).toBe("/store/account/verify-email/resend");
    expect(calls[0]?.body).toBeUndefined();
  });

  it("maps 409 already_verified, 404, 401 and 429", async () => {
    const cases: [Response, unknown][] = [
      [problem(409, "rule_violation", { rule: "already_verified" }), { status: "alreadyVerified" }],
      [problem(404, "not_found"), { status: "unavailable" }],
      [problem(401, "unauthorized"), { status: "signedOut" }],
    ];
    for (const [response, expected] of cases) {
      const { client } = immediateClient(() => response);
      expect(await createAccountEmailFlows(client).resendVerification()).toEqual(expected);
    }
    const { client } = immediateClient(() =>
      problem(429, "too_many_requests", {}, { "Retry-After": "60" }),
    );
    expect(await createAccountEmailFlows(client).resendVerification()).toMatchObject({
      status: "failed",
      failure: { retryAfterSeconds: 60 },
    });
  });

  it("joins a double click to the request in flight", async () => {
    const { client, calls } = stagedClient();
    const flows = createAccountEmailFlows(client);
    const first = flows.resendVerification();
    void flows.resendVerification();
    await settle();
    expect(calls).toHaveLength(1);
    calls[0]?.answer(noContent());
    expect(await first).toEqual({ status: "sent" });
  });
});
