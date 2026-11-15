import type { AdminClient, AdminOperationName, AdminResult } from "@fluxkit/api-client";
import type { Locale } from "@fluxkit/ui";
import { canRun } from "../../permissions";
import { PATHS } from "../../router/paths";

export const COUNTERS = [
  {
    id: "awaitingPayment",
    operation: "listOrders",
    query: { status: "awaiting_payment", limit: 1, offset: 0 },
    target: `${PATHS.orders}?status=awaiting_payment`,
  },
  {
    id: "paid",
    operation: "listOrders",
    query: { status: "paid", limit: 1, offset: 0 },
    target: `${PATHS.orders}?status=paid`,
  },
  {
    id: "paymentsAttention",
    operation: "listPayments",
    query: { needsAttention: true, limit: 1 },
    target: PATHS.payments,
  },
  {
    id: "customers",
    operation: "listCustomers",
    query: { limit: 1, offset: 0 },
    target: PATHS.customers,
  },
  {
    id: "draftProducts",
    operation: "listProducts",
    query: { status: "draft", limit: 1, offset: 0 },
    target: `${PATHS.products}?status=draft`,
  },
  {
    id: "activeProducts",
    operation: "listProducts",
    query: { status: "active", limit: 1, offset: 0 },
    target: `${PATHS.products}?status=active`,
  },
] as const;
export type WorkspaceCounter = (typeof COUNTERS)[number];

export const QUICK_ACTIONS = [
  { id: "newProduct", operation: "createProduct", target: PATHS.productNew },
  {
    id: "processOrders",
    operation: "listOrders",
    target: `${PATHS.orders}?status=paid`,
  },
  { id: "customers", operation: "listCustomers", target: PATHS.customers },
] as const;
export type WorkspaceAction = (typeof QUICK_ACTIONS)[number];

export function selectWorkspace(permissions: readonly string[] | null) {
  const allowed = (item: { operation: AdminOperationName }) => canRun(permissions, item.operation);
  return { counters: COUNTERS.filter(allowed), actions: QUICK_ACTIONS.filter(allowed) };
}

/** Keep the matching query with its typed client method; no list pages or their modules are imported. */
export async function readCounter(
  client: Pick<AdminClient, "listOrders" | "listPayments" | "listCustomers" | "listProducts">,
  counter: WorkspaceCounter,
  signal: AbortSignal,
): Promise<AdminResult<{ total: number }>> {
  switch (counter.operation) {
    case "listOrders":
      return client.listOrders({ ...counter.query, signal });
    case "listPayments":
      return client.listPayments({ ...counter.query, signal });
    case "listCustomers":
      return client.listCustomers({ ...counter.query, signal });
    case "listProducts":
      return client.listProducts({ ...counter.query, signal });
  }
}

export function formatTotal(total: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(total);
}
