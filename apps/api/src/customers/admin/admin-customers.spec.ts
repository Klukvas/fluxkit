import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { formatOrderNumber, permissionsOf, type AdminRole } from "@fluxkit/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { customer, customerSession, salesOrder } from "../../database/schema/index.js";
import { startApp, type RunningApp } from "../../test/app.js";
import {
  createTestCustomer,
  deleteTestCustomers,
  type TestCustomer,
} from "../../test/customer-fixtures.js";
import { customerCookieOf, customerLogin } from "../../test/customer-http.js";
import { FakeClock } from "../../test/fake-clock.js";
import { http, type HttpResult } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { SOME_ID } from "../../test/routes.js";

const PASSWORD = "correct horse battery staple";
const WRONG = "definitely not the password";

interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
type Detail = Record<string, unknown>;

describe("admin customer management", () => {
  const clock = new FakeClock("2030-07-01T08:00:00.000Z");
  let owner: RunningApp;
  let manager: RunningApp;
  let viewer: RunningApp;
  let anonymous: RunningApp;
  let db: Database;
  const created: string[] = [];
  const orders: string[] = [];

  async function newCustomer(
    options: { email?: string; isActive?: boolean; password?: string } = {},
  ): Promise<TestCustomer> {
    const made = await createTestCustomer(db, { password: PASSWORD, ...options });
    created.push(made.id);
    return made;
  }

  async function sessionCount(customerId: string): Promise<number> {
    return db.$count(customerSession, eq(customerSession.customerId, customerId));
  }

  async function stateOf(id: string) {
    const [row] = await db.select().from(customer).where(eq(customer.id, id));
    if (row === undefined) {
      throw new Error("customer vanished");
    }
    return row;
  }

  async function placeOrderOf(customerId: string): Promise<void> {
    const [row] = await db
      .insert(salesOrder)
      .values({
        number: formatOrderNumber(randomBytes(5)),
        status: "awaiting_payment",
        customerId,
        email: "buyer@example.test",
        phone: "+380501234567",
        firstName: "Ann",
        lastName: "Buyer",
        locale: "uk",
        currency: "UAH",
        subtotalAmount: 2000,
        shippingTotal: 0,
        discountTotal: 0,
        taxTotal: 0,
        totalAmount: 2000,
        idempotencyKey: randomUUID(),
        requestFingerprint: "a".repeat(64),
        expiresAt: new Date("2099-01-01T00:00:00Z"),
      })
      .returning({ id: salesOrder.id });
    if (row !== undefined) {
      orders.push(row.id);
    }
  }

  beforeAll(async () => {
    await ensureMigrated();
    owner = await startApp({ clock });
    manager = await startApp({ adminPrincipal: { role: "manager" }, clock });
    viewer = await startApp({ adminPrincipal: { role: "viewer" }, clock });
    anonymous = await startApp({ adminAuthenticator: "production-default", clock });
    db = owner.app.get<Database>(DRIZZLE);
  });

  afterEach(async () => {
    for (const id of orders.splice(0)) {
      await db.delete(salesOrder).where(eq(salesOrder.id, id));
    }
    await deleteTestCustomers(db, created.splice(0));
    // A fresh customer login rate-limit window for the next test (the limiter shares this clock).
    clock.advanceMinutes(11);
  });

  afterAll(async () => {
    for (const started of [owner, manager, viewer, anonymous]) {
      await started.app.close();
    }
  });

  describe("permission matrix on every new route", () => {
    interface Case {
      name: string;
      permission: "customers.read" | "customers.write";
      call: (baseUrl: string, id: string, csrf?: boolean) => Promise<HttpResult<unknown>>;
      allowedStatus: number;
    }
    const cases: Case[] = [
      {
        name: "GET /admin/customers",
        permission: "customers.read",
        call: (url, _id, csrf) => http(url, "GET", "/admin/customers", { csrf }),
        allowedStatus: 200,
      },
      {
        name: "GET /admin/customers/:id",
        permission: "customers.read",
        call: (url, id, csrf) => http(url, "GET", `/admin/customers/${id}`, { csrf }),
        allowedStatus: 200,
      },
      {
        name: "PATCH /admin/customers/:id",
        permission: "customers.write",
        call: (url, id, csrf) =>
          http(url, "PATCH", `/admin/customers/${id}`, { body: { isActive: true }, csrf }),
        allowedStatus: 200,
      },
      {
        name: "POST /admin/customers/:id/unlock",
        permission: "customers.write",
        call: (url, id, csrf) => http(url, "POST", `/admin/customers/${id}/unlock`, { csrf }),
        allowedStatus: 204,
      },
    ];

    it.each(cases)(
      "$name: 401 anonymous, 403 without the CSRF header, 403 viewer, 200 manager and owner",
      async (route) => {
        const shopper = await newCustomer();
        const asAnonymous = await route.call(anonymous.baseUrl, shopper.id);
        expect(asAnonymous.status, "anonymous").toBe(401);
        expect(asAnonymous.headers.get("cache-control")).toBe("no-store");

        if (route.name.startsWith("GET")) {
          // GET has no CSRF rule: it is the permission that decides.
        } else {
          const noCsrf = await route.call(owner.baseUrl, shopper.id, false);
          expect(noCsrf.status, "owner without CSRF header").toBe(403);
          const anonymousNoCsrf = await route.call(anonymous.baseUrl, shopper.id, false);
          expect(anonymousNoCsrf.status, "anonymous without CSRF header").toBe(403);
        }

        const asViewer = await route.call(viewer.baseUrl, shopper.id);
        expect(asViewer.status, "viewer").toBe(403);
        expect(asViewer.body).toMatchObject({ code: "forbidden" });
        expect((asViewer.body as ProblemBody).detail).toContain(route.permission);
        expect(permissionsOf("viewer")).not.toContain(route.permission);

        for (const [role, running] of [
          ["manager", manager],
          ["owner", owner],
        ] as [AdminRole, RunningApp][]) {
          expect(permissionsOf(role)).toContain(route.permission);
          const result = await route.call(running.baseUrl, shopper.id);
          expect(result.status, role).toBe(route.allowedStatus);
        }
      },
    );

    it("an unknown customer is 404 for the roles that may ask, and a malformed id is 400", async () => {
      for (const running of [manager, owner]) {
        expect((await http(running.baseUrl, "GET", `/admin/customers/${SOME_ID}`)).status).toBe(
          404,
        );
        expect(
          (
            await http(running.baseUrl, "PATCH", `/admin/customers/${SOME_ID}`, {
              body: { isActive: false },
            })
          ).status,
        ).toBe(404);
        expect(
          (await http(running.baseUrl, "POST", `/admin/customers/${SOME_ID}/unlock`)).status,
        ).toBe(404);
        expect((await http(running.baseUrl, "GET", "/admin/customers/not-a-uuid")).status).toBe(
          400,
        );
      }
    });
  });

  describe("GET /admin/customers", () => {
    const list = (query = "", running = owner) =>
      http<Page<Detail> & ProblemBody>(running.baseUrl, "GET", `/admin/customers${query}`);

    it("lists summary fields only, ordered by email, and never a hash or lockout field", async () => {
      const [b, a] = [
        await newCustomer({ email: "list-b@example.test" }),
        await newCustomer({ email: "list-a@example.test" }),
      ];
      const result = await list("?q=list-");
      expect(result.status).toBe(200);
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(result.body.items.map((item) => item["id"])).toEqual([a.id, b.id]);
      expect(result.body).toMatchObject({ total: 2, limit: 50, offset: 0 });
      expect(Object.keys(result.body.items[0] ?? {}).sort()).toEqual(
        ["createdAt", "email", "firstName", "id", "isActive", "lastLoginAt", "lastName"].sort(),
      );
      const wire = JSON.stringify(result.body);
      for (const forbidden of [
        "scrypt",
        "passwordHash",
        "failedLoginCount",
        "lockedUntil",
        "phone",
      ]) {
        expect(wire, forbidden).not.toContain(forbidden);
      }
    });

    it("pages with limit and offset and reports the total of the whole match", async () => {
      for (const letter of ["a", "b", "c"]) {
        await newCustomer({ email: `paging-${letter}@example.test` });
      }
      const first = await list("?q=paging-&limit=2&offset=0");
      const second = await list("?q=paging-&limit=2&offset=2");
      expect(first.body.items.map((item) => item["email"])).toEqual([
        "paging-a@example.test",
        "paging-b@example.test",
      ]);
      expect(second.body.items.map((item) => item["email"])).toEqual(["paging-c@example.test"]);
      expect(first.body.total).toBe(3);
      expect(second.body).toMatchObject({ total: 3, limit: 2, offset: 2 });
    });

    it("`q` is a case-insensitive email PREFIX; % and _ are literal text, not wildcards", async () => {
      await newCustomer({ email: "prefix-one@example.test" });
      await newCustomer({ email: "xprefix-two@example.test" });
      await newCustomer({ email: "prefix_three@example.test" });
      const emails = async (query: string) =>
        (await list(query)).body.items.map((item) => item["email"]);
      expect(await emails("?q=prefix-")).toEqual(["prefix-one@example.test"]);
      expect(await emails("?q=%20PREFIX-O")).toEqual(["prefix-one@example.test"]);
      expect(await emails("?q=prefix_")).toEqual(["prefix_three@example.test"]);
      expect(await emails("?q=%25")).toEqual([]);
      expect(await emails("?q=prefix%25")).toEqual([]);
      expect(await emails("?q=zzz-no-such")).toEqual([]);
    });

    it("rejects bad paging with 400", async () => {
      for (const query of [
        "?limit=0",
        "?limit=101",
        "?limit=x",
        "?offset=-1",
        `?q=${"a".repeat(255)}`,
      ]) {
        expect((await list(query)).status, query).toBe(400);
      }
    });
  });

  describe("GET /admin/customers/:id", () => {
    it("returns the customer with a real order count (a COUNT over sales_order, 0 without orders)", async () => {
      const shopper = await newCustomer();
      const empty = await http<Detail>(owner.baseUrl, "GET", `/admin/customers/${shopper.id}`);
      expect(empty.status).toBe(200);
      expect(empty.body).toMatchObject({
        id: shopper.id,
        email: shopper.email,
        firstName: "Test",
        lastName: "Customer",
        phone: null,
        isActive: true,
        isLocked: false,
        orderCount: 0,
        lastLoginAt: null,
      });
      expect(Object.keys(empty.body).sort()).toEqual(
        [
          "createdAt",
          "email",
          "firstName",
          "id",
          "isActive",
          "isLocked",
          "lastLoginAt",
          "lastName",
          "orderCount",
          "phone",
          "updatedAt",
        ].sort(),
      );
      await placeOrderOf(shopper.id);
      await placeOrderOf(shopper.id);
      const other = await newCustomer();
      await placeOrderOf(other.id);
      const counted = await http<Detail>(owner.baseUrl, "GET", `/admin/customers/${shopper.id}`);
      expect(counted.body["orderCount"]).toBe(2);
      expect(JSON.stringify(counted.body)).not.toMatch(/scrypt|failedLoginCount|lockedUntil/);
    });

    it("shows isLocked while a lock is in force and not after it", async () => {
      const shopper = await newCustomer();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await customerLogin(owner.baseUrl, shopper.email, WRONG);
      }
      const locked = await http<Detail>(owner.baseUrl, "GET", `/admin/customers/${shopper.id}`);
      expect(locked.body["isLocked"]).toBe(true);
      clock.advanceMinutes(15);
      const expired = await http<Detail>(owner.baseUrl, "GET", `/admin/customers/${shopper.id}`);
      expect(expired.body["isLocked"]).toBe(false);
    });
  });

  describe("PATCH /admin/customers/:id (activity)", () => {
    const setActive = (id: string, isActive: unknown) =>
      http<Detail & ProblemBody>(owner.baseUrl, "PATCH", `/admin/customers/${id}`, {
        body: { isActive },
      });

    it("deactivating deletes ALL the customer's sessions at once and refuses sign-in with the identical 401", async () => {
      const shopper = await newCustomer();
      const bystander = await newCustomer();
      const cookies: string[] = [];
      for (let session = 0; session < 3; session += 1) {
        cookies.push(
          customerCookieOf(await customerLogin(owner.baseUrl, shopper.email, PASSWORD)) ?? "",
        );
      }
      const bystanderCookie =
        customerCookieOf(await customerLogin(owner.baseUrl, bystander.email, PASSWORD)) ?? "";
      expect(await sessionCount(shopper.id)).toBe(3);
      for (const cookie of cookies) {
        expect(
          (await http(owner.baseUrl, "GET", "/store/account/me", { headers: { cookie } })).status,
        ).toBe(200);
      }

      const result = await setActive(shopper.id, false);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ id: shopper.id, isActive: false });
      expect(result.headers.get("cache-control")).toBe("no-store");

      expect(await sessionCount(shopper.id)).toBe(0);
      for (const cookie of cookies) {
        expect(
          (await http(owner.baseUrl, "GET", "/store/account/me", { headers: { cookie } })).status,
        ).toBe(401);
      }
      // Sign-in is refused with the same answer an unknown email gets.
      const refused = await customerLogin(owner.baseUrl, shopper.email, PASSWORD);
      const unknown = await customerLogin(owner.baseUrl, "nobody-at-all@example.test", PASSWORD);
      expect(refused.status).toBe(401);
      expect(refused.body).toEqual(unknown.body);
      expect(refused.headers.get("set-cookie")).toBeNull();
      expect(await sessionCount(shopper.id)).toBe(0);
      // Nobody else is affected.
      expect(
        (
          await http(owner.baseUrl, "GET", "/store/account/me", {
            headers: { cookie: bystanderCookie },
          })
        ).status,
      ).toBe(200);
    });

    it("reactivating lets the customer sign in again (old sessions stay gone)", async () => {
      const shopper = await newCustomer();
      const cookie =
        customerCookieOf(await customerLogin(owner.baseUrl, shopper.email, PASSWORD)) ?? "";
      await setActive(shopper.id, false);
      const back = await setActive(shopper.id, true);
      expect(back.body).toMatchObject({ isActive: true });
      expect(
        (await http(owner.baseUrl, "GET", "/store/account/me", { headers: { cookie } })).status,
      ).toBe(401);
      expect((await customerLogin(owner.baseUrl, shopper.email, PASSWORD)).status).toBe(200);
    });

    it("deactivating twice is fine and still leaves no session", async () => {
      const shopper = await newCustomer();
      await customerLogin(owner.baseUrl, shopper.email, PASSWORD);
      expect((await setActive(shopper.id, false)).status).toBe(200);
      expect((await setActive(shopper.id, false)).status).toBe(200);
      expect(await sessionCount(shopper.id)).toBe(0);
    });

    it("a sign-in racing a deactivation can never leave a live session behind", async () => {
      for (let round = 0; round < 12; round += 1) {
        clock.advanceMinutes(11);
        const shopper = await newCustomer();
        await Promise.all([
          customerLogin(owner.baseUrl, shopper.email, PASSWORD),
          customerLogin(owner.baseUrl, shopper.email, PASSWORD),
          setActive(shopper.id, false),
        ]);
        expect(await sessionCount(shopper.id), `round ${round}`).toBe(0);
        expect((await customerLogin(owner.baseUrl, shopper.email, PASSWORD)).status).toBe(401);
      }
    });

    it("changes nothing but activity: strict body, every other field is 400", async () => {
      const shopper = await newCustomer();
      const before = await stateOf(shopper.id);
      const bodies: [string, unknown][] = [
        ["email", { isActive: true, email: "x@example.test" }],
        ["passwordHash", { isActive: true, passwordHash: "x" }],
        ["password", { isActive: true, password: "a very long password here" }],
        ["firstName", { isActive: true, firstName: "X" }],
        ["failedLoginCount", { isActive: true, failedLoginCount: 0 }],
      ];
      for (const [field, body] of bodies) {
        const result = await http<ProblemBody>(
          owner.baseUrl,
          "PATCH",
          `/admin/customers/${shopper.id}`,
          {
            body,
          },
        );
        expect(result.status, field).toBe(400);
        expect(result.body.errors).toContainEqual(
          expect.objectContaining({ path: field, code: "unknown_field" }),
        );
      }
      for (const body of [{}, { isActive: "yes" }, { isActive: null }]) {
        expect(
          (await http(owner.baseUrl, "PATCH", `/admin/customers/${shopper.id}`, { body })).status,
        ).toBe(400);
      }
      expect(await stateOf(shopper.id)).toEqual(before);
    });
  });

  describe("POST /admin/customers/:id/unlock", () => {
    it("clears the lock and the counter: 204, and the customer can sign in at once", async () => {
      const shopper = await newCustomer();
      const bystander = await newCustomer();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await customerLogin(owner.baseUrl, shopper.email, WRONG);
      }
      await customerLogin(owner.baseUrl, bystander.email, WRONG);
      expect((await stateOf(shopper.id)).lockedUntil).not.toBeNull();
      expect((await customerLogin(owner.baseUrl, shopper.email, PASSWORD)).status).toBe(401);

      const result = await http<undefined>(
        owner.baseUrl,
        "POST",
        `/admin/customers/${shopper.id}/unlock`,
      );
      expect(result.status).toBe(204);
      expect(result.body).toBeUndefined();
      expect(result.headers.get("cache-control")).toBe("no-store");
      const row = await stateOf(shopper.id);
      expect(row.failedLoginCount).toBe(0);
      expect(row.lockedUntil).toBeNull();
      expect((await customerLogin(owner.baseUrl, shopper.email, PASSWORD)).status).toBe(200);
      // Another customer's counter is untouched.
      expect((await stateOf(bystander.id)).failedLoginCount).toBe(1);
    });

    it("also works on a customer that is not locked, and on an inactive one", async () => {
      const shopper = await newCustomer({ isActive: false });
      expect(
        (await http(owner.baseUrl, "POST", `/admin/customers/${shopper.id}/unlock`)).status,
      ).toBe(204);
      expect((await stateOf(shopper.id)).isActive).toBe(false);
    });
  });

  describe("what an admin cannot do", () => {
    it("has no way to delete a customer, set a password or create one", async () => {
      const shopper = await newCustomer();
      for (const [method, path] of [
        ["DELETE", `/admin/customers/${shopper.id}`],
        ["PUT", `/admin/customers/${shopper.id}`],
        ["POST", "/admin/customers"],
        ["POST", `/admin/customers/${shopper.id}/reset-password`],
        ["POST", `/admin/customers/${shopper.id}/password`],
      ] as const) {
        const result = await http<ProblemBody>(owner.baseUrl, method, path, { body: {} });
        expect(result.status, `${method} ${path}`).toBe(404);
      }
      expect((await stateOf(shopper.id)).id).toBe(shopper.id);
    });
  });
});
