import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { adminUser, customer } from "../../database/schema/index.js";
import { createTestAdminUser, deleteTestAdminUsers } from "../../test/admin-user-fixtures.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { login as adminLogin, loginCookie as adminLoginCookie } from "../../test/auth-http.js";
import { createTestCustomer, deleteTestCustomers } from "../../test/customer-fixtures.js";
import { customerLogin, customerLoginCookie } from "../../test/customer-http.js";
import { FakeClock } from "../../test/fake-clock.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { adminRoutes, sweepRequest } from "../../test/routes.js";
import { storeRoutes } from "../../test/store-routes.js";

const ADMIN_PASSWORD = "admin passphrase number one";
const CUSTOMER_PASSWORD = "customer passphrase number two";
const WRONG = "definitely not the password";

/**
 * ADR 0016 on the REAL routes (the 3a separation spec uses probe routes): a customer session never reaches `/admin`,
 * an admin session never reaches `/store/account`, and an admin user and a customer with the same email are two
 * unrelated accounts for login, lockout and password.
 */
describe("customer and admin principals are separate on the real routes", () => {
  const clock = new FakeClock("2030-09-01T08:00:00.000Z");
  let running: RunningApp;
  let db: Database;
  const customers: string[] = [];
  const admins: string[] = [];

  async function pair(sharedEmail?: string) {
    const admin = await createTestAdminUser(db, { role: "owner", password: ADMIN_PASSWORD });
    admins.push(admin.id);
    const shopper = await createTestCustomer(db, {
      email: sharedEmail ?? admin.email,
      password: CUSTOMER_PASSWORD,
    });
    customers.push(shopper.id);
    return { admin, shopper };
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default", clock });
    db = running.app.get<Database>(DRIZZLE);
  });

  afterEach(async () => {
    await deleteTestCustomers(db, customers.splice(0));
    await deleteTestAdminUsers(db, admins.splice(0));
    // Fresh login rate-limit windows (customer and admin) for the next test.
    clock.advanceMinutes(11);
  });

  afterAll(async () => {
    await running.app.close();
  });

  it("a customer cookie from a REAL login is 401 on every /admin route", async () => {
    const { shopper } = await pair();
    const cookie = await customerLoginCookie(running.baseUrl, shopper.email, CUSTOMER_PASSWORD);
    const routes = adminRoutes(running.app).filter(
      ({ method, path }) => !(method === "POST" && path === "/admin/auth/login"),
    );
    expect(routes.some(({ path }) => path.startsWith("/admin/customers"))).toBe(true);
    for (const { method, path } of routes) {
      const result = await http<ProblemBody>(running.baseUrl, method as "GET", path, {
        headers: { cookie },
        ...sweepRequest(method, path),
      });
      expect(result.status, `${method} ${path}`).toBe(401);
    }
  });

  it("an admin cookie from a REAL login is 401 on every authenticated /store/account route", async () => {
    const { admin } = await pair();
    const cookie = await adminLoginCookie(running.baseUrl, admin.email, ADMIN_PASSWORD);
    const routes = storeRoutes(running.app).filter(
      ({ pattern, customerAuthenticated }) =>
        customerAuthenticated && pattern.startsWith("/store/account"),
    );
    expect(routes.map(({ method, pattern }) => `${method} ${pattern}`).sort()).toEqual([
      "GET /store/account/data-export",
      "GET /store/account/me",
      "GET /store/account/orders",
      "GET /store/account/orders/:number",
      "GET /store/account/orders/:number/payments/:paymentId",
      "PATCH /store/account/me",
      "POST /store/account/change-password",
      "POST /store/account/delete",
      "POST /store/account/logout",
      "POST /store/account/orders/:number/cancel",
      "POST /store/account/orders/:number/payments",
      "POST /store/account/verify-email/resend",
    ]);
    for (const { method, path } of routes) {
      const result = await http<ProblemBody>(running.baseUrl, method as "GET", path, {
        headers: { cookie },
        ...(method === "GET" ? {} : { body: {} }),
      });
      expect(result.status, `${method} ${path}`).toBe(401);
    }
    // The admin cookie is valid in its own world.
    expect(
      (await http(running.baseUrl, "GET", "/admin/auth/me", { headers: { cookie } })).status,
    ).toBe(200);
  });

  it("the admin cookie is not a customer session even under the customer cookie name, and the reverse", async () => {
    const { admin, shopper } = await pair();
    const adminCookie = await adminLoginCookie(running.baseUrl, admin.email, ADMIN_PASSWORD);
    const customerCookie = await customerLoginCookie(
      running.baseUrl,
      shopper.email,
      CUSTOMER_PASSWORD,
    );
    const adminToken = adminCookie.split("=")[1] ?? "";
    const customerToken = customerCookie.split("=")[1] ?? "";
    expect(
      (
        await http(running.baseUrl, "GET", "/store/account/me", {
          headers: { cookie: `fluxkit_customer_session=${adminToken}` },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await http(running.baseUrl, "GET", "/admin/auth/me", {
          headers: { cookie: `fluxkit_admin_session=${customerToken}` },
        })
      ).status,
    ).toBe(401);
  });

  it("the same email as admin and customer: each logs in with its OWN password only", async () => {
    const { admin, shopper } = await pair();
    expect(shopper.email).toBe(admin.email);
    expect((await customerLogin(running.baseUrl, shopper.email, ADMIN_PASSWORD)).status).toBe(401);
    expect((await adminLogin(running.baseUrl, admin.email, CUSTOMER_PASSWORD)).status).toBe(401);
    expect((await customerLogin(running.baseUrl, shopper.email, CUSTOMER_PASSWORD)).status).toBe(
      200,
    );
    expect((await adminLogin(running.baseUrl, admin.email, ADMIN_PASSWORD)).status).toBe(200);
  });

  it("the same email: lockout of one never locks the other", async () => {
    const { admin, shopper } = await pair();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await customerLogin(running.baseUrl, shopper.email, WRONG);
    }
    expect((await customerLogin(running.baseUrl, shopper.email, CUSTOMER_PASSWORD)).status).toBe(
      401,
    );
    expect((await adminLogin(running.baseUrl, admin.email, ADMIN_PASSWORD)).status).toBe(200);

    clock.advanceMinutes(11);
    const second = await pair();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await adminLogin(running.baseUrl, second.admin.email, WRONG);
    }
    expect((await adminLogin(running.baseUrl, second.admin.email, ADMIN_PASSWORD)).status).toBe(
      401,
    );
    expect(
      (await customerLogin(running.baseUrl, second.shopper.email, CUSTOMER_PASSWORD)).status,
    ).toBe(200);
    const [row] = await db.select().from(adminUser).where(eq(adminUser.id, second.admin.id));
    expect(row?.failedLoginCount).toBe(5);
    const [shopperRow] = await db.select().from(customer).where(eq(customer.id, second.shopper.id));
    expect(shopperRow?.failedLoginCount).toBe(0);
  });

  it("the same email: changing the customer's password leaves the admin's password and sessions alone, and the reverse", async () => {
    const { admin, shopper } = await pair();
    const adminCookie = await adminLoginCookie(running.baseUrl, admin.email, ADMIN_PASSWORD);
    const customerCookie = await customerLoginCookie(
      running.baseUrl,
      shopper.email,
      CUSTOMER_PASSWORD,
    );

    const changedCustomer = await http(running.baseUrl, "POST", "/store/account/change-password", {
      body: { currentPassword: CUSTOMER_PASSWORD, newPassword: "customer new passphrase 3" },
      headers: { cookie: customerCookie },
    });
    expect(changedCustomer.status).toBe(204);
    expect(
      (await http(running.baseUrl, "GET", "/admin/auth/me", { headers: { cookie: adminCookie } }))
        .status,
    ).toBe(200);
    expect((await adminLogin(running.baseUrl, admin.email, ADMIN_PASSWORD)).status).toBe(200);

    const changedAdmin = await http(running.baseUrl, "POST", "/admin/auth/change-password", {
      body: { currentPassword: ADMIN_PASSWORD, newPassword: "admin new passphrase 4 here" },
      headers: { cookie: adminCookie },
    });
    expect(changedAdmin.status).toBe(204);
    expect(
      (await customerLogin(running.baseUrl, shopper.email, "customer new passphrase 3")).status,
    ).toBe(200);
    expect(
      (
        await http(running.baseUrl, "GET", "/store/account/me", {
          headers: { cookie: customerCookie },
        })
      ).status,
    ).toBe(200);
  });

  it("registering with an admin's email works, and creating an admin with a customer's email works", async () => {
    const admin = await createTestAdminUser(db, { role: "owner", password: ADMIN_PASSWORD });
    admins.push(admin.id);
    const registered = await http<{ customer: { id: string; email: string } }>(
      running.baseUrl,
      "POST",
      "/store/account/register",
      {
        body: { email: admin.email, password: CUSTOMER_PASSWORD, firstName: "A", lastName: "B" },
      },
    );
    expect(registered.status).toBe(201);
    customers.push(registered.body.customer.id);
    expect(registered.body.customer.email).toBe(admin.email);

    const cookie = await adminLoginCookie(running.baseUrl, admin.email, ADMIN_PASSWORD);
    const created = await http<{ id: string }>(running.baseUrl, "POST", "/admin/users", {
      body: { email: "also-a-customer@example.test", role: "viewer", password: ADMIN_PASSWORD },
      headers: { cookie },
    });
    expect(created.status).toBe(201);
    admins.push(created.body.id);
    const shopper = await http<{ customer: { id: string } }>(
      running.baseUrl,
      "POST",
      "/store/account/register",
      {
        body: {
          email: "also-a-customer@example.test",
          password: CUSTOMER_PASSWORD,
          firstName: "A",
          lastName: "B",
        },
      },
    );
    expect(shopper.status).toBe(201);
    customers.push(shopper.body.customer.id);
  });
});
