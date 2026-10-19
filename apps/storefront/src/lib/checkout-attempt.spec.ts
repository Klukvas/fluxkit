import { InvalidResponseError, NetworkError, type CheckoutBody } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  ATTEMPT_STORAGE_KEY,
  InsecureContextError,
  canonicalJson,
  checkoutOutcome,
  createAttemptManager,
  requestHash,
  sessionAttemptStorage,
  webAttemptCrypto,
  type AttemptCrypto,
  type AttemptStorage,
} from "./checkout-attempt";
import { cartLine, cartOf } from "./test-fixtures";

const TOKEN = "tok_ABCdef123-_ABCdef123-_ABCdef123-_ABCdef12";

function body(overrides: Partial<CheckoutBody> = {}): CheckoutBody {
  return {
    email: "guest@example.test",
    phone: "+380441234567",
    firstName: "Ada",
    lastName: "Guest",
    shippingAddress: { countryCode: "UA", city: "Kyiv", line1: "Street 1" },
    locale: "uk",
    expectedTotal: { amount: 1999, currency: "UAH" },
    ...overrides,
  };
}

/** sessionStorage as a Map; `broken` makes every call throw like Safari's private mode or blocked site data. */
function memoryStorage(broken: "none" | "all" | "write" = "none") {
  const map = new Map<string, string>();
  const storage: AttemptStorage = {
    getItem(key) {
      if (broken === "all") throw new DOMException("denied", "SecurityError");
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      if (broken !== "none") throw new DOMException("full", "QuotaExceededError");
      map.set(key, value);
    },
    removeItem(key) {
      if (broken === "all") throw new DOMException("denied", "SecurityError");
      map.delete(key);
    },
  };
  return { storage, map };
}

function countingCrypto(): AttemptCrypto & { issued: string[] } {
  const real = webAttemptCrypto(globalThis.crypto);
  const issued: string[] = [];
  return {
    issued,
    randomUUID() {
      const key = real.randomUUID();
      issued.push(key);
      return key;
    },
    sha256Hex: (text) => real.sha256Hex(text),
  };
}

describe("canonicalJson", () => {
  it("sorts keys at every depth and drops undefined members, so equal bodies hash equal", () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [2, { y: 1, x: 2 }] } })).toBe(
      '{"a":{"c":[2,{"x":2,"y":1}]},"b":1}',
    );
    expect(canonicalJson(body())).toBe(
      canonicalJson({
        ...body(),
        shippingAddress: { line1: "Street 1", city: "Kyiv", countryCode: "UA" },
      }),
    );
  });
});

describe("requestHash", () => {
  it("is the hex SHA-256 of the canonical request and changes with any field or the expected total", async () => {
    const crypto = webAttemptCrypto(globalThis.crypto);
    const hash = await requestHash(body(), crypto);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await requestHash(body(), crypto)).toBe(hash);
    expect(await requestHash(body({ email: "other@example.test" }), crypto)).not.toBe(hash);
    expect(
      await requestHash(body({ expectedTotal: { amount: 2999, currency: "UAH" } }), crypto),
    ).not.toBe(hash);
    expect(await requestHash(body({ shippingAddress: null }), crypto)).not.toBe(hash);
  });

  it("holds no personal data: the stored attempt is a key and a hash only", async () => {
    const { storage, map } = memoryStorage();
    const manager = createAttemptManager({ storage, crypto: webAttemptCrypto(globalThis.crypto) });
    await manager.keyFor(body());
    const stored = map.get(ATTEMPT_STORAGE_KEY) as string;
    expect(Object.keys(JSON.parse(stored) as object).sort()).toEqual(["key", "requestHash"]);
    for (const secret of ["guest@example.test", "380441234567", "Ada", "Kyiv", "Street"]) {
      expect(stored).not.toContain(secret);
    }
  });
});

describe("createAttemptManager", () => {
  it("reuses the key for the same body (a double submit or a retry is one attempt)", async () => {
    const crypto = countingCrypto();
    const manager = createAttemptManager({ storage: memoryStorage().storage, crypto });
    const first = await manager.keyFor(body());
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(await manager.keyFor(body())).toBe(first);
    expect(crypto.issued).toHaveLength(1);
  });

  it("keeps the key across a reload of the tab (a new manager over the same sessionStorage)", async () => {
    const { storage } = memoryStorage();
    const key = await createAttemptManager({ storage, crypto: countingCrypto() }).keyFor(body());
    const afterReload = createAttemptManager({ storage, crypto: countingCrypto() });
    expect(await afterReload.keyFor(body())).toBe(key);
  });

  it("issues a new key when the body changes (another email, address or expected total)", async () => {
    const manager = createAttemptManager({
      storage: memoryStorage().storage,
      crypto: countingCrypto(),
    });
    const first = await manager.keyFor(body());
    const otherEmail = await manager.keyFor(body({ email: "other@example.test" }));
    expect(otherEmail).not.toBe(first);
    const otherTotal = await manager.keyFor(
      body({ email: "other@example.test", expectedTotal: { amount: 1, currency: "UAH" } }),
    );
    expect(otherTotal).not.toBe(otherEmail);
    // Back to the first body: its key was replaced, never reused for a different body later.
    expect(await manager.keyFor(body())).not.toBe(first);
  });

  it("starts over after clear()", async () => {
    const { storage, map } = memoryStorage();
    const manager = createAttemptManager({ storage, crypto: countingCrypto() });
    const first = await manager.keyFor(body());
    manager.clear();
    expect(map.has(ATTEMPT_STORAGE_KEY)).toBe(false);
    expect(await manager.keyFor(body())).not.toBe(first);
  });

  it("ignores a stored value it did not write (malformed JSON, wrong shape) and replaces it", async () => {
    for (const junk of [
      "{",
      "null",
      '{"key":1}',
      '{"key":"a","requestHash":"b","x":1,"y":2}',
      '"text"',
    ]) {
      const { storage, map } = memoryStorage();
      map.set(ATTEMPT_STORAGE_KEY, junk);
      const manager = createAttemptManager({ storage, crypto: countingCrypto() });
      const key = await manager.keyFor(body());
      expect(key).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.parse(map.get(ATTEMPT_STORAGE_KEY) as string)).toMatchObject({ key });
    }
  });

  it("says loudly when the attempt cannot be kept in sessionStorage, and still reuses the key in memory", async () => {
    for (const broken of ["all", "write"] as const) {
      const manager = createAttemptManager({
        storage: memoryStorage(broken).storage,
        crypto: countingCrypto(),
      });
      const first = await manager.keyFor(body());
      expect(manager.isPersistent()).toBe(false);
      expect(await manager.keyFor(body())).toBe(first);
    }
    const none = createAttemptManager({ storage: null, crypto: countingCrypto() });
    await none.keyFor(body());
    expect(none.isPersistent()).toBe(false);
    const fine = createAttemptManager({
      storage: memoryStorage().storage,
      crypto: countingCrypto(),
    });
    await fine.keyFor(body());
    expect(fine.isPersistent()).toBe(true);
  });
});

describe("sessionAttemptStorage", () => {
  it("returns null when reading window.sessionStorage throws (blocked site data)", () => {
    expect(
      sessionAttemptStorage(() => {
        throw new DOMException("denied", "SecurityError");
      }),
    ).toBeNull();
  });

  it("returns null when the storage refuses a probe write (Safari private mode)", () => {
    expect(sessionAttemptStorage(() => memoryStorage("write").storage)).toBeNull();
  });

  it("returns a working storage otherwise", () => {
    const { storage } = memoryStorage();
    expect(sessionAttemptStorage(() => storage)).toBe(storage);
  });
});

describe("webAttemptCrypto (secure context requirement)", () => {
  it("refuses to work without crypto.subtle or crypto.randomUUID: no weak fallback key", () => {
    expect(() => webAttemptCrypto(undefined)).toThrow(InsecureContextError);
    expect(() => webAttemptCrypto({ randomUUID: () => "x" } as unknown as Crypto)).toThrow(
      InsecureContextError,
    );
    expect(() =>
      webAttemptCrypto({ subtle: globalThis.crypto.subtle } as unknown as Crypto),
    ).toThrow(InsecureContextError);
  });

  it("uses randomUUID for keys", () => {
    const crypto = webAttemptCrypto(globalThis.crypto);
    expect(crypto.randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

// ------------------------------------------------------------------ outcome table

const order = { number: "7K3M-9QX2" } as never;

function failure(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  retryAfter: string | null = null,
) {
  return {
    ok: false as const,
    status,
    retryAfter,
    problem: {
      type: "about:blank",
      title: "t",
      status,
      code,
      detail: "English",
      ...extra,
    } as never,
  };
}

describe("checkoutOutcome", () => {
  const ctx = { locale: "uk" as const, signedIn: false };

  it("201 for a guest: clear the attempt, refresh the cart, go to the order link with the token in the FRAGMENT", () => {
    const outcome = checkoutOutcome(
      { ok: true, status: 201, data: { order, accessToken: TOKEN } },
      ctx,
    );
    expect(outcome).toEqual({
      kind: "placed",
      attempt: "clear",
      refreshCart: true,
      replay: false,
      href: `/uk/order/7K3M-9QX2#t=${TOKEN}`,
    });
    if (outcome.kind !== "placed") throw new Error("unreachable");
    const [beforeFragment] = outcome.href.split("#");
    expect(beforeFragment).not.toContain(TOKEN);
    expect(beforeFragment).not.toContain("?");
  });

  it("200 (a replay) is placed too, with the same link", () => {
    const outcome = checkoutOutcome(
      { ok: true, status: 200, data: { order, accessToken: TOKEN } },
      ctx,
    );
    expect(outcome).toMatchObject({
      kind: "placed",
      replay: true,
      href: `/uk/order/7K3M-9QX2#t=${TOKEN}`,
    });
  });

  it("201 for a customer (no token): the account order page", () => {
    expect(
      checkoutOutcome({ ok: true, status: 201, data: { order } }, { locale: "en", signedIn: true }),
    ).toMatchObject({ kind: "placed", attempt: "clear", href: "/en/account/orders/7K3M-9QX2" });
  });

  it("a network failure, an unreadable answer, a 5xx and a 503 keep the key and ask to try again", () => {
    const network = checkoutOutcome(
      { thrown: new NetworkError("x", { cause: new TypeError("f"), aborted: false }) },
      ctx,
    );
    expect(network).toMatchObject({
      kind: "retry",
      attempt: "keep",
      failure: { messageKey: "errors.network" },
    });
    const html = checkoutOutcome({ thrown: new InvalidResponseError("x", { status: 502 }) }, ctx);
    expect(html).toMatchObject({
      kind: "retry",
      attempt: "keep",
      failure: { messageKey: "errors.invalidResponse" },
    });
    expect(checkoutOutcome(failure(500, "internal_error"), ctx)).toMatchObject({
      kind: "retry",
      attempt: "keep",
    });
    expect(checkoutOutcome(failure(503, "service_unavailable", {}, "5"), ctx)).toMatchObject({
      kind: "retry",
      attempt: "keep",
      failure: { messageKey: "errors.service_unavailable", retryAfterSeconds: 5 },
    });
  });

  it("a timeout keeps the key and asks to try again", () => {
    const timeout = new NetworkError("x", {
      cause: new DOMException("timed out", "TimeoutError"),
      aborted: true,
    });
    expect(checkoutOutcome({ thrown: timeout }, ctx)).toMatchObject({
      kind: "retry",
      attempt: "keep",
      failure: { messageKey: "errors.timeout" },
    });
  });

  it("an aborted request or a bug is rethrown, never shown as a friendly message", () => {
    expect(() =>
      checkoutOutcome(
        { thrown: new NetworkError("x", { cause: new Error("a"), aborted: true }) },
        ctx,
      ),
    ).toThrow(NetworkError);
    expect(() => checkoutOutcome({ thrown: new TypeError("bug") }, ctx)).toThrow(TypeError);
  });

  it("429 keeps the key and shows the wait of Retry-After (no automatic retry)", () => {
    expect(checkoutOutcome(failure(429, "too_many_requests", {}, "120"), ctx)).toEqual({
      kind: "rateLimited",
      attempt: "keep",
      failure: expect.objectContaining({
        messageKey: "errors.too_many_requests",
        retryAfterSeconds: 120,
      }),
    });
  });

  it("409 cart_changed hands over the fresh cart; the shopper confirms the new total", () => {
    const cart = cartOf([cartLine("a")], { total: { amount: 2999, currency: "UAH" } });
    expect(checkoutOutcome(failure(409, "cart_changed", { cart }), ctx)).toEqual({
      kind: "cartChanged",
      attempt: "keep",
      cart,
      failure: expect.objectContaining({ messageKey: "errors.cart_changed" }),
    });
  });

  it("409 checkout_refused marks the lines by their position in the cart with a translated code", () => {
    const outcome = checkoutOutcome(
      failure(409, "checkout_refused", {
        errors: [
          { path: "lines.2", code: "insufficient_stock" },
          { path: "lines.0", code: "product_title_missing" },
          { path: "lines.x", code: "insufficient_stock" },
          { path: "email", code: "insufficient_stock" },
        ],
      }),
      ctx,
    );
    expect(outcome).toMatchObject({
      kind: "refused",
      attempt: "keep",
      lineErrors: [
        { index: 2, code: "insufficient_stock", messageKey: "errors.field.insufficient_stock" },
        {
          index: 0,
          code: "product_title_missing",
          messageKey: "errors.field.product_title_missing",
        },
      ],
      failure: { messageKey: "errors.checkout_refused" },
    });
  });

  it("409 cart_empty clears the attempt and goes to the cart", () => {
    expect(checkoutOutcome(failure(409, "cart_empty"), ctx)).toMatchObject({
      kind: "cartEmpty",
      attempt: "clear",
      refreshCart: true,
      href: "/uk/cart",
    });
  });

  it("409 too_many_open_orders explains; customers get a link to their orders, guests none", () => {
    expect(checkoutOutcome(failure(409, "too_many_open_orders"), ctx)).toMatchObject({
      kind: "tooManyOpenOrders",
      attempt: "keep",
      ordersHref: null,
      failure: { messageKey: "errors.too_many_open_orders" },
    });
    expect(
      checkoutOutcome(failure(409, "too_many_open_orders"), { locale: "en", signedIn: true }),
    ).toMatchObject({ ordersHref: "/en/account/orders" });
  });

  it("409 idempotency_key_reused clears the attempt and asks to submit again", () => {
    expect(checkoutOutcome(failure(409, "idempotency_key_reused"), ctx)).toMatchObject({
      kind: "keyReused",
      attempt: "clear",
      failure: { messageKey: "errors.idempotency_key_reused" },
    });
  });

  it("400 maps errors[] to the form fields and keeps the key", () => {
    const outcome = checkoutOutcome(
      failure(400, "validation_failed", {
        errors: [
          { path: "shippingAddress.city", code: "empty" },
          { path: "email", code: "invalid_format" },
          { path: "shippingAddress", code: "shipping_address_required" },
        ],
      }),
      ctx,
    );
    expect(outcome).toMatchObject({
      kind: "invalid",
      attempt: "keep",
      failure: {
        messageKey: "errors.validation_failed",
        fieldErrors: [
          { path: "shippingAddress.city", messageKey: "errors.field.empty" },
          { path: "email", messageKey: "errors.field.invalid_format" },
          { path: "shippingAddress", messageKey: "errors.field.shipping_address_required" },
        ],
      },
    });
  });

  it("any other problem (a 403, a rule) is a failure that keeps the key", () => {
    expect(checkoutOutcome(failure(403, "forbidden"), ctx)).toMatchObject({
      kind: "failed",
      attempt: "keep",
    });
    expect(
      checkoutOutcome(failure(409, "rule_violation", { rule: "subtotal_out_of_range" }), ctx),
    ).toMatchObject({
      kind: "failed",
      attempt: "keep",
      failure: { messageKey: "errors.rule.subtotal_out_of_range" },
    });
  });

  it("refuses an order number or token that could leave the path or the fragment", () => {
    expect(() =>
      checkoutOutcome(
        { ok: true, status: 201, data: { order: { number: "../x" }, accessToken: TOKEN } as never },
        ctx,
      ),
    ).toThrow(RangeError);
    expect(() =>
      checkoutOutcome({ ok: true, status: 201, data: { order, accessToken: "a b#c" } }, ctx),
    ).toThrow(RangeError);
  });
});
