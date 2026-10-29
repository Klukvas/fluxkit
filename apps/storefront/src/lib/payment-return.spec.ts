import { describe, expect, it } from "vitest";
import type { AttemptStorage } from "./checkout-attempt";
import {
  PAYMENT_RETURN_STORAGE_KEY,
  clearPaymentReturn,
  paymentIdFromSearch,
  paymentReturnHref,
  readPaymentReturn,
  returnOrderHref,
  savePaymentReturn,
  type PaymentReturn,
} from "./payment-return";

const ID = "6f1c1d8e-5f0a-4f6e-9a0b-0c2f4b7d1a11";
const TOKEN = "A".repeat(43);

function memoryStorage(): AttemptStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

const guest: PaymentReturn = {
  kind: "guest",
  number: "7K3M-9QX2",
  accessToken: TOKEN,
  paymentId: ID,
};
const account: PaymentReturn = { kind: "account", number: "7K3M-9QX2", paymentId: ID };

describe("the hand-off to the return page", () => {
  it("round-trips a guest and an account entry", () => {
    const storage = memoryStorage();
    expect(savePaymentReturn(storage, guest)).toBe(true);
    expect(readPaymentReturn(storage)).toEqual(guest);
    expect(savePaymentReturn(storage, account)).toBe(true);
    expect(readPaymentReturn(storage)).toEqual(account);
  });

  it("clear() removes it", () => {
    const storage = memoryStorage();
    savePaymentReturn(storage, guest);
    clearPaymentReturn(storage);
    expect(storage.entries.size).toBe(0);
    expect(readPaymentReturn(storage)).toBeNull();
  });

  it("reports false instead of throwing when storage is missing or refuses the write", () => {
    expect(savePaymentReturn(null, guest)).toBe(false);
    const full: AttemptStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    expect(savePaymentReturn(full, guest)).toBe(false);
    expect(readPaymentReturn(null)).toBeNull();
  });

  it("returns null when reading throws", () => {
    const blocked: AttemptStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(readPaymentReturn(blocked)).toBeNull();
  });

  it.each([
    ["not JSON", "{oops"],
    ["an array", "[]"],
    ["an unknown kind", JSON.stringify({ kind: "admin", number: "7K3M-9QX2", paymentId: ID })],
    [
      "a guest entry without a token",
      JSON.stringify({ kind: "guest", number: "7K3M-9QX2", paymentId: ID }),
    ],
    ["a malformed token", JSON.stringify({ ...guest, accessToken: "short" })],
    ["a malformed order number", JSON.stringify({ ...guest, number: "../etc" })],
    ["a malformed payment id", JSON.stringify({ ...guest, paymentId: "not-a-uuid" })],
    ["an account entry that carries a token", JSON.stringify({ ...account, accessToken: TOKEN })],
    ["an extra member", JSON.stringify({ ...guest, extra: 1 })],
  ])("ignores %s", (_name, text) => {
    const storage = memoryStorage();
    storage.setItem(PAYMENT_RETURN_STORAGE_KEY, text);
    expect(readPaymentReturn(storage)).toBeNull();
  });

  it("refuses to save a malformed entry", () => {
    const storage = memoryStorage();
    expect(savePaymentReturn(storage, { ...guest, accessToken: "short" })).toBe(false);
    expect(storage.entries.size).toBe(0);
  });
});

describe("paymentIdFromSearch: the query only says WHICH attempt", () => {
  it("returns a well-formed id (any case) from ?payment=", () => {
    expect(paymentIdFromSearch(`?payment=${ID}`)).toBe(ID);
    expect(paymentIdFromSearch(`?payment=${ID.toUpperCase()}`)).toBe(ID.toUpperCase());
  });

  it.each([
    [""],
    ["?"],
    ["?payment="],
    ["?payment=not-a-uuid"],
    [`?payment=${ID}&payment=${ID}`],
    [`?payment=${ID}x`],
    ["?status=paid"],
    ["?payment=../../x"],
  ])("returns null for %j", (search) => {
    expect(paymentIdFromSearch(search)).toBeNull();
  });

  it("reads nothing else: a status, an amount or an order number in the query is ignored", () => {
    expect(
      paymentIdFromSearch(`?status=paid&amount=1&number=7K3M-9QX2&token=${TOKEN}&payment=${ID}`),
    ).toBe(ID);
  });
});

describe("returnOrderHref", () => {
  it("links a guest back to the order with the token in the fragment, an account entry to the account order", () => {
    expect(returnOrderHref("uk", guest)).toBe(`/uk/order/7K3M-9QX2#t=${TOKEN}`);
    expect(returnOrderHref("en", account)).toBe("/en/account/orders/7K3M-9QX2");
  });
});

describe("paymentReturnHref", () => {
  it("builds the return path with the attempt id only", () => {
    expect(paymentReturnHref("uk", ID)).toBe(`/uk/payment/return?payment=${ID}`);
  });

  it("refuses anything that is not an attempt id", () => {
    expect(() => paymentReturnHref("uk", "../x")).toThrow(RangeError);
    expect(() => paymentReturnHref("uk", `${ID}&token=${TOKEN}`)).toThrow(RangeError);
  });
});
