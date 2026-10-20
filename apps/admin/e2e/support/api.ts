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

  async createUser(email: string, role: Role, password: string): Promise<AdminUser> {
    return this.post<AdminUser>("/admin/users", { email, role, password }, 201);
  }

  /** The users list, every page (the e2e database holds a few dozen at most). */
  async users(): Promise<AdminUser[]> {
    const page = await this.get<{ items: AdminUser[]; total: number }>("/admin/users?limit=100");
    expect(page.total, "the e2e database holds fewer than 100 admin users").toBeLessThan(100);
    return page.items;
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

  /** A guest order for one unit of a physical seed product, shipped to a demo address; a fresh Idempotency-Key each time. */
  async placeGuestOrder(email: string, slug: string, sku: string): Promise<PlacedOrder> {
    await this.addToCart(await this.variantIdBySku(slug, sku), 1);
    const cart = await json<{ total: Money }>(await this.context.get("/store/cart"), 200);
    const result = await json<{ order: { id: string; number: string; total: Money } }>(
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
    return { ...result.order, email };
  }
}
