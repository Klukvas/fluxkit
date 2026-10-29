import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AttemptCrypto, AttemptStorage } from "./checkout-attempt";
import { PAYMENT_ATTEMPT_STORAGE_KEY, createPaymentAttemptManager } from "./payment-attempt";

function fakeCrypto(): AttemptCrypto {
  let counter = 0;
  return {
    randomUUID: () => {
      counter += 1;
      return `uuid-${String(counter)}`;
    },
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

const order = { orderNumber: "7K3M-9QX2", provider: null, locale: "uk" } as const;

describe("the payment attempt key", () => {
  it("gives the same Idempotency-Key to the same request, so a double click or a retry is ONE attempt", async () => {
    const manager = createPaymentAttemptManager({ storage: memoryStorage(), crypto: fakeCrypto() });
    const first = await manager.keyFor(order);
    expect(await manager.keyFor({ ...order })).toBe(first);
    expect(await manager.keyFor(order)).toBe(first);
  });

  it("keeps the key across a reload of the tab (the stored attempt is read again)", async () => {
    const storage = memoryStorage();
    const first = await createPaymentAttemptManager({ storage, crypto: fakeCrypto() }).keyFor(order);
    const again = await createPaymentAttemptManager({ storage, crypto: fakeCrypto() }).keyFor(order);
    expect(again).toBe(first);
  });

  it.each([
    ["another order", { ...order, orderNumber: "AAAA-BBBB" }],
    ["another provider", { ...order, provider: "monobank" }],
    ["another locale", { ...order, locale: "en" }],
  ])("gives a new key for %s", async (_name, other) => {
    const manager = createPaymentAttemptManager({ storage: memoryStorage(), crypto: fakeCrypto() });
    const first = await manager.keyFor(order);
    const second = await manager.keyFor(other);
    expect(second).not.toBe(first);
    // The kept attempt is now the new one; the old request is a third attempt.
    expect(await manager.keyFor(other)).toBe(second);
  });

  it("gives a new key after clear(): a finished attempt is never replayed for a new payment", async () => {
    const manager = createPaymentAttemptManager({ storage: memoryStorage(), crypto: fakeCrypto() });
    const first = await manager.keyFor(order);
    manager.clear();
    expect(await manager.keyFor(order)).not.toBe(first);
  });

  it("stores a key, a salt and a salted hash only: no order number, token or locale in clear", async () => {
    const storage = memoryStorage();
    const manager = createPaymentAttemptManager({ storage, crypto: fakeCrypto() });
    await manager.keyFor(order);
    const stored = storage.entries.get(PAYMENT_ATTEMPT_STORAGE_KEY) ?? "";
    expect(Object.keys(JSON.parse(stored) as object).sort()).toEqual(["key", "requestHash", "salt"]);
    expect(stored).not.toContain("7K3M");
    expect(stored).not.toContain('"uk"');
  });

  it("works from memory when storage is missing or throws, and says it is not persistent", async () => {
    const none = createPaymentAttemptManager({ storage: null, crypto: fakeCrypto() });
    const key = await none.keyFor(order);
    expect(await none.keyFor(order)).toBe(key);
    expect(none.isPersistent()).toBe(false);

    const broken: AttemptStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const manager = createPaymentAttemptManager({ storage: broken, crypto: fakeCrypto() });
    const memoryKey = await manager.keyFor(order);
    expect(await manager.keyFor(order)).toBe(memoryKey);
    manager.clear();
    expect(await manager.keyFor(order)).not.toBe(memoryKey);
    expect(manager.isPersistent()).toBe(false);
  });

  it("ignores a damaged stored entry and starts a new attempt", async () => {
    const storage = memoryStorage();
    storage.setItem(PAYMENT_ATTEMPT_STORAGE_KEY, "{not json");
    const manager = createPaymentAttemptManager({ storage, crypto: fakeCrypto() });
    const key = await manager.keyFor(order);
    expect(key).toMatch(/^uuid-/);
    expect(await manager.keyFor(order)).toBe(key);
  });
});
