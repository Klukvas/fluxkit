import { expect, vi } from "vitest";
import pg from "pg";
import type { AdminRole } from "@fluxkit/core";
import type { AdminAuthenticator } from "../auth/admin-authenticator.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import type { ProblemBody } from "../common/problem.filter.js";
import type { AdminOrderDetail, AdminOrderSummary } from "../orders/admin/admin-orders.schemas.js";
import { startApp, type RunningApp, type StartAppOptions } from "./app.js";
import { testPrincipal } from "./allow-all-admin-authenticator.js";
import { CartCatalog } from "./cart-fixtures.js";
import { requireTestDatabaseUrl } from "./env.js";
import { http, type HttpResult } from "./http.js";
import { insertAdminUserRow } from "./inventory-fixtures.js";
import { ensureMigrated } from "./migrate.js";
import { PlacedOrders } from "./order-fixtures.js";
import { checkoutAs, checkoutBody, orderRow } from "./order-http.js";
import { Shopper } from "./shopper.js";

/** TEST ONLY. Shared by the admin order specs. */

/** A detail view, or a problem body (`status` means the order status in one and the HTTP status in the other). */
export type DetailResult = AdminOrderDetail &
  Pick<ProblemBody, "code" | "detail" | "errors" | "rule">;
export interface ListResult extends ProblemBody {
  items: AdminOrderSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface PlaceLine {
  quantity: number;
  price?: number;
  onHand?: number;
  allowBackorder?: boolean;
  digital?: boolean;
  productTitle?: Record<string, string>;
}

export interface PlacedForAdmin {
  id: string;
  number: string;
  total: number;
  email: string;
  accessToken: string;
  lines: { variantId: string; productId: string; quantity: number }[];
}

function authenticatorFor(role: AdminRole, userId: string): AdminAuthenticator {
  return { authenticate: () => ({ ...testPrincipal(role), userId }) };
}

/**
 * TEST ONLY. Four running apps over one database: an owner and a manager that are REAL `admin_user` rows (so the status
 * journal and the `sale` movements can name them), a viewer, and an anonymous one with the real session authenticator.
 * Orders are placed through the real checkout with a catalog written straight into the tables.
 */
export class AdminOrdersWorld {
  readonly pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  readonly catalog = new CartCatalog(this.pool);
  readonly placed = new PlacedOrders(this.pool);
  owner!: RunningApp;
  manager!: RunningApp;
  viewer!: RunningApp;
  anonymous!: RunningApp;
  ownerId = "";
  managerId = "";
  viewerId = "";
  db!: Database;
  private readonly extraApps: RunningApp[] = [];
  private readonly adminIds: string[] = [];
  private counter = 0;

  static async start(options: StartAppOptions = {}): Promise<AdminOrdersWorld> {
    const world = new AdminOrdersWorld();
    await ensureMigrated();
    const shared: StartAppOptions = {
      rateLimits: { checkout: { maxAttempts: 100_000, windowMinutes: 10 } },
      ...options,
    };
    world.ownerId = await insertAdminUserRow(world.pool);
    world.managerId = await insertAdminUserRow(world.pool);
    world.viewerId = await insertAdminUserRow(world.pool);
    world.adminIds.push(world.ownerId, world.managerId, world.viewerId);
    world.owner = await startApp({
      ...shared,
      adminAuthenticator: authenticatorFor("owner", world.ownerId),
    });
    world.manager = await startApp({
      ...shared,
      adminAuthenticator: authenticatorFor("manager", world.managerId),
    });
    world.viewer = await startApp({
      ...shared,
      adminAuthenticator: authenticatorFor("viewer", world.viewerId),
    });
    world.anonymous = await startApp({ ...shared, adminAuthenticator: "production-default" });
    world.db = world.owner.app.get<Database>(DRIZZLE);
    await world.catalog.init();
    return world;
  }

  /** Another app over the same database (the second "instance" of a race), signed in as the owner. */
  async extraOwnerApp(): Promise<RunningApp> {
    const running = await startApp({
      rateLimits: { checkout: { maxAttempts: 100_000, windowMinutes: 10 } },
      adminAuthenticator: authenticatorFor("owner", this.ownerId),
    });
    this.extraApps.push(running);
    return running;
  }

  /** A guest order of the given lines through `POST /store/checkout`. */
  async place(
    lines: PlaceLine[] = [{ quantity: 1 }],
    overrides: Record<string, unknown> = {},
    who: Shopper = new Shopper(this.owner.baseUrl),
  ): Promise<PlacedForAdmin> {
    this.counter += 1;
    const made: PlacedForAdmin["lines"] = [];
    let total = 0;
    for (const line of lines) {
      const { variantId, productId } = await this.catalog.simple({
        trackInventory: line.digital !== true,
        allowBackorder: line.allowBackorder,
        onHand: line.onHand ?? 50,
        price: line.price ?? 1_000,
        digital: line.digital,
        productTitle: line.productTitle,
      });
      const added = await who.post("/store/cart/items", { variantId, quantity: line.quantity });
      expect(added.status, JSON.stringify(added.body)).toBe(200);
      total += line.quantity * (line.price ?? 1_000);
      made.push({ variantId, productId, quantity: line.quantity });
    }
    const email = `buyer-${this.counter}-${this.catalog.runId}@example.test`;
    const body = checkoutBody(total, { email, ...overrides });
    const result = await checkoutAs(who, body);
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    const number = this.placed.track(result.body.order?.number ?? "");
    return {
      id: (await orderRow(this.pool, number)).id,
      number,
      total,
      email: typeof body["email"] === "string" ? body["email"] : email,
      accessToken: result.body.accessToken ?? "",
      lines: made,
    };
  }

  as(role: "owner" | "manager" | "viewer"): RunningApp {
    return this[role];
  }

  get(path: string, running: RunningApp = this.owner): Promise<HttpResult<DetailResult>> {
    return http<DetailResult>(running.baseUrl, "GET", path);
  }

  list(query = "", running: RunningApp = this.owner): Promise<HttpResult<ListResult>> {
    return http<ListResult>(running.baseUrl, "GET", `/admin/orders${query}`);
  }

  detail(id: string, running: RunningApp = this.owner): Promise<HttpResult<DetailResult>> {
    return http<DetailResult>(running.baseUrl, "GET", `/admin/orders/${id}`);
  }

  cancel(
    id: string,
    reason: unknown = "Customer asked",
    running: RunningApp = this.owner,
  ): Promise<HttpResult<DetailResult>> {
    return http<DetailResult>(running.baseUrl, "POST", `/admin/orders/${id}/cancel`, {
      body: { reason },
    });
  }

  markPaid(
    id: string,
    body: unknown,
    running: RunningApp = this.owner,
  ): Promise<HttpResult<DetailResult>> {
    return http<DetailResult>(running.baseUrl, "POST", `/admin/orders/${id}/mark-paid`, { body });
  }

  pay(
    placed: { id: string; total: number },
    reference = "BANK-1",
    running: RunningApp = this.owner,
  ): Promise<HttpResult<DetailResult>> {
    return this.markPaid(
      placed.id,
      { reference, amount: { amount: placed.total, currency: "UAH" } },
      running,
    );
  }

  fulfil(id: string, running: RunningApp = this.owner): Promise<HttpResult<DetailResult>> {
    return http<DetailResult>(running.baseUrl, "POST", `/admin/orders/${id}/mark-fulfilled`);
  }

  async stop(): Promise<void> {
    await this.placed.cleanup();
    for (const running of [
      this.owner,
      this.manager,
      this.viewer,
      this.anonymous,
      ...this.extraApps,
    ]) {
      await running.app.close();
    }
    await this.catalog.cleanup();
    await this.pool.query("delete from admin_user where id = any($1::uuid[])", [this.adminIds]);
    await this.pool.end();
  }
}

/** TEST ONLY. How many statements `run` sends to Postgres (every client of the process, so run nothing else beside it). */
export async function countStatements(run: () => Promise<unknown>): Promise<number> {
  const spy = vi.spyOn(pg.Client.prototype, "query");
  try {
    await run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}
