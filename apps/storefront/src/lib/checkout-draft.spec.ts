import { describe, expect, it } from "vitest";
import {
  CHECKOUT_DRAFT_KEY,
  CHECKOUT_DRAFT_TTL_MS,
  clearCheckoutDraft,
  loadCheckoutDraft,
  saveCheckoutDraft,
  sessionDraftStorage,
  type DraftStorage,
} from "./checkout-draft";

function memoryStorage(): DraftStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

const blocked: DraftStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const draft = {
  values: { email: "a@example.com", phone: "050 123 4567", "shippingAddress.city": "Kyiv" },
  methodCode: "courier",
};

describe("checkout draft (review SQ-05: the language switch must not wipe the form)", () => {
  it("restores what was saved in this tab", () => {
    const storage = memoryStorage();
    saveCheckoutDraft(storage, draft, 1_000);
    expect(loadCheckoutDraft(storage, 2_000)).toEqual(draft);
  });

  it("forgets a draft older than one hour and removes it", () => {
    const storage = memoryStorage();
    saveCheckoutDraft(storage, draft, 0);
    expect(loadCheckoutDraft(storage, CHECKOUT_DRAFT_TTL_MS)).toEqual(draft);
    expect(loadCheckoutDraft(storage, CHECKOUT_DRAFT_TTL_MS + 1)).toBeNull();
    expect(storage.entries.has(CHECKOUT_DRAFT_KEY)).toBe(false);
  });

  it("is removed by clear (order placed, sign-out)", () => {
    const storage = memoryStorage();
    saveCheckoutDraft(storage, draft, 0);
    clearCheckoutDraft(storage);
    expect(loadCheckoutDraft(storage, 1)).toBeNull();
  });

  it("drops a tampered or unreadable entry instead of filling the form with it", () => {
    const storage = memoryStorage();
    storage.setItem(CHECKOUT_DRAFT_KEY, "{not json");
    expect(loadCheckoutDraft(storage, 0)).toBeNull();
    expect(storage.entries.size).toBe(0);
    storage.setItem(
      CHECKOUT_DRAFT_KEY,
      JSON.stringify({ savedAt: 0, values: { email: 5 }, methodCode: "x" }),
    );
    expect(loadCheckoutDraft(storage, 0)).toEqual({ values: {}, methodCode: "x" });
    storage.setItem(
      CHECKOUT_DRAFT_KEY,
      JSON.stringify({
        savedAt: 0,
        values: { "bad name": "x", email: "y".repeat(1001) },
        methodCode: "",
      }),
    );
    expect(loadCheckoutDraft(storage, 0)).toEqual({ values: {}, methodCode: "" });
    storage.setItem(
      CHECKOUT_DRAFT_KEY,
      JSON.stringify({ savedAt: 10, values: {}, methodCode: "" }),
    );
    expect(loadCheckoutDraft(storage, 0)).toBeNull();
  });

  it("works without storage and when every access throws (blocked site data)", () => {
    expect(
      sessionDraftStorage(() => {
        throw new Error("SecurityError");
      }),
    ).toBeNull();
    saveCheckoutDraft(null, draft, 0);
    expect(loadCheckoutDraft(null, 0)).toBeNull();
    saveCheckoutDraft(blocked, draft, 0);
    expect(loadCheckoutDraft(blocked, 0)).toBeNull();
    expect(() => clearCheckoutDraft(blocked)).not.toThrow();
  });
});
