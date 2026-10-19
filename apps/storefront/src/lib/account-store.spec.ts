import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccountStore } from "./account-store";
import { createSessionStores } from "./session-stores";
import { customer } from "./test-fixtures";
import { immediateClient, json, problem, settle, stagedClient } from "./test-fetch";

afterEach(() => vi.restoreAllMocks());

const ada = customer();

function storeWith(client: ReturnType<typeof stagedClient>["client"], onSessionChanged = vi.fn()) {
  return { store: createAccountStore({ client, onSessionChanged }), onSessionChanged };
}

describe("account store: the session read", () => {
  it("reads /store/account/me once, uncached, and is signed in with the customer for 200", async () => {
    const { client, calls } = stagedClient();
    const { store } = storeWith(client);
    expect(store.getState().session).toEqual({ status: "loading" });
    store.start();
    store.start();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/store/account/me");
    expect(calls[0]?.init.cache).toBe("no-store");
    calls[0]?.answer(json({ customer: ada }));
    await settle();
    expect(store.getState().session).toEqual({ status: "signedIn", customer: ada });
  });

  it("treats 401 as a guest and logs nothing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, calls } = stagedClient();
    const { store } = storeWith(client);
    store.start();
    calls[0]?.answer(problem(401, "unauthorized"));
    await settle();
    expect(store.getState().session).toEqual({ status: "guest" });
    expect(error).not.toHaveBeenCalled();
  });

  it("is an error state for any other failure and logs the status and code only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, calls } = stagedClient();
    const { store } = storeWith(client);
    store.start();
    calls[0]?.answer(problem(500, "internal_error"));
    await settle();
    expect(store.getState().session).toEqual({ status: "error" });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("500 internal_error");
    void store.refresh();
    calls[1]?.answer(json({ customer: ada }));
    await settle();
    expect(store.getState().session.status).toBe("signedIn");
  });

  it("does not let a slow session read overwrite a sign-in that finished after it started", async () => {
    const { client, calls } = stagedClient();
    const { store } = storeWith(client);
    store.start();
    const pending = store.login({ email: "a@b.test", password: "correct horse battery" });
    calls[1]?.answer(json({ customer: ada, cartNotices: [] }));
    await pending;
    calls[0]?.answer(problem(401, "unauthorized"));
    await settle();
    expect(store.getState().session).toEqual({ status: "signedIn", customer: ada });
  });
});

describe("account store: login and register", () => {
  const credentials = { email: "a@b.test", password: "correct horse battery" };

  it("posts the credentials with the CSRF header and signs in; the password is only in the body", async () => {
    const { client, calls } = immediateClient(() => json({ customer: ada, cartNotices: [] }));
    const { store, onSessionChanged } = storeWith(client);
    const outcome = await store.login(credentials);
    expect(outcome).toMatchObject({ status: "ok", value: { customer: ada, cartNotices: [] } });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "/store/account/login",
      body: credentials,
    });
    expect(calls[0]?.headers.get("X-Fluxkit-CSRF")).toBe("1");
    expect(calls[0]?.init.cache).toBe("no-store");
    expect(calls[0]?.url).not.toContain("correct");
    expect(store.getState().session).toEqual({ status: "signedIn", customer: ada });
    expect(onSessionChanged).toHaveBeenCalledTimes(1);
  });

  it("never keeps the password in the state, in a log or in the error it returns", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const failing = immediateClient(() => problem(401, "unauthorized"));
    const { store } = storeWith(failing.client);
    const outcome = await store.login(credentials);
    for (const text of [JSON.stringify(store.getState()), JSON.stringify(outcome)]) {
      expect(text).not.toContain("correct horse");
    }
    for (const spy of [error, warn, log]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("correct horse");
    }
  });

  it("shows the cart notices of a sign-in once: kept until dismissed, replaced by the next sign-in", async () => {
    const answers = [
      { customer: ada, cartNotices: [{ code: "quantity_capped" }, { code: "lines_dropped" }] },
      { customer: ada, cartNotices: [] },
    ];
    const { client } = immediateClient(() => json(answers.shift()));
    const { store } = storeWith(client);
    await store.login(credentials);
    expect(store.getState().cartNotices).toEqual([
      { code: "quantity_capped" },
      { code: "lines_dropped" },
    ]);
    store.dismissCartNotices();
    expect(store.getState().cartNotices).toEqual([]);
    await store.login(credentials);
    expect(store.getState().cartNotices).toEqual([]);
  });

  it("registers with the names and the optional phone, and keeps the notices like a login", async () => {
    const { client, calls } = immediateClient(() =>
      json({ customer: ada, cartNotices: [{ code: "lines_dropped" }] }, 201),
    );
    const { store, onSessionChanged } = storeWith(client);
    const outcome = await store.register({
      email: "a@b.test",
      password: "correct horse battery",
      firstName: "Ada",
      lastName: "Shopper",
    });
    expect(outcome.status).toBe("ok");
    expect(calls[0]).toMatchObject({ method: "POST", url: "/store/account/register" });
    expect(store.getState().cartNotices).toEqual([{ code: "lines_dropped" }]);
    expect(store.getState().session.status).toBe("signedIn");
    expect(onSessionChanged).toHaveBeenCalledTimes(1);
  });

  it("answers a failed sign-in with ONE message that names neither the email nor the password, and changes nothing", async () => {
    const { client } = immediateClient(() =>
      problem(401, "unauthorized", {
        errors: [{ path: "password", code: "incorrect" }],
        field: "password",
      }),
    );
    const { store, onSessionChanged } = storeWith(client);
    store.start();
    await settle();
    const outcome = await store.login(credentials);
    expect(outcome).toMatchObject({
      status: "failed",
      failure: { messageKey: "account.login.invalid", fieldErrors: [], status: 401 },
    });
    expect(store.getState().cartNotices).toEqual([]);
    expect(onSessionChanged).not.toHaveBeenCalled();
    expect(store.getState().session.status).not.toBe("signedIn");
  });

  it("shows the wait of a 429 from Retry-After", async () => {
    const { client } = immediateClient(() =>
      problem(429, "too_many_requests", {}, { "Retry-After": "600" }),
    );
    const { store } = storeWith(client);
    expect(await store.login(credentials)).toMatchObject({
      status: "failed",
      failure: { messageKey: "errors.too_many_requests", retryAfterSeconds: 600 },
    });
  });

  it("maps register validation errors to fields and a taken email to the email field", async () => {
    const answers = [
      problem(400, "validation_failed", {
        errors: [
          { path: "password", code: "too_short" },
          { path: "firstName", code: "empty" },
        ],
      }),
      problem(409, "conflict", { field: "email" }),
    ];
    const { client } = immediateClient(() => answers.shift() as Response);
    const { store, onSessionChanged } = storeWith(client);
    const body = { email: "a@b.test", password: "x", firstName: "", lastName: "S" };
    const invalid = await store.register(body);
    expect(invalid).toMatchObject({
      status: "failed",
      failure: {
        fieldErrors: [
          { path: "password", messageKey: "errors.field.too_short" },
          { path: "firstName", messageKey: "errors.field.empty" },
        ],
      },
    });
    const taken = await store.register(body);
    expect(taken).toMatchObject({
      status: "failed",
      failure: {
        fieldErrors: [
          { path: "email", code: "conflict", messageKey: "account.register.emailTaken" },
        ],
      },
    });
    expect(onSessionChanged).not.toHaveBeenCalled();
  });

  it("sends a double submit once: the second call joins the request in flight", async () => {
    const { client, calls } = stagedClient();
    const { store, onSessionChanged } = storeWith(client);
    const first = store.login(credentials);
    const second = store.login(credentials);
    expect(calls).toHaveLength(1);
    calls[0]?.answer(json({ customer: ada, cartNotices: [] }));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(onSessionChanged).toHaveBeenCalledTimes(1);
    // Once the first request has ended, a new submit is a new request.
    const third = store.login(credentials);
    expect(calls).toHaveLength(2);
    calls[1]?.answer(json({ customer: ada, cartNotices: [] }));
    await third;
  });

  it("reports a network failure as a translated failure", async () => {
    const { client, calls } = stagedClient();
    const { store } = storeWith(client);
    const pending = store.login(credentials);
    calls[0]?.fail(new TypeError("fetch failed"));
    expect(await pending).toMatchObject({
      status: "failed",
      failure: { messageKey: "errors.network" },
    });
  });
});

describe("account store: logout", () => {
  it("posts to logout, becomes a guest, drops the notices and tells the cart to reload", async () => {
    const answers = [
      json({ customer: ada, cartNotices: [{ code: "lines_dropped" }] }),
      new Response(null, { status: 204 }),
    ];
    const { client, calls } = immediateClient(() => answers.shift() as Response);
    const { store, onSessionChanged } = storeWith(client);
    await store.login({ email: "a@b.test", password: "x" });
    onSessionChanged.mockClear();
    const outcome = await store.logout();
    expect(outcome.status).toBe("ok");
    expect(calls[1]).toMatchObject({ method: "POST", url: "/store/account/logout" });
    expect(calls[1]?.headers.get("X-Fluxkit-CSRF")).toBe("1");
    expect(store.getState()).toMatchObject({ session: { status: "guest" }, cartNotices: [] });
    expect(onSessionChanged).toHaveBeenCalledTimes(1);
  });

  it("is a guest after a 401 (the session was already gone) and still reloads the cart", async () => {
    const { client } = immediateClient(() => problem(401, "unauthorized"));
    const { store, onSessionChanged } = storeWith(client);
    expect((await store.logout()).status).toBe("ok");
    expect(store.getState().session).toEqual({ status: "guest" });
    expect(onSessionChanged).toHaveBeenCalledTimes(1);
  });

  it("stays signed in and says so when the request fails", async () => {
    const { client, calls } = stagedClient();
    const { store, onSessionChanged } = storeWith(client);
    const login = store.login({ email: "a@b.test", password: "x" });
    calls[0]?.answer(json({ customer: ada, cartNotices: [] }));
    await login;
    onSessionChanged.mockClear();
    const pending = store.logout();
    calls[1]?.fail(new TypeError("fetch failed"));
    expect(await pending).toMatchObject({
      status: "failed",
      failure: { messageKey: "errors.network" },
    });
    expect(store.getState().session.status).toBe("signedIn");
    expect(onSessionChanged).not.toHaveBeenCalled();
  });
});

describe("account store: profile and password", () => {
  async function signedIn(handler: Parameters<typeof immediateClient>[0]) {
    const answers = [json({ customer: ada, cartNotices: [] })];
    const { client, calls } = immediateClient((call) =>
      answers.length > 0 ? (answers.shift() as Response) : handler(call),
    );
    const { store } = storeWith(client);
    await store.login({ email: "a@b.test", password: "x" });
    return { store, calls };
  }

  it("changes the profile with PATCH, sending only what was given, and shows the saved customer", async () => {
    const saved = customer({ firstName: "Grace", phone: "+380501234567" });
    const { store, calls } = await signedIn(() => json({ customer: saved }));
    const outcome = await store.updateProfile({ firstName: "Grace", phone: "+380501234567" });
    expect(outcome).toMatchObject({ status: "ok", value: saved });
    expect(calls[1]).toMatchObject({
      method: "PATCH",
      url: "/store/account/me",
      body: { firstName: "Grace", phone: "+380501234567" },
    });
    expect(store.getState().session).toEqual({ status: "signedIn", customer: saved });
  });

  it("can remove the phone with null", async () => {
    const { store, calls } = await signedIn(() => json({ customer: ada }));
    await store.updateProfile({ phone: null });
    expect(calls[1]?.body).toEqual({ phone: null });
  });

  it("maps profile validation errors to fields and keeps the old customer", async () => {
    const { store } = await signedIn(() =>
      problem(400, "validation_failed", { errors: [{ path: "phone", code: "invalid_format" }] }),
    );
    expect(await store.updateProfile({ phone: "abc" })).toMatchObject({
      status: "failed",
      failure: { fieldErrors: [{ path: "phone", messageKey: "errors.field.invalid_format" }] },
    });
    expect(store.getState().session).toEqual({ status: "signedIn", customer: ada });
  });

  it("becomes a guest when a protected call answers 401 (the session ended)", async () => {
    const { store } = await signedIn(() => problem(401, "unauthorized"));
    expect((await store.updateProfile({ firstName: "G" })).status).toBe("signedOut");
    expect(store.getState().session).toEqual({ status: "guest" });
  });

  it("changes the password with both passwords in the body only and stays signed in", async () => {
    const { store, calls } = await signedIn(() => new Response(null, { status: 204 }));
    const outcome = await store.changePassword({
      currentPassword: "old password value",
      newPassword: "new password value!",
    });
    expect(outcome.status).toBe("ok");
    expect(calls[1]).toMatchObject({
      method: "POST",
      url: "/store/account/change-password",
      body: { currentPassword: "old password value", newPassword: "new password value!" },
    });
    expect(calls[1]?.url).not.toContain("password value");
    expect(store.getState().session.status).toBe("signedIn");
    expect(JSON.stringify(store.getState())).not.toContain("password value");
  });

  it("maps a wrong current password and a weak new one to their fields", async () => {
    const { store } = await signedIn(() =>
      problem(400, "validation_failed", {
        errors: [
          { path: "currentPassword", code: "incorrect" },
          { path: "newPassword", code: "same_as_current" },
        ],
      }),
    );
    expect(await store.changePassword({ currentPassword: "a", newPassword: "b" })).toMatchObject({
      status: "failed",
      failure: {
        fieldErrors: [
          { path: "currentPassword", messageKey: "errors.field.incorrect" },
          { path: "newPassword", messageKey: "errors.field.same_as_current" },
        ],
      },
    });
  });
});

describe("account store: sessionEnded (another route answered 401, the order pages)", () => {
  it("makes the store a guest, drops the notices, and is not undone by an older read", async () => {
    const { client, calls } = stagedClient();
    const { store } = storeWith(client);
    store.start();
    store.sessionEnded();
    expect(store.getState()).toEqual({ session: { status: "guest" }, cartNotices: [] });
    calls[0]?.answer(json({ customer: ada }));
    await settle();
    expect(store.getState().session).toEqual({ status: "guest" });
  });
});

describe("session stores wired together", () => {
  it("reloads the cart (the header badge) after logout, after a login and after a register", async () => {
    const { client, calls } = immediateClient((call) => {
      if (call.url.startsWith("/store/cart")) return json({ lines: [], itemCount: 0 });
      if (call.url.endsWith("/logout")) return new Response(null, { status: 204 });
      return json({ customer: ada, cartNotices: [] }, call.url.endsWith("/register") ? 201 : 200);
    });
    const { cart, account } = createSessionStores({
      client,
      locale: "uk",
      events: new EventTarget(),
    });
    const cartReads = () => calls.filter((call) => call.url.startsWith("/store/cart")).length;
    await account.login({ email: "a@b.test", password: "x" });
    await settle();
    expect(cartReads()).toBe(1);
    await account.logout();
    await settle();
    expect(cartReads()).toBe(2);
    await account.register({ email: "a@b.test", password: "x", firstName: "A", lastName: "B" });
    await settle();
    expect(cartReads()).toBe(3);
    expect(cart.getState().status).toBe("ready");
  });

  it("does not reload the cart when a sign-in fails", async () => {
    const { client, calls } = immediateClient(() => problem(401, "unauthorized"));
    const { account } = createSessionStores({ client, locale: "uk", events: new EventTarget() });
    await account.login({ email: "a@b.test", password: "x" });
    await settle();
    expect(calls.filter((call) => call.url.startsWith("/store/cart"))).toHaveLength(0);
  });
});
