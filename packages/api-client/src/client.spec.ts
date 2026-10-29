import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  InvalidRequestError,
  InvalidResponseError,
  NetworkError,
  OPERATIONS,
  createStoreClient,
  type CheckoutBody,
  type StoreClient,
  type StoreResult,
} from "./index.js";
import type { Cart, CheckoutResult, Order } from "./types.js";

interface Recorded {
  url: string;
  init: RequestInit & { headers: Headers };
}

/** A fake fetch that records the calls and answers with `respond`. */
function fakeFetch(respond: (call: Recorded) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const call = { url, init: init as Recorded["init"] };
    calls.push(call);
    return respond(call);
  };
  return { fetch: fetchImpl, calls };
}

const jsonOk = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const problemResponse = (status: number, extra: Record<string, unknown> = {}, headers = {}) =>
  new Response(
    JSON.stringify({
      type: "about:blank",
      title: "T",
      status,
      code: "conflict",
      detail: "D",
      ...extra,
    }),
    { status, headers: { "Content-Type": "application/problem+json", ...headers } },
  );

const EMPTY_CART: Cart = {
  lines: [],
  subtotal: { amount: 0, currency: "UAH" },
  total: { amount: 0, currency: "UAH" },
  itemCount: 0,
  purchasable: true,
  requiresShipping: false,
  notices: [],
};

const CHECKOUT_BODY: CheckoutBody = {
  phone: "+380000000000",
  firstName: "A",
  lastName: "B",
  expectedTotal: { amount: 1000, currency: "UAH" },
};
const VARIANT_ID = "6f1c1f6e-7a52-4a8a-8c7e-0d4f3a1b2c3d";

/** One call per client function; the Record type makes the compiler demand an entry for every new operation. */
const INVOCATIONS: Record<keyof StoreClient, (client: StoreClient) => Promise<unknown>> = {
  register: (c) => c.register({ email: "a@b.c", password: "pw", firstName: "A", lastName: "B" }),
  login: (c) => c.login({ email: "a@b.c", password: "pw" }),
  logout: (c) => c.logout(),
  getAccount: (c) => c.getAccount(),
  updateAccount: (c) => c.updateAccount({ firstName: "N" }),
  changePassword: (c) => c.changePassword({ currentPassword: "a", newPassword: "b" }),
  getDataExport: (c) => c.getDataExport(),
  deleteAccount: (c) => c.deleteAccount({ password: "pw", confirm: true }),
  requestPasswordReset: (c) => c.requestPasswordReset({ email: "a@b.c", locale: "uk" }),
  confirmPasswordReset: (c) => c.confirmPasswordReset({ token: "t", newPassword: "b" }),
  confirmEmailVerification: (c) => c.confirmEmailVerification({ token: "t" }),
  requestEmailVerification: (c) => c.requestEmailVerification(),
  getCart: (c) => c.getCart(),
  clearCart: (c) => c.clearCart(),
  addCartItem: (c) => c.addCartItem({ variantId: VARIANT_ID, quantity: 1 }),
  setCartItemQuantity: (c) => c.setCartItemQuantity(VARIANT_ID, { quantity: 2 }),
  removeCartItem: (c) => c.removeCartItem(VARIANT_ID),
  acknowledgeCart: (c) => c.acknowledgeCart(),
  checkout: (c) =>
    c.checkout(CHECKOUT_BODY, { idempotencyKey: "0b4c5c2e-1d2f-4c0e-9a55-3f7f2f1d9a10" }),
  lookupOrder: (c) => c.lookupOrder({ number: "FK-1", accessToken: "tok" }),
  cancelOrder: (c) => c.cancelOrder({ number: "FK-1", accessToken: "tok" }),
  listAccountOrders: (c) => c.listAccountOrders(),
  getAccountOrder: (c) => c.getAccountOrder("FK-1"),
  cancelAccountOrder: (c) => c.cancelAccountOrder("FK-1"),
  createOrderPayment: (c) =>
    c.createOrderPayment(
      { number: "FK-1", accessToken: "tok" },
      { idempotencyKey: "4f1c1f6e-7a52-4a8a-8c7e-0d4f3a1b2c3d" },
    ),
  getOrderPaymentStatus: (c) =>
    c.getOrderPaymentStatus({ number: "FK-1", accessToken: "tok", paymentId: VARIANT_ID }),
  createAccountOrderPayment: (c) =>
    c.createAccountOrderPayment(
      "FK-1",
      {},
      { idempotencyKey: "5f1c1f6e-7a52-4a8a-8c7e-0d4f3a1b2c3d" },
    ),
  getAccountOrderPayment: (c) => c.getAccountOrderPayment("FK-1", VARIANT_ID),
  listCategories: (c) => c.listCategories(),
  getConfig: (c) => c.getConfig(),
  listProducts: (c) => c.listProducts(),
  getProduct: (c) => c.getProduct("shirt"),
  searchProducts: (c) => c.searchProducts({ q: "shirt", f: ["brand:acme", "opt.size:m"] }),
  suggestProducts: (c) => c.suggestProducts("sh"),
  getShippingOptions: (c) => c.getShippingOptions({ country: "UA" }),
  listShippingCities: (c) => c.listShippingCities("nova_poshta", "Ки"),
  listShippingPickupPoints: (c) =>
    c.listShippingPickupPoints("nova_poshta", "city-1", { kinds: ["branch", "locker"] }),
};

/** A response each operation accepts: its first documented success status with a matching body. */
function successFor(name: keyof StoreClient): Response {
  const status = OPERATIONS[name].successStatuses[0];
  if (status === undefined) throw new Error("operation without success status");
  return status === 204 ? new Response(null, { status }) : jsonOk({}, status);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("every store operation", () => {
  const names = Object.keys(INVOCATIONS) as (keyof StoreClient)[];

  it("has a client function, an operation entry and an invocation", () => {
    const client = createStoreClient({ baseUrl: "", fetch: fakeFetch(() => jsonOk({})).fetch });
    expect(Object.keys(client).sort()).toEqual([...names].sort());
    expect(Object.keys(OPERATIONS).sort()).toEqual([...names].sort());
  });

  it.each(names)(
    "%s: CSRF header on writes only, content type only with a body, same-origin cookies",
    async (name) => {
      const { fetch, calls } = fakeFetch(() => successFor(name));
      const client = createStoreClient({ baseUrl: "", fetch });
      const result = (await INVOCATIONS[name](client)) as StoreResult<unknown>;
      expect(result.ok).toBe(true);

      expect(calls).toHaveLength(1);
      const { url, init } = calls[0] as Recorded;
      const operation = OPERATIONS[name];
      expect(init.method).toBe(operation.method);
      expect(url.startsWith("/store/")).toBe(true);
      expect(init.credentials).toBe("same-origin");

      const isWrite = operation.method !== "GET";
      expect(init.headers.get("X-Fluxkit-CSRF")).toBe(isWrite ? "1" : null);
      expect(init.headers.get("Content-Type")).toBe(operation.hasBody ? "application/json" : null);
      expect(init.body === undefined).toBe(!operation.hasBody);
      expect(init.headers.has("Idempotency-Key")).toBe(operation.requiresIdempotencyKey);
    },
  );

  it.each(names)(
    "%s: a network failure is thrown, not swallowed, and not retried",
    async (name) => {
      const cause = new TypeError("fetch failed");
      let attempts = 0;
      const client = createStoreClient({
        baseUrl: "",
        fetch: () => {
          attempts += 1;
          return Promise.reject(cause);
        },
      });
      const error = await INVOCATIONS[name](client).then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(NetworkError);
      expect((error as NetworkError).cause).toBe(cause);
      expect(attempts).toBe(1);
    },
  );

  it.each(names)("%s: a non-JSON success body is thrown", async (name) => {
    const status =
      OPERATIONS[name].successStatuses[0] === 204 ? 200 : OPERATIONS[name].successStatuses[0];
    const client = createStoreClient({
      baseUrl: "",
      fetch: fakeFetch(
        () =>
          new Response("<html>oops</html>", { status, headers: { "Content-Type": "text/html" } }),
      ).fetch,
    });
    await expect(INVOCATIONS[name](client)).rejects.toBeInstanceOf(InvalidResponseError);
  });
});

describe("search", () => {
  it("sends the facet selection as repeated f parameters and suggest's text as q", async () => {
    const { fetch, calls } = fakeFetch(() => jsonOk({}));
    const client = createStoreClient({ baseUrl: "", fetch });
    await client.searchProducts({
      q: "shirt",
      f: ["brand:acme", "opt.size:m", "opt.size:l"],
      price: "100..",
      sort: "price_asc",
      page: 2,
      limit: 12,
      locale: "en",
    });
    await client.suggestProducts("sh", { locale: "uk" });
    await client.searchProducts();
    expect(calls.map((call) => call.url)).toEqual([
      "/store/search?q=shirt&locale=en&f=brand%3Aacme&f=opt.size%3Am&f=opt.size%3Al&price=100..&sort=price_asc&page=2&limit=12",
      "/store/search/suggest?q=sh&locale=uk",
      "/store/search",
    ]);
  });
});

describe("URLs", () => {
  it("fills path parameters, encodes them and appends the query", async () => {
    const { fetch, calls } = fakeFetch(() => jsonOk({}));
    const client = createStoreClient({ baseUrl: "", fetch });
    await client.getProduct("a b/ü", { locale: "uk" });
    await client.listProducts({
      brand: "x&y",
      category: "shoes",
      offset: 20,
      limit: 10,
      locale: "en",
    });
    await client.setCartItemQuantity(VARIANT_ID, { quantity: 3 }, { locale: "uk" });
    await client.listAccountOrders({ limit: 5, offset: 0 });
    await client.getAccountOrder("FK 1/2");
    await client.cancelAccountOrder("FK-1", { locale: "en" });
    expect(calls.map((call) => call.url)).toEqual([
      "/store/products/a%20b%2F%C3%BC?locale=uk",
      "/store/products?brand=x%26y&category=shoes&offset=20&limit=10&locale=en",
      `/store/cart/items/${VARIANT_ID}?locale=uk`,
      "/store/account/orders?limit=5&offset=0",
      "/store/account/orders/FK%201%2F2",
      "/store/account/orders/FK-1/cancel?locale=en",
    ]);
  });

  it("uses an absolute base URL on the server", async () => {
    const { fetch, calls } = fakeFetch(() => jsonOk({}));
    await createStoreClient({ baseUrl: "http://api.internal:3000/", fetch }).getConfig();
    expect(calls[0]?.url).toBe("http://api.internal:3000/store/config");
  });

  it("rejects a bad base URL when the client is created", () => {
    expect(() => createStoreClient({ baseUrl: "http://api/store" })).toThrow(InvalidRequestError);
  });

  it("refuses an empty path parameter before any request", async () => {
    const { fetch, calls } = fakeFetch(() => jsonOk({}));
    await expect(createStoreClient({ baseUrl: "", fetch }).getProduct("")).rejects.toBeInstanceOf(
      InvalidRequestError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("payment creates", () => {
  const KEY = "0b4c5c2e-1d2f-4c0e-9a55-3f7f2f1d9a10";

  it("send the Idempotency-Key and only the documented body (never an amount)", async () => {
    const { fetch, calls } = fakeFetch(() => jsonOk({}, 201));
    const client = createStoreClient({ baseUrl: "", fetch });
    await client.createOrderPayment(
      { number: "FK-1", accessToken: "tok", locale: "en" },
      { idempotencyKey: KEY },
    );
    await client.createAccountOrderPayment("FK 1/2", {}, { idempotencyKey: KEY });
    const [guest, account] = calls as Recorded[];
    expect(guest?.url).toBe("/store/orders/payments");
    expect(guest?.init.headers.get("Idempotency-Key")).toBe(KEY);
    expect(JSON.parse(String(guest?.init.body))).toEqual({
      number: "FK-1",
      accessToken: "tok",
      locale: "en",
    });
    expect(account?.url).toBe("/store/account/orders/FK%201%2F2/payments");
    expect(account?.init.headers.get("Idempotency-Key")).toBe(KEY);
  });

  it("refuse a missing or unsafe key before sending anything", async () => {
    const { fetch, calls } = fakeFetch(() => jsonOk({}, 201));
    const client = createStoreClient({ baseUrl: "", fetch });
    for (const idempotencyKey of [undefined, "", "a b", "x".repeat(300)]) {
      await expect(
        client.createOrderPayment(
          { number: "FK-1", accessToken: "tok" },
          { idempotencyKey: idempotencyKey as string },
        ),
      ).rejects.toBeInstanceOf(InvalidRequestError);
      await expect(
        client.createAccountOrderPayment("FK-1", {}, { idempotencyKey: idempotencyKey as string }),
      ).rejects.toBeInstanceOf(InvalidRequestError);
    }
    expect(calls).toHaveLength(0);
  });

  it("return the typed payment member and Retry-After of payment_provider_unavailable", async () => {
    const { fetch } = fakeFetch(() =>
      problemResponse(
        503,
        {
          code: "payment_provider_unavailable",
          payment: { paymentId: VARIANT_ID, status: "processing", canRetry: false },
        },
        { "Retry-After": "120" },
      ),
    );
    const result = await createStoreClient({ baseUrl: "", fetch }).createOrderPayment(
      { number: "FK-1", accessToken: "tok" },
      { idempotencyKey: KEY },
    );
    if (result.ok) throw new Error("unreachable");
    expect(result.retryAfter).toBe("120");
    expect(result.problem.payment).toEqual({
      paymentId: VARIANT_ID,
      status: "processing",
      canRetry: false,
    });
  });
});

describe("checkout", () => {
  const KEY = "0b4c5c2e-1d2f-4c0e-9a55-3f7f2f1d9a10";

  it("sends the Idempotency-Key and the body as JSON", async () => {
    const { fetch, calls } = fakeFetch(() => jsonOk({ order: {} }, 201));
    const result = await createStoreClient({ baseUrl: "", fetch }).checkout(CHECKOUT_BODY, {
      idempotencyKey: KEY,
    });
    expect(result.ok && result.status).toBe(201);
    const { init } = calls[0] as Recorded;
    expect(init.headers.get("Idempotency-Key")).toBe(KEY);
    expect(init.headers.get("X-Fluxkit-CSRF")).toBe("1");
    expect(JSON.parse(String(init.body))).toEqual(CHECKOUT_BODY);
  });

  it("reports a replay (200) with the same shape as a first answer (201)", async () => {
    const { fetch } = fakeFetch(() => jsonOk({ order: {}, accessToken: "t" }, 200));
    const result = await createStoreClient({ baseUrl: "", fetch }).checkout(CHECKOUT_BODY, {
      idempotencyKey: KEY,
    });
    expect(result).toMatchObject({ ok: true, status: 200 });
  });

  it("refuses a missing, empty, blank or header-unsafe key before sending anything", async () => {
    const { fetch, calls } = fakeFetch(() => jsonOk({}, 201));
    const client = createStoreClient({ baseUrl: "", fetch });
    const bad: unknown[] = [undefined, null, "", "   ", "a\nb", "a b", "é", 42, "x".repeat(300)];
    for (const idempotencyKey of bad) {
      await expect(
        client.checkout(CHECKOUT_BODY, { idempotencyKey: idempotencyKey as string }),
        String(idempotencyKey),
      ).rejects.toBeInstanceOf(InvalidRequestError);
    }
    await expect(
      (client.checkout as (body: CheckoutBody, options?: unknown) => Promise<unknown>)(
        CHECKOUT_BODY,
      ),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    expect(calls).toHaveLength(0);
  });

  it("returns cart_changed with the typed fresh cart", async () => {
    const { fetch } = fakeFetch(() =>
      problemResponse(409, { code: "cart_changed", cart: EMPTY_CART }),
    );
    const result = await createStoreClient({ baseUrl: "", fetch }).checkout(CHECKOUT_BODY, {
      idempotencyKey: KEY,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe(409);
    expect(result.problem.code).toBe("cart_changed");
    expect(result.problem.cart?.requiresShipping).toBe(false);
    expectTypeOf(result.problem.cart).toEqualTypeOf<Cart | undefined>();
  });

  it("returns Retry-After for 429 and 503", async () => {
    for (const [status, code] of [
      [429, "too_many_requests"],
      [503, "service_unavailable"],
    ] as const) {
      const { fetch } = fakeFetch(() => problemResponse(status, { code }, { "Retry-After": "9" }));
      const result = await createStoreClient({ baseUrl: "", fetch }).checkout(CHECKOUT_BODY, {
        idempotencyKey: KEY,
      });
      if (result.ok) throw new Error("unreachable");
      expect(result.status).toBe(status);
      expect(result.retryAfter).toBe("9");
    }
  });

  it("has typed results", async () => {
    const client = createStoreClient({
      baseUrl: "",
      fetch: fakeFetch(() => jsonOk({}, 201)).fetch,
    });
    const result = await client.checkout(CHECKOUT_BODY, { idempotencyKey: KEY });
    if (result.ok) expectTypeOf(result.data).toEqualTypeOf<CheckoutResult>();
  });
});

describe("responses", () => {
  it("returns data typed per operation", async () => {
    const client = createStoreClient({
      baseUrl: "",
      fetch: fakeFetch(() => jsonOk(EMPTY_CART)).fetch,
    });
    const result = await client.getCart();
    expect(result).toEqual({ ok: true, status: 200, data: EMPTY_CART });
    if (result.ok) expectTypeOf(result.data).toEqualTypeOf<Cart>();
    const cancelled = await client.cancelAccountOrder("FK-1");
    if (cancelled.ok) expectTypeOf(cancelled.data).toEqualTypeOf<Order>();
  });

  it("handles 204", async () => {
    const client = createStoreClient({
      baseUrl: "",
      fetch: fakeFetch(() => new Response(null, { status: 204 })).fetch,
    });
    expect(await client.logout()).toEqual({ ok: true, status: 204, data: undefined });
    expect(await client.clearCart()).toEqual({ ok: true, status: 204, data: undefined });
  });

  it("returns a 401 problem as a value", async () => {
    const client = createStoreClient({
      baseUrl: "",
      fetch: fakeFetch(() => problemResponse(401, { code: "unauthorized" })).fetch,
    });
    const result = await client.getAccount();
    expect(result).toMatchObject({ ok: false, status: 401, retryAfter: null });
  });

  it("throws on a proxy error page", async () => {
    const client = createStoreClient({
      baseUrl: "",
      fetch: fakeFetch(
        () =>
          new Response("Bad Gateway", { status: 502, headers: { "Content-Type": "text/html" } }),
      ).fetch,
    });
    await expect(client.getCart()).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it("flags an aborted request", async () => {
    const controller = new AbortController();
    const client = createStoreClient({
      baseUrl: "",
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    });
    const pending = client.getCart({ signal: controller.signal });
    controller.abort();
    const error = await pending.then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).aborted).toBe(true);
  });

  it("uses the global fetch when none is injected", async () => {
    const globalFetch = vi.fn(async () => jsonOk({ currency: "UAH" }));
    vi.stubGlobal("fetch", globalFetch);
    const result = await createStoreClient({ baseUrl: "" }).getConfig();
    expect(result.ok).toBe(true);
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });
});

describe("secrets", () => {
  const TOKEN = "guest-access-token-SECRET";

  it("sends the guest order token only in the POST body", async () => {
    const { fetch, calls } = fakeFetch(() => jsonOk({}));
    const client = createStoreClient({ baseUrl: "", fetch });
    await client.lookupOrder({ number: "FK-1", accessToken: TOKEN }, { locale: "uk" });
    await client.cancelOrder({ number: "FK-1", accessToken: TOKEN });
    for (const { url, init } of calls) {
      expect(init.method).toBe("POST");
      expect(url).not.toContain(TOKEN);
      expect([...init.headers.values()].join("|")).not.toContain(TOKEN);
      expect(JSON.parse(String(init.body))).toEqual({ number: "FK-1", accessToken: TOKEN });
    }
  });

  it("never logs and never puts a request body or a token in an error", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const failing = createStoreClient({
      baseUrl: "",
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });
    const garbage = createStoreClient({
      baseUrl: "",
      fetch: () =>
        Promise.resolve(
          new Response(TOKEN, { status: 200, headers: { "Content-Type": "text/plain" } }),
        ),
    });
    const calls = [
      failing.lookupOrder({ number: "FK-1", accessToken: TOKEN }),
      garbage.lookupOrder({ number: "FK-1", accessToken: TOKEN }),
      failing.login({ email: "a@b.c", password: "hunter2-password" }),
    ];
    for (const call of calls) {
      const error = await call.then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
      const text = `${String(error)} ${(error as Error).stack ?? ""}`;
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("hunter2-password");
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
