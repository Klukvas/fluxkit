import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SessionService } from "../../auth/session.service.js";
import { SESSION_COOKIE_NAME } from "../../auth/session-cookie.js";
import type { ProblemBody } from "../../common/problem.filter.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { customer } from "../../database/schema/index.js";
import { startApp, type RunningApp } from "../../test/app.js";
import {
  createTestAdminUser,
  deleteTestAdminUsers,
  type TestAdminUser,
} from "../../test/admin-user-fixtures.js";
import {
  createTestCustomer,
  deleteTestCustomers,
  type TestCustomer,
} from "../../test/customer-fixtures.js";
import { customerProbeFeature } from "../../test/customer-probe.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { adminRoutes } from "../../test/routes.js";
import { CUSTOMER_SESSION_COOKIE_NAME } from "./customer-session-cookie.js";
import { CustomerSessionService } from "./customer-session.service.js";

interface Principal {
  customerId?: string;
  userId?: string;
}

/**
 * ADR 0016: an admin session must never be reachable from the storefront and a customer session must never reach
 * `/admin`. Both principals live in different tables, cookies, paths and guards; these tests make a mix-up fail.
 */
describe("customer and admin sessions are separate principals", () => {
  let running: RunningApp;
  let db: Database;
  let adminSessions: SessionService;
  let customerSessions: CustomerSessionService;
  const admins: string[] = [];
  const customers: string[] = [];

  async function newAdmin(): Promise<TestAdminUser> {
    const made = await createTestAdminUser(db, { role: "owner" });
    admins.push(made.id);
    return made;
  }

  async function newCustomer(email?: string): Promise<TestCustomer> {
    const made = await createTestCustomer(db, { email });
    customers.push(made.id);
    return made;
  }

  async function adminCookie(user: TestAdminUser): Promise<string> {
    const { token } = await adminSessions.create(user.id);
    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  async function customerCookie(shopper: TestCustomer): Promise<string> {
    const { token } = await customerSessions.create(shopper.id);
    return `${CUSTOMER_SESSION_COOKIE_NAME}=${token}`;
  }

  const getAs = (path: string, cookie?: string) =>
    http<Principal & ProblemBody>(running.baseUrl, "GET", path, {
      headers: cookie === undefined ? {} : { cookie },
    });

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      extraFeatures: customerProbeFeature,
    });
    db = running.app.get<Database>(DRIZZLE);
    adminSessions = running.app.get(SessionService);
    customerSessions = running.app.get(CustomerSessionService);
  });

  afterEach(async () => {
    await deleteTestAdminUsers(db, admins.splice(0));
    await deleteTestCustomers(db, customers.splice(0));
  });

  afterAll(async () => {
    await running.app.close();
  });

  it("a valid customer cookie on EVERY /admin route of the real router is 401 and authenticates nothing", async () => {
    const shopper = await newCustomer();
    const cookie = await customerCookie(shopper);
    const routes = adminRoutes(running.app);
    expect(routes.length).toBeGreaterThan(50);
    let checked = 0;
    for (const { method, path } of routes) {
      // The login route is public on purpose (it never looks at a cookie); it is asserted separately below.
      if (method === "POST" && path === "/admin/auth/login") continue;
      checked += 1;
      const result = await http<ProblemBody>(running.baseUrl, method as "GET", path, {
        headers: { cookie },
        ...(method === "GET" || method === "DELETE" ? {} : { body: {} }),
      });
      expect(result.status, `${method} ${path}`).toBe(401);
      expect(result.body, `${method} ${path}`).toMatchObject({ code: "unauthorized" });
    }
    expect(checked).toBe(routes.length - 1);
    const me = await getAs("/admin/auth/me", cookie);
    expect(me.status).toBe(401);
  });

  it("the customer token is not an admin token even when sent under the ADMIN cookie name", async () => {
    const shopper = await newCustomer();
    const { token } = await customerSessions.create(shopper.id);
    for (const path of ["/admin/auth/me", "/admin/brands", "/admin/users"]) {
      const result = await getAs(path, `${SESSION_COOKIE_NAME}=${token}`);
      expect(result.status, path).toBe(401);
    }
  });

  it("an admin cookie on a customer-authenticated route is 401, whatever its role", async () => {
    const admin = await newAdmin();
    const cookie = await adminCookie(admin);
    expect((await getAs("/admin/auth/me", cookie)).status).toBe(200);
    for (const path of ["/store/probe-customer/me", "/store/probe-customer-class/one"]) {
      const result = await getAs(path, cookie);
      expect(result.status, path).toBe(401);
      expect(result.body).toMatchObject({ code: "unauthorized" });
    }
    const write = await http<ProblemBody>(running.baseUrl, "POST", "/store/probe-customer/write", {
      body: {},
      headers: { cookie },
    });
    expect(write.status).toBe(401);
  });

  it("the admin token is not a customer token even when sent under the CUSTOMER cookie name", async () => {
    const admin = await newAdmin();
    const { token } = await adminSessions.create(admin.id);
    const result = await getAs(
      "/store/probe-customer/me",
      `${CUSTOMER_SESSION_COOKIE_NAME}=${token}`,
    );
    expect(result.status).toBe(401);
  });

  it("with both cookies, each guard reads only its own and one never lends authority to the other", async () => {
    const admin = await newAdmin();
    const shopper = await newCustomer();
    const [adminSide, customerSide] = [await adminCookie(admin), await customerCookie(shopper)];
    const both = `${adminSide}; ${customerSide}`;

    const asCustomer = await getAs("/store/probe-customer/me", both);
    expect(asCustomer.status).toBe(200);
    expect(asCustomer.body.customerId).toBe(shopper.id);
    expect(asCustomer.body.userId).toBeUndefined();

    const asAdmin = await getAs("/admin/auth/me", both);
    expect(asAdmin.status).toBe(200);
    expect(JSON.stringify(asAdmin.body)).toContain(admin.id);
    expect(JSON.stringify(asAdmin.body)).not.toContain(shopper.id);

    // A valid cookie of one kind does not rescue an invalid cookie of the other kind.
    const bogusCustomer = `${CUSTOMER_SESSION_COOKIE_NAME}=${"A".repeat(43)}`;
    const bogusAdmin = `${SESSION_COOKIE_NAME}=${"A".repeat(43)}`;
    expect((await getAs("/store/probe-customer/me", `${adminSide}; ${bogusCustomer}`)).status).toBe(
      401,
    );
    expect((await getAs("/admin/auth/me", `${customerSide}; ${bogusAdmin}`)).status).toBe(401);
  });

  it("the same email as admin and as customer gives two unrelated accounts and sessions", async () => {
    const admin = await newAdmin();
    const shopper = await newCustomer(admin.email);
    expect(shopper.email).toBe(admin.email);
    const [adminSide, customerSide] = [await adminCookie(admin), await customerCookie(shopper)];

    // Each session is an identity in its own world only.
    expect((await getAs("/store/probe-customer/me", customerSide)).body.customerId).toBe(
      shopper.id,
    );
    expect((await getAs("/admin/auth/me", adminSide)).status).toBe(200);
    expect((await getAs("/store/probe-customer/me", adminSide)).status).toBe(401);
    expect((await getAs("/admin/auth/me", customerSide)).status).toBe(401);

    // Ending the sessions of one never touches the other.
    expect(await adminSessions.revokeAllForUser(admin.id)).toBe(1);
    expect((await getAs("/store/probe-customer/me", customerSide)).status).toBe(200);
    expect(await customerSessions.revokeAllForCustomer(shopper.id)).toBe(1);

    // Deactivating the customer does not deactivate the admin.
    const [freshAdmin, freshShopper] = [await adminCookie(admin), await customerCookie(shopper)];
    await db.update(customer).set({ isActive: false }).where(eq(customer.id, shopper.id));
    expect((await getAs("/store/probe-customer/me", freshShopper)).status).toBe(401);
    expect((await getAs("/admin/auth/me", freshAdmin)).status).toBe(200);
  });

  it("the public admin login route ignores a customer cookie (it never authenticates from it)", async () => {
    const shopper = await newCustomer();
    const result = await http<ProblemBody>(running.baseUrl, "POST", "/admin/auth/login", {
      body: { email: shopper.email, password: "a-long-enough-password-1" },
      headers: { cookie: await customerCookie(shopper) },
    });
    expect(result.status).toBe(401);
  });
});
