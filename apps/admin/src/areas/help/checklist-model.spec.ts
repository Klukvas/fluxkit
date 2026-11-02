import type {
  AdminConfig,
  AdminEmailStatus,
  AdminOperationName,
  AdminResult,
} from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  CHECKLIST_STEPS,
  NO_PREFERENCES,
  STOCK_SAMPLE,
  doneCount,
  loadChecklistFacts,
  parsePreferences,
  preferencesKey,
  serializePreferences,
  withManual,
  type ChecklistClient,
  type ChecklistFacts,
} from "./checklist-model";
import { readPreferences, storePreferences } from "./checklist-storage";

const ok = <T>(data: T): AdminResult<T> => ({ ok: true, status: 200, data });
const problem = (status: number): AdminResult<never> => ({
  ok: false,
  status,
  problem: { type: "about:blank", title: "x", status, code: "x" } as never,
  retryAfter: null,
});
const page = (total: number, items: unknown[] = []) => ok({ items, total, limit: 1, offset: 0 });

const config = (overrides: Partial<AdminConfig> = {}): AdminConfig =>
  ({ emailDelivery: true, onlinePayment: true, shopCurrency: "UAH", ...overrides }) as AdminConfig;

interface Calls {
  names: string[];
}

/** A fake client: every read answers what the test says and records its name. */
function fakeClient(
  calls: Calls,
  answers: {
    config?: AdminResult<AdminConfig>;
    productTypes?: number;
    categories?: number;
    products?: number;
    published?: string[];
    publishedResult?: AdminResult<never>;
    inventory?: Record<
      string,
      AdminResult<{ items: { trackInventory: boolean; totalAvailable: number }[] }>
    >;
    methods?: (boolean | { isActive: boolean; currency: string })[];
    email?: AdminResult<AdminEmailStatus>;
  } = {},
): ChecklistClient {
  const record = <T>(name: string, value: T) => {
    calls.names.push(name);
    return Promise.resolve(value);
  };
  return {
    getConfig: () => record("getConfig", answers.config ?? ok(config())),
    listProductTypes: () => record("listProductTypes", page(answers.productTypes ?? 1)),
    listCategories: () => record("listCategories", page(answers.categories ?? 1)),
    listProducts: (options) =>
      options.status === "active"
        ? record(
            "listPublished",
            answers.publishedResult ??
              page(
                (answers.published ?? ["p1"]).length,
                (answers.published ?? ["p1"]).map((id) => ({ id })),
              ),
          )
        : record("listProducts", page(answers.products ?? 1)),
    getProductInventory: (id) =>
      record(
        `inventory:${id}`,
        answers.inventory?.[id] ?? ok({ items: [{ trackInventory: true, totalAvailable: 3 }] }),
      ),
    listShippingMethods: () =>
      record(
        "listShippingMethods",
        page(
          (answers.methods ?? [true]).length,
          (answers.methods ?? [true]).map((method) =>
            typeof method === "boolean" ? { isActive: method, currency: "UAH" } : method,
          ),
        ),
      ),
    getEmailStatus: () =>
      record("getEmailStatus", answers.email ?? ok({ providerCode: "resend" } as AdminEmailStatus)),
  } as ChecklistClient;
}

const everything = () => true;
const signal = new AbortController().signal;

describe("loadChecklistFacts", () => {
  it("marks every computed step done when the shop's data says so", async () => {
    const calls: Calls = { names: [] };
    const facts = await loadChecklistFacts(fakeClient(calls), everything, signal);
    expect(facts).toEqual({
      productTypes: "done",
      categories: "done",
      firstProduct: "done",
      prices: "done",
      stock: "done",
      shipping: "done",
      payments: "done",
      email: "done",
    });
  });

  it("marks steps not done from empty lists, inactive methods, no providers and stock at zero", async () => {
    const calls: Calls = { names: [] };
    const facts = await loadChecklistFacts(
      fakeClient(calls, {
        productTypes: 0,
        categories: 0,
        products: 0,
        published: [],
        methods: [false, false],
        config: ok(config({ emailDelivery: false, onlinePayment: false })),
      }),
      everything,
      signal,
    );
    expect(facts).toEqual({
      productTypes: "todo",
      categories: "todo",
      firstProduct: "todo",
      prices: "todo",
      stock: "todo",
      shipping: "todo",
      payments: "todo",
      email: "todo",
    } satisfies ChecklistFacts);
  });

  it("counts a variant that does not count stock as ready to sell", async () => {
    const facts = await loadChecklistFacts(
      fakeClient(
        { names: [] },
        {
          inventory: { p1: ok({ items: [{ trackInventory: false, totalAvailable: 0 }] }) },
        },
      ),
      everything,
      signal,
    );
    expect(facts.stock).toBe("done");
  });

  it("marks stock not done when the published products have nothing available", async () => {
    const facts = await loadChecklistFacts(
      fakeClient(
        { names: [] },
        {
          published: ["a", "b"],
          inventory: {
            a: ok({ items: [{ trackInventory: true, totalAvailable: 0 }] }),
            b: ok({ items: [] }),
          },
        },
      ),
      everything,
      signal,
    );
    expect(facts.prices).toBe("done");
    expect(facts.stock).toBe("todo");
  });

  it("looks at no more than the sample of published products, and no inventory without a published one", async () => {
    const calls: Calls = { names: [] };
    const many = Array.from({ length: STOCK_SAMPLE + 3 }, (_, i) => `p${String(i)}`);
    await loadChecklistFacts(
      fakeClient(calls, {
        published: many,
        inventory: Object.fromEntries(
          many.map((id) => [id, ok({ items: [{ trackInventory: true, totalAvailable: 0 }] })]),
        ),
      }),
      everything,
      signal,
    );
    expect(calls.names.filter((name) => name.startsWith("inventory:"))).toHaveLength(STOCK_SAMPLE);

    const none: Calls = { names: [] };
    const facts = await loadChecklistFacts(fakeClient(none, { published: [] }), everything, signal);
    expect(facts.stock).toBe("todo");
    expect(none.names.some((name) => name.startsWith("inventory:"))).toBe(false);
  });

  it("says the role cannot check a step, and never sends a read the role may not run", async () => {
    const calls: Calls = { names: [] };
    const viewerLike = (operation: AdminOperationName) =>
      ["listProductTypes", "listCategories", "listProducts", "getProductInventory"].includes(
        operation,
      );
    const facts = await loadChecklistFacts(fakeClient(calls), viewerLike, signal);
    expect(facts.shipping).toBe("noAccess");
    expect(calls.names).not.toContain("listShippingMethods");
    expect(calls.names).not.toContain("getEmailStatus");
    // Email and payments come from the configuration every signed-in admin may read.
    expect(facts.email).toBe("done");
    expect(facts.payments).toBe("done");

    const nothing: Calls = { names: [] };
    const none = await loadChecklistFacts(fakeClient(nothing), () => false, signal);
    expect(none.productTypes).toBe("noAccess");
    expect(none.stock).toBe("noAccess");
    expect(nothing.names).toEqual(["getConfig"]);
  });

  it("counts only an active method priced in the shop currency, and does not guess without the config", async () => {
    const otherCurrency = await loadChecklistFacts(
      fakeClient({ names: [] }, { methods: [{ isActive: true, currency: "EUR" }, false] }),
      everything,
      signal,
    );
    expect(otherCurrency.shipping).toBe("todo");
    const noConfig = await loadChecklistFacts(
      fakeClient({ names: [] }, { config: problem(500) }),
      everything,
      signal,
    );
    expect(noConfig.shipping).toBe("failed");
  });

  it("marks the test mail provider as test only, not done", async () => {
    const facts = await loadChecklistFacts(
      fakeClient({ names: [] }, { email: ok({ providerCode: "fake" } as AdminEmailStatus) }),
      everything,
      signal,
    );
    expect(facts.email).toBe("testOnly");
  });

  it("reports a refused or failed read as such, never as done or not done", async () => {
    const facts = await loadChecklistFacts(
      fakeClient(
        { names: [] },
        {
          config: problem(500),
          publishedResult: problem(503),
        },
      ),
      everything,
      signal,
    );
    expect(facts.payments).toBe("failed");
    expect(facts.email).toBe("failed");
    expect(facts.prices).toBe("failed");
    expect(facts.stock).toBe("failed");
    const forbidden = await loadChecklistFacts(
      fakeClient({ names: [] }, { inventory: { p1: problem(500) } }),
      everything,
      signal,
    );
    expect(forbidden.stock).toBe("failed");
  });

  it("lets a thrown error (network, timeout) reject the whole read", async () => {
    const client = fakeClient({ names: [] });
    client.listCategories = () => Promise.reject(new Error("offline"));
    await expect(loadChecklistFacts(client, everything, signal)).rejects.toThrow("offline");
  });
});

describe("checklist preferences", () => {
  it("parses only what it wrote; anything else is nothing stored", () => {
    expect(parsePreferences(null)).toEqual(NO_PREFERENCES);
    expect(parsePreferences("not json")).toEqual(NO_PREFERENCES);
    expect(parsePreferences("[1]")).toEqual(NO_PREFERENCES);
    expect(parsePreferences('{"dismissed":"yes","manualDone":["legal","x"]}')).toEqual({
      dismissed: false,
      manualDone: ["legal"],
    });
    const stored = { dismissed: true, manualDone: ["legal"] as const };
    expect(parsePreferences(serializePreferences(stored))).toEqual(stored);
  });

  it("ticks and unticks a manual step without duplicates", () => {
    const ticked = withManual(NO_PREFERENCES, "legal", true);
    expect(withManual(ticked, "legal", true).manualDone).toEqual(["legal"]);
    expect(withManual(ticked, "legal", false).manualDone).toEqual([]);
  });

  it("keys the storage by the admin's opaque id and never fails when storage throws", () => {
    expect(preferencesKey("abc")).toBe("fluxkit.admin.gettingStarted.abc");
    const values = new Map<string, string>();
    const storage = () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    });
    expect(storePreferences(storage, "a1", { dismissed: true, manualDone: [] })).toBe(true);
    expect(readPreferences(storage, "a1").dismissed).toBe(true);
    expect(readPreferences(storage, "a2").dismissed).toBe(false);
    const blocked = () => {
      throw new Error("SecurityError");
    };
    expect(readPreferences(blocked, "a1")).toEqual(NO_PREFERENCES);
    expect(storePreferences(blocked, "a1", NO_PREFERENCES)).toBe(false);
  });

  it("counts done steps: computed done and ticked manual ones, never a test-only provider", () => {
    const facts: ChecklistFacts = {
      productTypes: "done",
      categories: "todo",
      firstProduct: "done",
      prices: "failed",
      stock: "noAccess",
      shipping: "done",
      payments: "todo",
      email: "testOnly",
    };
    expect(doneCount(facts, NO_PREFERENCES)).toBe(3);
    expect(doneCount(facts, withManual(NO_PREFERENCES, "legal", true))).toBe(4);
    expect(CHECKLIST_STEPS).toHaveLength(9);
  });
});
