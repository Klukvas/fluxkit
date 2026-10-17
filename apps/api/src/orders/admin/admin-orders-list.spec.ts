import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdminOrdersWorld,
  countStatements,
  type PlacedForAdmin,
} from "../../test/admin-orders-world.js";
import { deleteOrders, insertSoldLine } from "../../test/order-fixtures.js";
import { OrdersService } from "../orders.service.js";

/** Pins the placement instant (and a later expiry, the table checks `expires_at > placed_at`) of an order. */
async function setPlacedAt(world: AdminOrdersWorld, id: string, at: string): Promise<void> {
  await world.pool.query(
    `update sales_order set placed_at = $2::timestamptz, expires_at = $2::timestamptz + interval '1 hour' where id = $1`,
    [id, at],
  );
}

describe("GET /admin/orders: filters, paging, order and cost (real Postgres)", () => {
  let world: AdminOrdersWorld;
  const bulk: string[] = [];

  beforeAll(async () => {
    world = await AdminOrdersWorld.start();
  });

  afterAll(async () => {
    await deleteOrders(world.pool, bulk);
    await world.stop();
  });

  /** A window of the calendar nobody else uses, so a spec lists only its own orders in a shared database. */
  let nextYear = 2101;
  function window(): { from: string; to: string; at(minute: number): string; query: string } {
    nextYear += 1;
    const from = `${String(nextYear)}-01-01T00:00:00.000Z`;
    const to = `${String(nextYear)}-12-31T00:00:00.000Z`;
    return {
      from,
      to,
      at: (minute: number) =>
        new Date(Date.UTC(nextYear, 5, 1, 0, minute, 0)).toISOString(),
      query: `placedFrom=${encodeURIComponent(from)}&placedTo=${encodeURIComponent(to)}`,
    };
  }

  async function placeInWindow(
    win: ReturnType<typeof window>,
    minutes: number[],
    overrides: Record<string, unknown> = {},
  ): Promise<PlacedForAdmin[]> {
    const placed: PlacedForAdmin[] = [];
    for (const minute of minutes) {
      const order = await world.place([{ quantity: 1 }], overrides);
      await setPlacedAt(world, order.id, win.at(minute));
      placed.push(order);
    }
    return placed;
  }

  it("lists summaries only, newest first, with the total, the default page size 20 and exactly these fields", async () => {
    const win = window();
    const [oldest, middle, newest] = await placeInWindow(win, [1, 2, 3]);
    const result = await world.list(`?${win.query}`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.body.items.map((item) => item.number)).toEqual([
      newest?.number,
      middle?.number,
      oldest?.number,
    ]);
    expect(result.body).toMatchObject({ total: 3, limit: 20, offset: 0 });
    const first = result.body.items[0];
    expect(Object.keys(first ?? {}).sort()).toEqual(
      [
        "currency",
        "customerId",
        "email",
        "expiresAt",
        "id",
        "itemCount",
        "number",
        "placedAt",
        "status",
        "total",
      ].sort(),
    );
    expect(first).toMatchObject({
      id: newest?.id,
      status: "awaiting_payment",
      total: { amount: 1000, currency: "UAH" },
      currency: "UAH",
      customerId: null,
      email: newest?.email,
      itemCount: 1,
      placedAt: win.at(3),
    });
    const wire = JSON.stringify(result.body);
    for (const forbidden of [
      "shippingAddress",
      "billingAddress",
      "phone",
      "firstName",
      "lastName",
      "Хрещатик",
      "380501234567",
      "accessToken",
      "access_token",
      "tokenHash",
      "idempotency",
      "fingerprint",
    ]) {
      expect(wire, forbidden).not.toContain(forbidden);
    }
  });

  it("counts units over all lines as itemCount", async () => {
    const win = window();
    const [order] = await placeInWindow(win, [1]);
    expect(order).toBeDefined();
    const second = await world.place([{ quantity: 3 }, { quantity: 2 }]);
    await setPlacedAt(world, second.id, win.at(2));
    const result = await world.list(`?${win.query}`);
    expect(result.body.items.map((item) => item.itemCount)).toEqual([5, 1]);
  });

  describe("a total order: equal instants never swap places between pages", () => {
    it("orders by placed_at descending, then id descending, and pages cover every order exactly once", async () => {
      const win = window();
      const same = await placeInWindow(win, [7, 7, 7, 7, 7, 7, 7, 7]);
      const newer = await placeInWindow(win, [9]);
      const older = await placeInWindow(win, [5]);
      const expectedTies = same.map((order) => order.id).sort((a, b) => (a < b ? 1 : -1));
      const expected = [newer[0]?.id, ...expectedTies, older[0]?.id];

      const whole = await world.list(`?${win.query}&limit=100`);
      expect(whole.body.items.map((item) => item.id)).toEqual(expected);

      const seen: string[] = [];
      for (let offset = 0; offset < expected.length; offset += 3) {
        const page = await world.list(`?${win.query}&limit=3&offset=${String(offset)}`);
        expect(page.body.total).toBe(expected.length);
        seen.push(...page.body.items.map((item) => item.id));
      }
      expect(seen).toEqual(expected);
      expect(new Set(seen).size).toBe(expected.length);
    });
  });

  describe("filters", () => {
    it("status: each of the five, alone and with the date window", async () => {
      const win = window();
      const [awaiting, paid, fulfilled, cancelled, expired] = await placeInWindow(
        win,
        [1, 2, 3, 4, 5],
      );
      expect((await world.pay(paid as PlacedForAdmin)).status).toBe(200);
      expect((await world.pay(fulfilled as PlacedForAdmin)).status).toBe(200);
      expect((await world.fulfil(fulfilled?.id ?? "")).status).toBe(200);
      expect((await world.cancel(cancelled?.id ?? "")).status).toBe(200);
      await world.pool.query(
        "update sales_order set expires_at = placed_at + interval '1 minute' where id = $1",
        [expired?.id],
      );
      const orders = world.owner.app.get(OrdersService);
      expect(await orders.expireOne(expired?.id ?? "", new Date(win.at(59)))).toBe("expired");

      const byStatus = async (status: string) =>
        (await world.list(`?${win.query}&status=${status}`)).body.items.map((item) => item.id);
      expect(await byStatus("awaiting_payment")).toEqual([awaiting?.id]);
      expect(await byStatus("paid")).toEqual([paid?.id]);
      expect(await byStatus("fulfilled")).toEqual([fulfilled?.id]);
      expect(await byStatus("cancelled")).toEqual([cancelled?.id]);
      expect(await byStatus("expired")).toEqual([expired?.id]);
      expect((await world.list(`?${win.query}`)).body.total).toBe(5);
    });

    it("placedFrom is inclusive, placedTo is exclusive, offsets are honoured, and an empty range is empty", async () => {
      const win = window();
      const [a, b, c] = await placeInWindow(win, [10, 20, 30]);
      const ids = async (query: string) =>
        (await world.list(`?${query}`)).body.items.map((item) => item.id);
      const at = (minute: number) => encodeURIComponent(win.at(minute));
      expect(await ids(`placedFrom=${at(20)}&placedTo=${at(30)}`)).toEqual([b?.id]);
      expect(await ids(`placedFrom=${at(20)}&placedTo=${at(31)}`)).toEqual([c?.id, b?.id]);
      expect(await ids(`placedFrom=${at(10)}&placedTo=${at(20)}`)).toEqual([a?.id]);
      expect(await ids(`placedFrom=${at(20)}&placedTo=${at(20)}`)).toEqual([]);
      // The same instant (minute 20) written with an offset of +02:00.
      const shifted = new Date(Date.parse(win.at(20)) + 2 * 3_600_000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "+02:00");
      expect(await ids(`placedFrom=${encodeURIComponent(shifted)}&placedTo=${at(30)}`)).toEqual([
        b?.id,
      ]);
      expect(await ids(`placedFrom=${at(0)}&placedTo=${at(59)}&limit=1&offset=1`)).toEqual([
        b?.id,
      ]);
    });

    it("the total counts the whole match, not the page; an offset past the end is an empty page with the same total", async () => {
      const win = window();
      await placeInWindow(win, [1, 2, 3, 4, 5]);
      const page = await world.list(`?${win.query}&limit=2&offset=4`);
      expect(page.body.items).toHaveLength(1);
      expect(page.body).toMatchObject({ total: 5, limit: 2, offset: 4 });
      const beyond = await world.list(`?${win.query}&limit=2&offset=6000`);
      expect(beyond.body.items).toEqual([]);
      expect(beyond.body.total).toBe(5);
    });
  });

  describe("q: an exact order number or an exact email, nothing else", () => {
    it("finds an order by its number in every form a person types it", async () => {
      const win = window();
      const [target, other] = await placeInWindow(win, [1, 2]);
      // A number with the look-alike symbols: stored `1A0B-C2D3`, typed with I and O.
      await world.pool.query("update sales_order set number = '1A0B-C2D3' where id = $1", [
        target?.id,
      ]);
      const ids = async (q: string) =>
        (await world.list(`?${win.query}&q=${encodeURIComponent(q)}`)).body.items.map(
          (item) => item.id,
        );
      for (const typed of [
        "1A0B-C2D3",
        "1a0b-c2d3",
        "1A0BC2D3",
        "1a0bc2d3",
        "  1A0B-C2D3  ",
        "IAOB-C2D3",
        "laob-c2d3",
        "iaobc2d3",
      ]) {
        expect(await ids(typed), typed).toEqual([target?.id]);
      }
      // Exactly the whole number: a prefix, a suffix, a half or an extra symbol finds nothing.
      for (const typed of ["1A0B", "C2D3", "1A0B-C2D", "1A0B-C2D3X", "A0B-C2D3", "1A0B-C2D4", "1A0B C2D3"]) {
        expect(await ids(typed), typed).toEqual([]);
      }
      expect(await ids(other?.number ?? "")).toEqual([other?.id]);
      // The cleanup of the world finds orders by the number they were placed with.
      await world.pool.query("update sales_order set number = $2 where id = $1", [
        target?.id,
        target?.number,
      ]);
    });

    it("finds an order by its exact email, ignoring case and surrounding spaces; never by prefix, suffix, substring or wildcard", async () => {
      const win = window();
      const [alice] = await placeInWindow(win, [1], { email: "alice.exact@example.test" });
      await placeInWindow(win, [2], { email: "alice.exact@example.test.evil" });
      await placeInWindow(win, [3], { email: "xalice.exact@example.test" });
      await placeInWindow(win, [4], { email: "alice_exact@example.test" });
      await placeInWindow(win, [5], { email: "alice.exact2@example.test" });
      const emails = async (q: string) =>
        (await world.list(`?${win.query}&q=${encodeURIComponent(q)}`)).body.items.map(
          (item) => item.email,
        );
      expect(await emails("alice.exact@example.test")).toEqual(["alice.exact@example.test"]);
      expect(await emails("  ALICE.Exact@Example.TEST ")).toEqual(["alice.exact@example.test"]);
      for (const q of [
        "alice",
        "alice.exact",
        "alice.exact@",
        "@example.test",
        "example.test",
        "lice.exact@example.test",
        "alice.exact@example.tes",
        "alice%",
        "%alice.exact@example.test",
        "%",
        "%@%",
        "_",
        "alice_exact@example.test%",
        "alice.exac_@example.test",
        "a%t",
        "alice.exact@example.test\\",
        "' OR '1'='1",
        "alice.exact@example.test' --",
        "1; drop table sales_order",
      ]) {
        expect(await emails(q), q).not.toEqual(expect.arrayContaining(["alice.exact@example.test"]));
        expect((await world.list(`?${win.query}&q=${encodeURIComponent(q)}`)).status, q).toBe(200);
      }
      expect(await emails("alice_exact@example.test")).toEqual(["alice_exact@example.test"]);
      expect((await world.list(`?${win.query}&q=${encodeURIComponent("%")}`)).body.total).toBe(0);
      expect(alice).toBeDefined();
    });

    it("an empty or blank q is no filter; q combines with status and the window by AND", async () => {
      const win = window();
      const [one, two] = await placeInWindow(win, [1, 2], { email: "shared.buyer@example.test" });
      expect((await world.pay(two as PlacedForAdmin)).status).toBe(200);
      expect((await world.list(`?${win.query}&q=`)).body.total).toBe(2);
      expect((await world.list(`?${win.query}&q=%20%20`)).body.total).toBe(2);
      const both = await world.list(`?${win.query}&q=shared.buyer%40example.test`);
      expect(both.body.items.map((item) => item.id)).toEqual([two?.id, one?.id]);
      const paidOnly = await world.list(
        `?${win.query}&q=shared.buyer%40example.test&status=paid`,
      );
      expect(paidOnly.body.items.map((item) => item.id)).toEqual([two?.id]);
      const none = await world.list(
        `?${win.query}&q=${encodeURIComponent(one?.number ?? "")}&status=paid`,
      );
      expect(none.body.items).toEqual([]);
    });
  });

  describe("cost", () => {
    it("issues the same number of statements for a page of 1 order and of 50", async () => {
      const small = window();
      await placeInWindow(small, [1]);
      const large = window();
      const lineSource = await world.catalog.simple({ price: 1_000 });
      for (let index = 0; index < 50; index += 1) {
        const { orderId } = await insertSoldLine(world.pool, lineSource);
        bulk.push(orderId);
        await setPlacedAt(world, orderId, large.at(index));
      }
      // Warm the connection pool and the prepared statements so the counts compare like with like.
      await world.list(`?${small.query}`);
      let one = 0;
      let fifty = 0;
      one = await countStatements(() => world.list(`?${small.query}&limit=50`));
      const response = await world.list(`?${large.query}&limit=50`);
      expect(response.body.items).toHaveLength(50);
      fifty = await countStatements(() => world.list(`?${large.query}&limit=50`));
      expect(one).toBeGreaterThan(0);
      expect(fifty).toBe(one);
    });
  });
});
