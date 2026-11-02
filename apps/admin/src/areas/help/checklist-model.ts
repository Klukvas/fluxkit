import type {
  AdminConfig,
  AdminEmailStatus,
  AdminOperationName,
  AdminProductInventory,
  AdminProductList,
  AdminResult,
  AdminShippingMethodList,
  Paginated,
} from "@fluxkit/api-client";
import type { ScreenRouteId } from "./help-model";

/**
 * The "Getting started" checklist (plan decision 5): the setup steps of a new shop in order, each with the help article
 * (and section) that explains it and the screen where it is done. A step is COMPUTED from reads the admin API already has,
 * or MANUAL (ticked by the admin and remembered in this browser) when no existing read can tell. Nothing here writes to
 * the API.
 */

export type ComputedStepId =
  | "productTypes"
  | "categories"
  | "firstProduct"
  | "prices"
  | "stock"
  | "shipping"
  | "payments"
  | "email";
export type ManualStepId = "legal";
export type ChecklistStepId = ComputedStepId | ManualStepId;

export interface ChecklistStep {
  id: ChecklistStepId;
  mode: "computed" | "manual";
  article: string;
  section?: string;
  screen: ScreenRouteId;
}

export const CHECKLIST_STEPS: readonly ChecklistStep[] = [
  {
    id: "productTypes",
    mode: "computed",
    article: "product-types",
    section: "product-types",
    screen: "productTypes",
  },
  {
    id: "categories",
    mode: "computed",
    article: "categories-brands",
    section: "categories",
    screen: "categories",
  },
  { id: "firstProduct", mode: "computed", article: "create-product", screen: "products" },
  { id: "prices", mode: "computed", article: "prices", screen: "products" },
  { id: "stock", mode: "computed", article: "stock", screen: "products" },
  { id: "shipping", mode: "computed", article: "shipping", section: "methods", screen: "shipping" },
  {
    id: "payments",
    mode: "computed",
    article: "payments",
    section: "providers",
    screen: "payments",
  },
  { id: "email", mode: "computed", article: "email", section: "provider", screen: "email" },
  { id: "legal", mode: "manual", article: "first-steps", section: "legal", screen: "home" },
];

/**
 * What a read told about a computed step: done, not yet, done with a TEST-ONLY provider (email `fake`), the role may not
 * run the read (nothing was requested), or the read failed (its status, never a guess).
 */
export type FactState = "done" | "todo" | "testOnly" | "noAccess" | "failed";
export type ChecklistFacts = Readonly<Record<ComputedStepId, FactState>>;

/** How many of the newest published products the stock step looks at (one inventory read each). */
export const STOCK_SAMPLE = 5;

/** The reads the facts need: the admin client's methods of the same names (a fake in the specs). */
export interface ChecklistClient {
  getConfig(options: { signal: AbortSignal }): Promise<AdminResult<AdminConfig>>;
  listProductTypes(options: {
    limit: number;
    signal: AbortSignal;
  }): Promise<AdminResult<Paginated<unknown>>>;
  listCategories(options: {
    limit: number;
    signal: AbortSignal;
  }): Promise<AdminResult<Paginated<unknown>>>;
  listProducts(options: {
    limit: number;
    status?: "active";
    signal: AbortSignal;
  }): Promise<AdminResult<AdminProductList>>;
  getProductInventory(
    id: string,
    options: { signal: AbortSignal },
  ): Promise<AdminResult<AdminProductInventory>>;
  listShippingMethods(options: {
    limit: number;
    signal: AbortSignal;
  }): Promise<AdminResult<AdminShippingMethodList>>;
  getEmailStatus(options: { signal: AbortSignal }): Promise<AdminResult<AdminEmailStatus>>;
}

/** Shipping methods looked at for an active one (the API's page limit; a shop with more is told by the first page anyway). */
const SHIPPING_PAGE = 100;

function fromResult<T>(result: AdminResult<T>, done: (data: T) => boolean): FactState {
  if (!result.ok) return result.status === 403 ? "noAccess" : "failed";
  return done(result.data) ? "done" : "todo";
}

/**
 * Reads what the API already offers and decides each computed step. `can` answers whether the session may run an
 * operation: a read the role may not run is never sent (`noAccess`). A thrown error (network, timeout, abort) rejects the
 * whole promise, so the card shows one failure with a retry instead of a half-true list.
 */
export async function loadChecklistFacts(
  client: ChecklistClient,
  can: (operation: AdminOperationName) => boolean,
  signal: AbortSignal,
): Promise<ChecklistFacts> {
  const ifAllowed = <T>(operation: AdminOperationName, read: () => Promise<T>) =>
    can(operation) ? read() : Promise.resolve(null);

  const [config, productTypes, categories, products, published, shipping, emailStatus] =
    await Promise.all([
      client.getConfig({ signal }),
      ifAllowed("listProductTypes", () => client.listProductTypes({ limit: 1, signal })),
      ifAllowed("listCategories", () => client.listCategories({ limit: 1, signal })),
      ifAllowed("listProducts", () => client.listProducts({ limit: 1, signal })),
      ifAllowed("listProducts", () =>
        client.listProducts({ limit: STOCK_SAMPLE, status: "active", signal }),
      ),
      ifAllowed("listShippingMethods", () =>
        client.listShippingMethods({ limit: SHIPPING_PAGE, signal }),
      ),
      ifAllowed("getEmailStatus", () => client.getEmailStatus({ signal })),
    ]);

  const total = (result: AdminResult<Paginated<unknown>> | null): FactState =>
    result === null ? "noAccess" : fromResult(result, (data) => data.total > 0);

  const stock = await stockFact(client, can, published, signal);

  let payments: FactState;
  let email: FactState;
  if (!config.ok) {
    payments = "failed";
    email = "failed";
  } else {
    payments = config.data.onlinePayment ? "done" : "todo";
    email = emailFact(config.data, emailStatus);
  }

  return {
    productTypes: total(productTypes),
    categories: total(categories),
    firstProduct: total(products),
    // Publishing refuses an active variant without a price in the shop currency (`price_missing`), so a published product
    // proves that prices are set; a draft with prices does not count (it is not for sale).
    prices: total(published),
    stock,
    shipping:
      shipping === null
        ? "noAccess"
        : fromResult(shipping, (data) => data.items.some((method) => method.isActive)),
    payments,
    email,
  };
}

/** Done when one of the newest published products has a variant with stock available, or one that does not count stock. */
async function stockFact(
  client: ChecklistClient,
  can: (operation: AdminOperationName) => boolean,
  published: AdminResult<AdminProductList> | null,
  signal: AbortSignal,
): Promise<FactState> {
  if (published === null || !can("getProductInventory")) return "noAccess";
  if (!published.ok) return published.status === 403 ? "noAccess" : "failed";
  const ids = published.data.items.slice(0, STOCK_SAMPLE).map((product) => product.id);
  if (ids.length === 0) return "todo";
  const inventories = await Promise.all(
    ids.map((id) => client.getProductInventory(id, { signal })),
  );
  let failed = false;
  for (const inventory of inventories) {
    if (!inventory.ok) {
      failed = true;
      continue;
    }
    if (
      inventory.data.items.some((variant) => !variant.trackInventory || variant.totalAvailable > 0)
    ) {
      return "done";
    }
  }
  return failed ? "failed" : "todo";
}

function emailFact(config: AdminConfig, status: AdminResult<AdminEmailStatus> | null): FactState {
  if (!config.emailDelivery) return "todo";
  // Only a session that may read the Email status learns the provider; `fake` writes mails to a file and delivers nothing.
  if (status !== null && status.ok && status.data.providerCode === "fake") return "testOnly";
  return "done";
}

// ------------------------------------------------------------------ what the admin ticked and hid (this browser only)

export interface ChecklistPreferences {
  /** The start page no longer shows the card (it stays under Help). */
  dismissed: boolean;
  /** The manual steps the admin ticked. */
  manualDone: readonly ManualStepId[];
}

export const NO_PREFERENCES: ChecklistPreferences = { dismissed: false, manualDone: [] };

const MANUAL_STEPS: readonly ManualStepId[] = ["legal"];

/** The storage key: per admin user (the opaque id only), so two admins on one browser keep their own list. */
export function preferencesKey(adminUserId: string): string {
  return `fluxkit.admin.gettingStarted.${adminUserId}`;
}

/** Reads a stored value; anything malformed or unknown counts as nothing stored (the list starts empty, never breaks). */
export function parsePreferences(raw: string | null): ChecklistPreferences {
  if (raw === null) return NO_PREFERENCES;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // Not JSON (edited by hand, another version): start empty rather than fail the start page.
    return NO_PREFERENCES;
  }
  if (typeof value !== "object" || value === null) return NO_PREFERENCES;
  const record = value as { dismissed?: unknown; manualDone?: unknown };
  const manualDone = Array.isArray(record.manualDone)
    ? MANUAL_STEPS.filter((step) => (record.manualDone as unknown[]).includes(step))
    : [];
  return { dismissed: record.dismissed === true, manualDone };
}

export function serializePreferences(preferences: ChecklistPreferences): string {
  return JSON.stringify({ dismissed: preferences.dismissed, manualDone: preferences.manualDone });
}

export function withManual(
  preferences: ChecklistPreferences,
  step: ManualStepId,
  done: boolean,
): ChecklistPreferences {
  const others = preferences.manualDone.filter((entry) => entry !== step);
  return { ...preferences, manualDone: done ? [...others, step] : others };
}

/** Steps counted as done: computed ones marked done (a test-only provider is NOT done) and the ticked manual ones. */
export function doneCount(facts: ChecklistFacts, preferences: ChecklistPreferences): number {
  return CHECKLIST_STEPS.filter((step) =>
    step.mode === "manual"
      ? preferences.manualDone.includes(step.id as ManualStepId)
      : facts[step.id as ComputedStepId] === "done",
  ).length;
}
