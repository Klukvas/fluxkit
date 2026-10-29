import {
  NetworkError,
  type CreatedPayment,
  type PaymentState,
  type StoreClient,
  type StoreResult,
} from "@fluxkit/api-client";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InsecureContextError, type AttemptCrypto, type AttemptStorage } from "./checkout-attempt";
import { createPaymentAttemptManager } from "./payment-attempt";
import { readPaymentReturn } from "./payment-return";
import {
  accountPaySource,
  createPayStore,
  guestPaySource,
  initialPayState,
  payFocusTarget,
  statusReadFor,
  type PaySource,
} from "./payment-store";

const ID = "6f1c1d8e-5f0a-4f6e-9a0b-0c2f4b7d1a11";
const TOKEN = "A".repeat(43);
const PAGE = "https://pay.fake.invalid/pay/fake-pay-000001";

function crypto(): AttemptCrypto {
  let counter = 0;
  return {
    randomUUID: () => `uuid-${String((counter += 1))}`,
    sha256Hex: (text) => Promise.resolve(createHash("sha256").update(text).digest("hex")),
  };
}

function memoryStorage(): AttemptStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

const created = (overrides: Partial<CreatedPayment> = {}): StoreResult<CreatedPayment> => ({
  ok: true,
  status: 201,
  data: {
    paymentId: ID,
    status: "waiting",
    redirectUrl: PAGE,
    expiresAt: "2026-10-29T12:00:00.000Z",
    ...overrides,
  },
});

function problem(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  retryAfter: string | null = null,
): StoreResult<CreatedPayment> {
  return {
    ok: false,
    status,
    problem: { type: "about:blank", title: "t", status, code, detail: "never shown", ...extra },
    retryAfter,
  } as StoreResult<CreatedPayment>;
}

interface Harness {
  create: ReturnType<typeof vi.fn<(key: string) => Promise<StoreResult<CreatedPayment>>>>;
  navigate: ReturnType<typeof vi.fn<(url: string) => boolean>>;
  onOrderChanged: ReturnType<typeof vi.fn>;
  onSignedOut: ReturnType<typeof vi.fn>;
  keys: string[];
  storage: ReturnType<typeof memoryStorage>;
  store: ReturnType<typeof createPayStore>;
  returnStorage: AttemptStorage | null;
}

function harness(
  answers: (StoreResult<CreatedPayment> | Error)[],
  options: {
    returnStorage?: AttemptStorage | null;
    attempts?: () => ReturnType<typeof createPaymentAttemptManager>;
    navigates?: boolean;
    now?: () => number;
  } = {},
): Harness {
  const storage = memoryStorage();
  const keys: string[] = [];
  const create = vi.fn((key: string) => {
    keys.push(key);
    const next = answers.shift() ?? created();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  const source: PaySource = {
    identity: { orderNumber: "7K3M-9QX2", provider: null, locale: "uk" },
    create,
    returnEntry: (paymentId) => ({
      kind: "guest",
      number: "7K3M-9QX2",
      accessToken: TOKEN,
      paymentId,
    }),
  };
  const shared = createPaymentAttemptManager({ storage, crypto: crypto() });
  const attempts = options.attempts ?? (() => shared);
  const navigate = vi.fn<(url: string) => boolean>(() => options.navigates ?? true);
  const onOrderChanged = vi.fn();
  const onSignedOut = vi.fn();
  const returnStorage = options.returnStorage === undefined ? storage : options.returnStorage;
  const store = createPayStore({
    source,
    attempts,
    returnStorage,
    navigate,
    onOrderChanged,
    onSignedOut,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return { create, navigate, onOrderChanged, onSignedOut, keys, storage, store, returnStorage };
}

describe("createPayStore.pay", () => {
  it("creates the attempt, saves the hand-off for the return page and navigates once to the https page", async () => {
    const h = harness([created()]);
    await h.store.pay();
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalledExactlyOnceWith(PAGE);
    expect(h.store.getState().phase).toBe("redirecting");
    expect(readPaymentReturn(h.storage)).toEqual({
      kind: "guest",
      number: "7K3M-9QX2",
      accessToken: TOKEN,
      paymentId: ID,
    });
  });

  it("never navigates to a page that is not https, and says the page could not be opened", async () => {
    for (const redirectUrl of ["http://pay.example.com/1", "javascript:alert(1)", null]) {
      const h = harness([created({ redirectUrl })]);
      await h.store.pay();
      expect(h.navigate).not.toHaveBeenCalled();
      expect(h.store.getState()).toMatchObject({ phase: "failed", outcome: { kind: "noPage" } });
    }
  });

  it("answers a double click with ONE request", async () => {
    const h = harness([created()]);
    const first = h.store.pay();
    const second = h.store.pay();
    await Promise.all([first, second]);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalledTimes(1);
  });

  it("ignores pay() once the browser is on its way to the provider", async () => {
    const h = harness([created()]);
    await h.store.pay();
    await h.store.pay();
    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it("sends the SAME key again after a lost answer, and a NEW key after a definitive one", async () => {
    const lost = new NetworkError("down", { cause: new TypeError("fetch failed"), aborted: false });
    const h = harness([
      lost,
      problem(500, "internal_error"),
      problem(409, "rule_violation", { rule: "payment_not_available" }),
      created(),
      created(),
    ]);
    await h.store.pay();
    expect(h.store.getState().outcome).toMatchObject({ kind: "retry" });
    await h.store.pay();
    await h.store.pay();
    // Three tries with the same body: one key. The third was definitive (409), so the key was forgotten.
    expect(new Set(h.keys.slice(0, 3)).size).toBe(1);
    h.store.dismiss();
    await h.store.pay();
    expect(h.keys[3]).not.toBe(h.keys[0]);
  });

  it("503 with canRetry false keeps the key and starts the countdown; canRetry true forgets the key", async () => {
    let now = 1_000_000;
    const wait = harness(
      [
        problem(
          503,
          "payment_provider_unavailable",
          { payment: { paymentId: ID, status: "processing", canRetry: false } },
          "45",
        ),
        created(),
      ],
      { now: () => now },
    );
    await wait.store.pay();
    expect(wait.store.getState()).toMatchObject({
      phase: "failed",
      outcome: { kind: "providerUnavailable", canRetry: false },
      waitUntil: now + 45_000,
    });
    now += 46_000;
    wait.store.dismiss();
    await wait.store.pay();
    expect(wait.keys[1]).toBe(wait.keys[0]);

    const retry = harness(
      [
        problem(
          503,
          "payment_provider_unavailable",
          { payment: { paymentId: ID, status: "failed", canRetry: true } },
          "30",
        ),
        created(),
      ],
      { now: () => now },
    );
    await retry.store.pay();
    expect(retry.store.getState().waitUntil).toBe(now + 30_000);
    retry.store.dismiss();
    await retry.store.pay();
    expect(retry.keys[1]).not.toBe(retry.keys[0]);
  });

  it("asks the page to read the order again when the order is no longer payable or a payment is in progress", async () => {
    for (const rule of ["order_not_payable", "payment_in_progress"]) {
      const h = harness([problem(409, "rule_violation", { rule })]);
      await h.store.pay();
      expect(h.onOrderChanged).toHaveBeenCalledTimes(1);
      expect(h.navigate).not.toHaveBeenCalled();
    }
  });

  it("tells the account store when the session ended", async () => {
    const h = harness([problem(401, "unauthorized")]);
    await h.store.pay();
    expect(h.onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("refuses to start in an insecure context, without a request", async () => {
    const h = harness([], {
      attempts: () => {
        throw new InsecureContextError();
      },
    });
    await h.store.pay();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.store.getState()).toMatchObject({ insecure: true, phase: "idle" });
  });

  it("still redirects when the hand-off cannot be saved, and remembers to warn the shopper", async () => {
    const h = harness([created()], { returnStorage: null });
    await h.store.pay();
    expect(h.navigate).toHaveBeenCalledTimes(1);
    expect(h.store.getState().returnSaved).toBe(false);
  });

  it("goes back to idle and rethrows when the failure is a bug, not a network problem", async () => {
    const h = harness([new RangeError("bug")]);
    await expect(h.store.pay()).rejects.toThrow(RangeError);
    expect(h.store.getState().phase).toBe("idle");
  });

  it("notifies subscribers about pending and the result", async () => {
    const h = harness([problem(500, "internal_error")]);
    const phases: string[] = [];
    h.store.subscribe(() => phases.push(h.store.getState().phase));
    await h.store.pay();
    expect(phases).toEqual(["pending", "failed"]);
  });
});

describe("createPayStore.continuePayment and rememberReturn", () => {
  it("navigates to a checked page of the latest attempt without creating a new one", () => {
    const h = harness([]);
    h.store.continuePayment(PAGE, ID);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.navigate).toHaveBeenCalledExactlyOnceWith(PAGE);
    expect(readPaymentReturn(h.storage)?.paymentId).toBe(ID);
  });

  it("refuses an unsafe page", () => {
    const h = harness([]);
    h.store.continuePayment("javascript:alert(1)", ID);
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.store.getState().outcome).toMatchObject({ kind: "noPage" });
  });

  it("rememberReturn saves the hand-off for the status page", () => {
    const h = harness([]);
    expect(h.store.rememberReturn(ID)).toBe(true);
    expect(readPaymentReturn(h.storage)?.paymentId).toBe(ID);
  });
});

describe("the sources talk through the typed client with the token in the body", () => {
  it("guest: createOrderPayment with number, token and locale in the body and the key as an option", async () => {
    const createOrderPayment = vi.fn(() => Promise.resolve(created()));
    const source = guestPaySource(
      { createOrderPayment } as unknown as Pick<StoreClient, "createOrderPayment">,
      "7K3M-9QX2",
      TOKEN,
      "en",
    );
    await source.create("key-1");
    expect(createOrderPayment).toHaveBeenCalledWith(
      { number: "7K3M-9QX2", accessToken: TOKEN, locale: "en" },
      expect.objectContaining({ idempotencyKey: "key-1" }),
    );
    expect(source.identity).toEqual({ orderNumber: "7K3M-9QX2", provider: null, locale: "en" });
    expect(source.returnEntry(ID)).toEqual({
      kind: "guest",
      number: "7K3M-9QX2",
      accessToken: TOKEN,
      paymentId: ID,
    });
  });

  it("account: createAccountOrderPayment by number, no token anywhere", async () => {
    const createAccountOrderPayment = vi.fn(() => Promise.resolve(created()));
    const source = accountPaySource(
      { createAccountOrderPayment } as unknown as Pick<StoreClient, "createAccountOrderPayment">,
      "7K3M-9QX2",
      "uk",
    );
    await source.create("key-2");
    expect(createAccountOrderPayment).toHaveBeenCalledWith(
      "7K3M-9QX2",
      { locale: "uk" },
      expect.objectContaining({ idempotencyKey: "key-2" }),
    );
    expect(JSON.stringify(source.returnEntry(ID))).not.toContain("accessToken");
  });

  it("status reads: guest by body, account by path", async () => {
    const state: PaymentState = {
      paymentId: ID,
      status: "waiting",
      failureCategory: null,
      expiresAt: "x",
      orderStatus: "awaiting_payment",
      canRetry: false,
    };
    const getOrderPaymentStatus = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, data: state } as StoreResult<PaymentState>),
    );
    const getAccountOrderPayment = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, data: state } as StoreResult<PaymentState>),
    );
    const client = { getOrderPaymentStatus, getAccountOrderPayment } as unknown as Pick<
      StoreClient,
      "getOrderPaymentStatus" | "getAccountOrderPayment"
    >;
    await statusReadFor(client, {
      kind: "guest",
      number: "7K3M-9QX2",
      accessToken: TOKEN,
      paymentId: ID,
    })();
    expect(getOrderPaymentStatus).toHaveBeenCalledWith(
      { number: "7K3M-9QX2", accessToken: TOKEN, paymentId: ID },
      expect.anything(),
    );
    await statusReadFor(client, { kind: "account", number: "7K3M-9QX2", paymentId: ID })();
    expect(getAccountOrderPayment).toHaveBeenCalledWith("7K3M-9QX2", ID, expect.anything());
  });
});

describe("payFocusTarget", () => {
  const phase = (name: "idle" | "pending" | "redirecting" | "failed") => ({
    ...initialPayState,
    phase: name,
  });

  it("puts the focus on the message when a start fails, and back on the action when the message is dismissed", () => {
    expect(payFocusTarget(phase("pending"), phase("failed"))).toBe("message");
    expect(payFocusTarget(phase("failed"), phase("idle"))).toBe("action");
  });

  it("leaves the focus alone for every other change (the redirect, the first click, an unchanged state)", () => {
    expect(payFocusTarget(phase("idle"), phase("pending"))).toBeNull();
    expect(payFocusTarget(phase("pending"), phase("redirecting"))).toBeNull();
    expect(payFocusTarget(phase("pending"), phase("idle"))).toBeNull();
    expect(payFocusTarget(phase("failed"), phase("failed"))).toBeNull();
  });
});
