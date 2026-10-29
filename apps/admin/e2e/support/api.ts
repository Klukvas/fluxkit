import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { randomUUID } from "node:crypto";

/** Every state-changing request carries this header (ADR 0009 for `/admin`, the same rule on `/store`). */
export const CSRF = { "X-Fluxkit-CSRF": "1" } as const;

export interface Money {
  amount: number;
  currency: string;
}

export type Role = "owner" | "manager" | "viewer";

export interface AdminUser {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
}

/** The admin view of one payment attempt, the members the payment scenarios read (`docs/api/payments.md`). */
export interface AdminPaymentView {
  id: string;
  status: string;
  amount: Money;
  finalAmount: Money | null;
  refundedAmount: Money;
  refundableAmount: Money;
  orderOutcome: string | null;
  needsAttention: boolean;
  attentionCode: string | null;
  refunds: { id: string; status: string; amount: Money; reason: string; note: string | null }[];
  history: { source: string; applied: boolean; toStatus: string | null }[];
}

/** Reads a JSON answer and fails with the whole body when the status is not one of the expected ones. */
export async function json<T>(
  response: APIResponse,
  expectedStatus: number | number[],
): Promise<T> {
  const allowed = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  const body = await response.text();
  expect(allowed, `${response.url()} answered ${String(response.status())}: ${body}`).toContain(
    response.status(),
  );
  return (body === "" ? undefined : JSON.parse(body)) as T;
}

/**
 * An admin as the API sees it: the cookie jar of `context` (a browser context's `page.request` shares the page's cookies, so
 * a sign-in here signs the page in) and the client address of its `x-e2e-client` marker. Setup and checks only: what the
 * scenario is about is always done in the browser.
 */
export class AdminApi {
  private constructor(private readonly context: APIRequestContext) {}

  static async signIn(
    context: APIRequestContext,
    email: string,
    password: string,
  ): Promise<AdminApi> {
    await json(
      await context.post("/admin/auth/login", { headers: CSRF, data: { email, password } }),
      200,
    );
    return new AdminApi(context);
  }

  async get<T>(path: string, status = 200): Promise<T> {
    return json<T>(await this.context.get(path), status);
  }

  async post<T>(path: string, data: unknown, status: number | number[] = [200, 201]): Promise<T> {
    return json<T>(await this.context.post(path, { headers: CSRF, data }), status);
  }

  async put<T>(path: string, data: unknown, status: number | number[] = 200): Promise<T> {
    return json<T>(await this.context.put(path, { headers: CSRF, data }), status);
  }

  async patch<T>(path: string, data: unknown, status: number | number[] = 200): Promise<T> {
    return json<T>(await this.context.patch(path, { headers: CSRF, data }), status);
  }

  async delete(path: string, status: number | number[] = 204): Promise<void> {
    await json(await this.context.delete(path, { headers: CSRF }), status);
  }

  async createUser(email: string, role: Role, password: string): Promise<AdminUser> {
    return this.post<AdminUser>("/admin/users", { email, role, password }, 201);
  }

  /** The users list, every page (the e2e database holds a few dozen at most). */
  async users(): Promise<AdminUser[]> {
    const page = await this.get<{ items: AdminUser[]; total: number }>("/admin/users?limit=100");
    expect(page.total, "the e2e database holds fewer than 100 admin users").toBeLessThan(100);
    return page.items;
  }

  /** The id of an order by its number (the store's checkout answer has the number only). */
  async orderIdByNumber(number: string): Promise<string> {
    const page = await this.get<{ items: { id: string; number: string }[] }>(
      `/admin/orders?q=${encodeURIComponent(number)}`,
    );
    const found = page.items.find((order) => order.number === number);
    if (found === undefined) throw new Error(`The admin API lists no order numbered ${number}.`);
    return found.id;
  }

  /** Records the payment of an order (the API checks the amount against the total). */
  async markPaid(orderId: string, reference: string, total: Money): Promise<void> {
    await this.post(`/admin/orders/${orderId}/mark-paid`, { reference, amount: total }, 200);
  }

  /** The payment attempts of an order, oldest first (`docs/api/payments.md`): the members the payment scenarios check. */
  async payments(orderId: string): Promise<AdminPaymentView[]> {
    const answer = await this.get<{ items: AdminPaymentView[] }>(
      `/admin/orders/${orderId}/payments`,
    );
    return answer.items;
  }

  async orderStatus(orderId: string): Promise<string> {
    return (await this.get<{ status: string }>(`/admin/orders/${orderId}`)).status;
  }

  /**
   * A refund request with an explicit `Idempotency-Key`, to prove what the server does with a repeat or a refusal. The status
   * is checked by the caller's `expected`; the parsed body is returned (a problem document for a refusal).
   */
  async refund<T = unknown>(
    orderId: string,
    paymentId: string,
    options: { key: string; amount: Money; note: string; expected: number | number[] },
  ): Promise<{ status: number; body: T }> {
    const response = await this.context.post(
      `/admin/orders/${orderId}/payments/${paymentId}/refunds`,
      {
        headers: { ...CSRF, "Idempotency-Key": options.key },
        data: { amount: options.amount, note: options.note },
      },
    );
    return { status: response.status(), body: await json<T>(response, options.expected) };
  }

  /** A delivery method made through the API (setup of a scenario that is about something else). */
  async createShippingMethod(body: Record<string, unknown>): Promise<{ id: string; code: string }> {
    return this.post<{ id: string; code: string }>("/admin/shipping/methods", body, 201);
  }

  /**
   * Switches every delivery method off. While a method is active, a checkout of goods must name one, which would break the
   * other scenarios' plain checkouts: a scenario that activates a method ends with this, also when it fails.
   */
  async deactivateAllShippingMethods(): Promise<void> {
    const page = await this.get<{ items: { id: string; isActive: boolean }[]; total: number }>(
      "/admin/shipping/methods?limit=100",
    );
    expect(page.total, "the e2e database holds fewer than 100 delivery methods").toBeLessThan(100);
    for (const method of page.items.filter((item) => item.isActive)) {
      await this.patch(`/admin/shipping/methods/${method.id}`, { isActive: false });
    }
  }

  async logout(): Promise<void> {
    await json(await this.context.post("/admin/auth/logout", { headers: CSRF }), 204);
  }
}

export interface PlacedOrder {
  id: string;
  number: string;
  total: Money;
  email: string;
  /** The guest order's access token (what the shopper's order link holds). */
  accessToken: string;
}

/**
 * A shopper on the store API (`/store/*` through the proxy, with its own cookie jar and client address). The admin SPA never
 * calls the store routes; the scenarios use them only to create the orders and customers an admin then works on.
 */
export class StoreApi {
  constructor(private readonly context: APIRequestContext) {}

  async variantIdBySku(slug: string, sku: string): Promise<string> {
    const product = await json<{ variants: { id: string; sku: string }[] }>(
      await this.context.get(`/store/products/${slug}`),
      200,
    );
    const variant = product.variants.find((candidate) => candidate.sku === sku);
    if (variant === undefined) {
      throw new Error(
        `Seed has no variant ${sku} on ${slug}: ${product.variants.map((v) => v.sku).join(", ")}`,
      );
    }
    return variant.id;
  }

  async addToCart(variantId: string, quantity: number): Promise<void> {
    await json(
      await this.context.post("/store/cart/items", {
        headers: CSRF,
        data: { variantId, quantity },
      }),
      [200, 201],
    );
  }

  async register(email: string, password: string): Promise<string> {
    const answer = await json<{ customer: { id: string } }>(
      await this.context.post("/store/account/register", {
        headers: CSRF,
        data: { email, password, firstName: "Api", lastName: "Shopper" },
      }),
      201,
    );
    return answer.customer.id;
  }

  /** One sign-in attempt; answers the status (200 signed in, 401 refused for any reason). */
  async login(email: string, password: string): Promise<number> {
    const response = await this.context.post("/store/account/login", {
      headers: CSRF,
      data: { email, password },
    });
    return response.status();
  }

  /** The status of `GET /store/account/me`: 200 while this cookie jar holds a live customer session, else 401. */
  async me(): Promise<number> {
    return (await this.context.get("/store/account/me")).status();
  }

  /**
   * A guest order for one unit of a physical seed product with a delivery method: the method must be active and serve `UA`.
   * `expectedTotal` is the `total` of the method's option, as the storefront sends it (the browser never adds money).
   */
  async placeGuestOrderWithShipping(
    email: string,
    slug: string,
    sku: string,
    methodCode: string,
  ): Promise<PlacedOrder> {
    await this.addToCart(await this.variantIdBySku(slug, sku), 1);
    const answer = await json<{
      options: { methodCode: string; available: boolean; total: Money | null }[];
    }>(await this.context.get("/store/shipping/options?country=UA"), 200);
    const option = answer.options.find((entry) => entry.methodCode === methodCode);
    if (option === undefined || !option.available || option.total === null) {
      throw new Error(`The method ${methodCode} is not offered: ${JSON.stringify(answer.options)}`);
    }
    const result = await json<{
      order: { id: string; number: string; total: Money };
      accessToken: string;
    }>(
      await this.context.post("/store/checkout", {
        headers: { ...CSRF, "Idempotency-Key": randomUUID() },
        data: {
          email,
          phone: "+380501234567",
          firstName: "Api",
          lastName: "Shopper",
          shippingAddress: { countryCode: "UA", city: "Kyiv", line1: "1 Example Street" },
          shipping: { methodCode },
          expectedTotal: option.total,
        },
      }),
      201,
    );
    return { ...result.order, email, accessToken: result.accessToken };
  }

  /** A guest order for one unit of a physical seed product, shipped to a demo address; a fresh Idempotency-Key each time. */
  async placeGuestOrder(email: string, slug: string, sku: string): Promise<PlacedOrder> {
    await this.addToCart(await this.variantIdBySku(slug, sku), 1);
    const cart = await json<{ total: Money }>(await this.context.get("/store/cart"), 200);
    const result = await json<{
      order: { id: string; number: string; total: Money };
      accessToken: string;
    }>(
      await this.context.post("/store/checkout", {
        headers: { ...CSRF, "Idempotency-Key": randomUUID() },
        data: {
          email,
          phone: "+380501234567",
          firstName: "Api",
          lastName: "Shopper",
          shippingAddress: { countryCode: "UA", city: "Kyiv", line1: "1 Example Street" },
          expectedTotal: cart.total,
        },
      }),
      201,
    );
    return { ...result.order, email, accessToken: result.accessToken };
  }

  /** Cancels an unpaid guest order (the shopper's own cancel, by the order number and token). */
  async cancelGuestOrder(order: PlacedOrder): Promise<void> {
    await json(
      await this.context.post("/store/orders/cancel", {
        headers: CSRF,
        data: { number: order.number, accessToken: order.accessToken },
      }),
      200,
    );
  }

  /** Starts the online payment of a guest order (the storefront's Pay now call); answers the page URL the shopper is sent to. */
  async startGuestPayment(
    order: PlacedOrder,
  ): Promise<{ paymentId: string; status: string; redirectUrl: string }> {
    return json(
      await this.context.post("/store/orders/payments", {
        headers: { ...CSRF, "Idempotency-Key": randomUUID() },
        data: { number: order.number, accessToken: order.accessToken },
      }),
      201,
    );
  }
}
