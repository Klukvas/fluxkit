import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CUSTOMER_SESSION_COOKIE_NAME } from "../../customers/auth/customer-session-cookie.js";
import { AdminOrdersWorld, countStatements } from "../../test/admin-orders-world.js";
import { createTestCustomer, deleteTestCustomers } from "../../test/customer-fixtures.js";
import { customerLoginCookie } from "../../test/customer-http.js";
import { Shopper } from "../../test/shopper.js";

const PASSWORD = "correct horse battery staple";
const NIL_ID = "00000000-0000-4000-8000-000000000000";

describe("GET /admin/orders?customerId= (real Postgres)", () => {
  let world: AdminOrdersWorld;
  const customers: string[] = [];

  beforeAll(async () => {
    world = await AdminOrdersWorld.start();
  });

  afterAll(async () => {
    await deleteTestCustomers(world.db, customers);
    await world.stop();
  });

  /** A signed-in shopper of a new customer account. */
  async function signedIn(): Promise<{ id: string; email: string; shopper: Shopper }> {
    const account = await createTestCustomer(world.db, { password: PASSWORD });
    customers.push(account.id);
    const cookie = await customerLoginCookie(world.anonymous.baseUrl, account.email, PASSWORD);
    const shopper = new Shopper(world.owner.baseUrl);
    shopper.setCookie(CUSTOMER_SESSION_COOKIE_NAME, cookie.slice(cookie.indexOf("=") + 1));
    return { id: account.id, email: account.email, shopper };
  }

  const numbers = (result: { body: { items: { number: string }[] } }) =>
    result.body.items.map((item) => item.number);

  async function twoCustomersWithOrders() {
    const a = await signedIn();
    const b = await signedIn();
    const a1 = await world.place([{ quantity: 1 }], {}, a.shopper);
    const b1 = await world.place([{ quantity: 1 }], {}, b.shopper);
    const a2 = await world.place([{ quantity: 2 }], {}, a.shopper);
    // A guest who typed the same email as customer A: never listed under A's id.
    const guest = await world.place([{ quantity: 1 }], { email: a.email });
    return { a, b, a1, a2, b1, guest };
  }

  it("lists exactly the orders of that customer, newest first, with the total", async () => {
    const { a, b, a1, a2, b1, guest } = await twoCustomersWithOrders();
    const result = await world.list(`?customerId=${a.id}`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(numbers(result)).toEqual([a2.number, a1.number]);
    expect(result.body.total).toBe(2);
    for (const item of result.body.items) {
      expect(item.customerId).toBe(a.id);
    }
    expect(numbers(await world.list(`?customerId=${b.id}`))).toEqual([b1.number]);
    expect(numbers(result)).not.toContain(guest.number);
    // The email search still finds the guest order and the customer's, so the id filter is what separates them.
    expect(numbers(await world.list(`?q=${encodeURIComponent(a.email)}`))).toEqual(
      expect.arrayContaining([guest.number]),
    );
  });

  it("is an exact match: another customer's id, a customer without orders and an unknown id give an empty page", async () => {
    const { a } = await twoCustomersWithOrders();
    const lonely = await signedIn();
    for (const id of [lonely.id, NIL_ID]) {
      const result = await world.list(`?customerId=${id}`);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ items: [], total: 0 });
    }
    expect((await world.list(`?customerId=${a.id.toUpperCase()}`)).body.total).toBe(2);
  });

  it("combines with status, q, paging and the date window", async () => {
    const { a, a1, a2 } = await twoCustomersWithOrders();
    expect((await world.pay(a1)).status).toBe(200);
    expect(numbers(await world.list(`?customerId=${a.id}&status=paid`))).toEqual([a1.number]);
    expect(numbers(await world.list(`?customerId=${a.id}&status=awaiting_payment`))).toEqual([
      a2.number,
    ]);
    expect(
      numbers(await world.list(`?customerId=${a.id}&q=${encodeURIComponent(a2.number)}`)),
    ).toEqual([a2.number]);
    const page = await world.list(`?customerId=${a.id}&limit=1&offset=1`);
    expect(numbers(page)).toEqual([a1.number]);
    expect(page.body).toMatchObject({ total: 2, limit: 1, offset: 1 });
    const future = encodeURIComponent("2100-01-01T00:00:00Z");
    expect((await world.list(`?customerId=${a.id}&placedFrom=${future}`)).body.total).toBe(0);
  });

  it("rejects a malformed customerId with 400 on that field", async () => {
    for (const query of [
      "?customerId=xyz",
      "?customerId=",
      "?customerId=1234",
      `?customerId=${NIL_ID}x`,
      `?customerId=${NIL_ID}&customerId=${NIL_ID}`,
      "?customerId=%00",
    ]) {
      const result = await world.list(query);
      expect(result.status, query).toBe(400);
      expect(result.body, query).toMatchObject({ code: "validation_failed" });
      // The field is known and its value is wrong (not an `unknown_field`).
      const entries = (result.body.errors ?? []).filter((error) => error.path === "customerId");
      expect(entries.length, query).toBeGreaterThan(0);
      expect(
        entries.map((error) => error.code),
        query,
      ).not.toContain("unknown_field");
    }
  });

  it("stays behind orders.read: the viewer is forbidden, the manager may filter", async () => {
    const { a } = await twoCustomersWithOrders();
    expect((await world.list(`?customerId=${a.id}`, world.viewer)).status).toBe(403);
    expect((await world.list(`?customerId=${a.id}`, world.manager)).status).toBe(200);
    expect((await world.list(`?customerId=${a.id}`, world.anonymous)).status).toBe(401);
  });

  it("costs the same number of statements with and without the filter", async () => {
    const { a } = await twoCustomersWithOrders();
    const without = await countStatements(() => world.list("?limit=100"));
    const filtered = await countStatements(() => world.list(`?customerId=${a.id}&limit=100`));
    expect(filtered).toBe(without);
  });
});
