import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./env.ts";

/** Every state-changing request carries this header (docs/api/customers.md, CSRF on the store; the admin API needs it too). */
const CSRF = { "X-Fluxkit-CSRF": "1" } as const;

export interface Money {
  amount: number;
  currency: string;
}

export interface VariantInfo {
  id: string;
  sku: string;
  price: Money & { compareAtAmount: number | null };
}

export interface ProductInfo {
  id: string;
  slug: string;
  variants: VariantInfo[];
}

/** The pricing of a shipping method (docs/api/shipping.md); amounts are minor units. */
export type ShippingPricing =
  | { type: "flat"; amount: number }
  | { type: "free_over"; amount: number; freeFrom: number }
  | { type: "carrier_on_delivery" };

export interface PlacedOrder {
  number: string;
  /** Guest orders only. */
  accessToken: string | undefined;
  total: Money;
}

export const SHIPPING_ADDRESS = {
  countryCode: "UA",
  city: "Kyiv",
  line1: "1 Example Street",
} as const;

async function json<T>(response: APIResponse, expectedStatus: number | number[]): Promise<T> {
  const allowed = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  const body = await response.text();
  expect(allowed, `${response.url()} answered ${String(response.status())}: ${body}`).toContain(
    response.status(),
  );
  return (body === "" ? undefined : JSON.parse(body)) as T;
}

/**
 * One shopper as the API sees it: a cookie jar (the cart cookie, a customer session) and a client address chosen by the
 * test's `x-e2e-client` marker. Wrapping `page.request` makes the SAME cookies the browser uses, so a cart prepared here is
 * the cart the page shows.
 */
export class StoreApi {
  constructor(private readonly context: APIRequestContext) {}

  async product(slug: string): Promise<ProductInfo> {
    return json(await this.context.get(`/store/products/${slug}`), 200);
  }

  async variantBySku(slug: string, sku: string): Promise<VariantInfo> {
    const product = await this.product(slug);
    const variant = product.variants.find((candidate) => candidate.sku === sku);
    if (variant === undefined) {
      throw new Error(
        `Seed has no variant ${sku} on ${slug}: ${product.variants.map((v) => v.sku).join(", ")}`,
      );
    }
    return variant;
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

  async cartTotal(): Promise<Money> {
    const cart = await json<{ total: Money }>(await this.context.get("/store/cart"), 200);
    return cart.total;
  }

  async register(email: string, password: string): Promise<void> {
    await json(
      await this.context.post("/store/account/register", {
        headers: CSRF,
        data: { email, password, firstName: "Api", lastName: "Shopper" },
      }),
      201,
    );
  }

  async logout(): Promise<void> {
    await json(await this.context.post("/store/account/logout", { headers: CSRF }), [200, 204]);
  }

  /** Places an order for what the cart holds. `email` makes it a guest order (the answer then has the access token). */
  async checkout(options: {
    email?: string;
    idempotencyKey: string;
    shipping: boolean;
  }): Promise<PlacedOrder> {
    const total = await this.cartTotal();
    const response = await this.context.post("/store/checkout", {
      headers: { ...CSRF, "Idempotency-Key": options.idempotencyKey },
      data: {
        ...(options.email === undefined ? {} : { email: options.email }),
        phone: "+380501234567",
        firstName: "Api",
        lastName: "Shopper",
        ...(options.shipping ? { shippingAddress: SHIPPING_ADDRESS } : {}),
        expectedTotal: total,
      },
    });
    const result = await json<{ order: { number: string; total: Money }; accessToken?: string }>(
      response,
      [200, 201],
    );
    return {
      number: result.order.number,
      accessToken: result.accessToken,
      total: result.order.total,
    };
  }
}

/** The owner created by `prepare-database.ts`, signed in. Used only to change the catalog behind the shopper's back. */
export class AdminApi {
  private constructor(private readonly context: APIRequestContext) {}

  static async signIn(context: APIRequestContext): Promise<AdminApi> {
    await json(
      await context.post("/admin/auth/login", {
        headers: CSRF,
        data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      }),
      200,
    );
    return new AdminApi(context);
  }

  async setPrice(productId: string, variantId: string, amount: number): Promise<void> {
    await json(
      await this.context.put(`/admin/products/${productId}/variants/${variantId}/prices/UAH`, {
        headers: CSRF,
        data: { amount },
      }),
      [200, 201],
    );
  }

  /** Sets the counted quantity (journalled as an adjustment); reservations of unpaid orders stay as they are. */
  async setOnHand(productId: string, variantId: string, onHand: number): Promise<void> {
    await json(
      await this.context.post(
        `/admin/products/${productId}/variants/${variantId}/inventory/adjustments`,
        { headers: CSRF, data: { kind: "adjustment", setOnHand: onHand } },
      ),
      [200, 201],
    );
  }

  /**
   * Leaves exactly one unit for sale: the counted quantity becomes `reserved + 1`, so the result does not depend on orders
   * (and their reservations) an earlier attempt of the same test left behind.
   */
  async leaveOneUnit(productId: string, variantId: string): Promise<void> {
    const stock = await json<{ levels: { reserved: number }[] }>(
      await this.context.get(`/admin/products/${productId}/variants/${variantId}/inventory`),
      200,
    );
    const reserved = stock.levels.reduce((sum, level) => sum + level.reserved, 0);
    await this.setOnHand(productId, variantId, reserved + 1);
  }

  /**
   * A shipping method (docs/api/shipping.md), ACTIVE. The `code` must be new in this database. Pricing amounts are minor
   * units of the shop currency.
   */
  async createShippingMethod(input: {
    code: string;
    title: string;
    kind: "address" | "pickup_point" | "store_pickup";
    pricing: ShippingPricing;
    providerCode?: string;
    description?: string;
    countryCodes?: string[];
  }): Promise<{ id: string; code: string }> {
    const text = (value: string) => ({ uk: value, en: value });
    return json(
      await this.context.post("/admin/shipping/methods", {
        headers: CSRF,
        data: {
          code: input.code,
          title: text(input.title),
          ...(input.description === undefined ? {} : { description: text(input.description) }),
          kind: input.kind,
          ...(input.providerCode === undefined ? {} : { providerCode: input.providerCode }),
          pricing: input.pricing,
          countryCodes: input.countryCodes ?? ["UA"],
          isActive: true,
        },
      }),
      201,
    );
  }

  /** Changes the price of a method behind the shopper's back (the whole pricing is replaced). */
  async repriceShippingMethod(id: string, pricing: ShippingPricing): Promise<void> {
    await json(
      await this.context.patch(`/admin/shipping/methods/${id}`, {
        headers: CSRF,
        data: { pricing },
      }),
      200,
    );
  }

  /**
   * Deactivates every active method, so the shop has none again and the other scenarios run as before shipping existed.
   * Methods stay (an order may link one); the codes are never reused.
   */
  async deactivateShippingMethods(): Promise<void> {
    const page = await json<{ items: { id: string; isActive: boolean }[] }>(
      await this.context.get("/admin/shipping/methods?limit=100"),
      200,
    );
    for (const method of page.items.filter((item) => item.isActive)) {
      await json(
        await this.context.patch(`/admin/shipping/methods/${method.id}`, {
          headers: CSRF,
          data: { isActive: false },
        }),
        200,
      );
    }
  }

  /** The order a shopper placed with this email: id, number and the total the API stored. */
  async orderOf(email: string): Promise<{ id: string; number: string; total: Money }> {
    const page = await json<{
      items: { id: string; number: string; email: string | null; total: Money }[];
    }>(await this.context.get(`/admin/orders?q=${encodeURIComponent(email)}&limit=100`), 200);
    const found = page.items.find((order) => order.email === email);
    if (found === undefined) throw new Error(`No order for ${email}`);
    return found;
  }

  /** Records a payment of the full total received outside the system. */
  async markPaid(order: { id: string; total: Money }): Promise<void> {
    await json(
      await this.context.post(`/admin/orders/${order.id}/mark-paid`, {
        headers: CSRF,
        data: { reference: `e2e-${order.id}`, amount: order.total },
      }),
      200,
    );
  }

  /** Creates the carrier waybill of a paid order (the fake provider answers at once) and returns its tracking number. */
  async createShipment(orderId: string): Promise<string> {
    const result = await json<{ shipment: { status: string; trackingNumber: string | null } }>(
      await this.context.post(`/admin/orders/${orderId}/shipments`, {
        headers: CSRF,
        data: {
          weightGrams: 1000,
          lengthMm: 300,
          widthMm: 200,
          heightMm: 100,
          description: "E2E parcel",
        },
      }),
      201,
    );
    if (result.shipment.status !== "created" || result.shipment.trackingNumber === null) {
      throw new Error(`The waybill was not created: ${JSON.stringify(result.shipment)}`);
    }
    return result.shipment.trackingNumber;
  }

  /** The numbers of the orders whose contact email matches `email` (`?q`, docs/api/orders.md). */
  async orderNumbersOf(email: string): Promise<string[]> {
    const page = await json<{ items: { number: string; email: string | null }[] }>(
      await this.context.get(`/admin/orders?q=${encodeURIComponent(email)}&limit=100`),
      200,
    );
    return page.items.filter((order) => order.email === email).map((order) => order.number);
  }
}
