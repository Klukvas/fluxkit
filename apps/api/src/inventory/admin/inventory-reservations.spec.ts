import { permissionsOf, type AdminPermission } from "@fluxkit/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Page } from "../../common/pagination.js";
import type { ProblemBody } from "../../common/problem.filter.js";
import { PG_POOL } from "../../database/database.module.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { testPrincipal } from "../../test/allow-all-admin-authenticator.js";
import { AdminOrdersWorld } from "../../test/admin-orders-world.js";
import { defaultLocationId } from "../../test/inventory-fixtures.js";
import { http } from "../../test/http.js";
import type { ReservationListItem } from "./inventory.schemas.js";
import { defined } from "../../test/defined.js";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("GET /admin/products/:id/variants/:variantId/inventory/reservations (real app, real Postgres)", () => {
  let world: AdminOrdersWorld;
  let onlyOrdersRead: RunningApp;
  let onlyCatalogRead: RunningApp;
  let mainId: string;

  const path = (productId: string, variantId: string, query = "") =>
    `/admin/products/${productId}/variants/${variantId}/inventory/reservations${query}`;

  const list = (
    line: { productId: string; variantId: string },
    query = "",
    running: RunningApp = world.owner,
  ) =>
    http<Page<ReservationListItem>>(
      running.baseUrl,
      "GET",
      path(line.productId, line.variantId, query),
    );

  /** A reservation no order holds (a hold made by some other caller), written straight into the table. */
  async function insertReservation(
    variantId: string,
    status: string,
    quantity: number,
    reference: string | null = null,
    minutesFromNow = 60,
  ): Promise<string> {
    const result = await world.pool.query(
      `insert into reservation (variant_id, location_id, quantity, status, expires_at, reference)
       values ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval, $6) returning id`,
      [variantId, mainId, quantity, status, String(minutesFromNow), reference],
    );
    return (result.rows[0] as { id: string }).id;
  }

  beforeAll(async () => {
    world = await AdminOrdersWorld.start();
    mainId = await defaultLocationId(world.pool);
    onlyOrdersRead = await startApp({
      adminAuthenticator: {
        authenticate: () => ({ ...testPrincipal("viewer"), permissions: ["orders.read"] }),
      },
    });
    onlyCatalogRead = await startApp({
      adminAuthenticator: {
        authenticate: () => ({
          ...testPrincipal("manager"),
          permissions: permissionsOf("manager").filter(
            (permission: AdminPermission) => permission !== "orders.read",
          ),
        }),
      },
    });
  });

  afterAll(async () => {
    await onlyOrdersRead.app.close();
    await onlyCatalogRead.app.close();
    await world.stop();
  });

  describe("the items", () => {
    it("shows an order's active reservation with its order, number, quantity, expiry and location", async () => {
      const order = await world.place([{ quantity: 2 }]);
      const [line] = order.lines;
      const result = await list(defined(line));
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ total: 1, limit: 50, offset: 0 });
      const [item] = result.body.items;
      expect(item).toEqual({
        status: "active",
        quantity: 2,
        expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        reference: order.number,
        orderId: order.id,
        locationCode: "main",
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      });
      expect(Object.keys(item ?? {}).sort()).toEqual([
        "createdAt",
        "expiresAt",
        "locationCode",
        "orderId",
        "quantity",
        "reference",
        "status",
      ]);
    });

    it("shows a reservation no order holds with orderId null", async () => {
      const order = await world.place([{ quantity: 1 }]);
      const [line] = order.lines;
      await insertReservation(defined(line).variantId, "active", 3, "manual hold");
      const items = (await list(defined(line))).body.items;
      expect(items).toHaveLength(2);
      const loose = items.find((item) => item.reference === "manual hold");
      expect(loose).toMatchObject({ orderId: null, quantity: 3, status: "active" });
      expect(items.find((item) => item.orderId === order.id)).toBeDefined();
    });

    it("carries no personal data: nothing of the buyer, no ids but the order's, no token", async () => {
      const order = await world.place([{ quantity: 1 }]);
      const text = JSON.stringify((await list(defined(order.lines[0]))).body);
      for (const secret of [order.email, "+380501234567", "Іван", "Петренко", order.accessToken]) {
        expect(text).not.toContain(secret);
      }
      expect(text).not.toMatch(/email|phone|firstName|lastName|address|token|customerId/i);
    });

    it("lists newest first, then by id", async () => {
      const order = await world.place([{ quantity: 1 }]);
      const variantId = defined(order.lines[0]).variantId;
      await insertReservation(variantId, "active", 1, "later-1");
      await insertReservation(variantId, "active", 1, "later-2");
      const references = (await list(defined(order.lines[0]))).body.items.map(
        (item) => item.reference,
      );
      expect(references).toEqual(["later-2", "later-1", order.number]);
    });
  });

  describe("the status filter", () => {
    it("shows active reservations by default and moves an order's hold to released when it is cancelled", async () => {
      const order = await world.place([{ quantity: 2 }]);
      const line = defined(order.lines[0]);
      expect((await list(line, "?status=active")).body.total).toBe(1);
      const cancelled = await world.cancel(order.id);
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      expect((await list(line)).body).toMatchObject({ items: [], total: 0 });
      const released = await list(line, "?status=released");
      expect(released.body.items).toEqual([
        expect.objectContaining({ status: "released", quantity: 2, orderId: order.id }),
      ]);
    });

    it("shows committed reservations after the order is paid and fulfilled", async () => {
      const order = await world.place([{ quantity: 1 }]);
      expect((await world.pay(order)).status).toBe(200);
      const fulfilled = await world.fulfil(order.id);
      expect(fulfilled.status, JSON.stringify(fulfilled.body)).toBe(200);
      const committed = await list(defined(order.lines[0]), "?status=committed");
      expect(committed.body.items).toEqual([
        expect.objectContaining({ status: "committed", orderId: order.id }),
      ]);
      expect((await list(defined(order.lines[0]))).body.total).toBe(0);
    });

    it("shows expired reservations only when asked", async () => {
      const order = await world.place([{ quantity: 1 }]);
      const variantId = defined(order.lines[0]).variantId;
      await insertReservation(variantId, "expired", 4, "gone");
      expect((await list(defined(order.lines[0]), "?status=expired")).body.items).toEqual([
        expect.objectContaining({ status: "expired", reference: "gone", quantity: 4 }),
      ]);
      expect(
        (await list(defined(order.lines[0]))).body.items.map((item) => item.reference),
      ).toEqual([order.number]);
    });

    it.each(["bogus", "ACTIVE", "", "all"])("rejects status=%s with 400", async (status) => {
      const order = await world.place([{ quantity: 1 }]);
      const result = await http<ProblemBody>(
        world.owner.baseUrl,
        "GET",
        path(
          defined(order.lines[0]).productId,
          defined(order.lines[0]).variantId,
          `?status=${status}`,
        ),
      );
      expect(result.status).toBe(400);
      expect(result.body.errors?.map((entry) => entry.path)).toContain("status");
    });
  });

  describe("paging", () => {
    it("pages like the other admin lists: limit, offset, total", async () => {
      const order = await world.place([{ quantity: 1 }]);
      const variantId = defined(order.lines[0]).variantId;
      for (let index = 1; index <= 5; index += 1) {
        await insertReservation(variantId, "active", 1, `bulk-${index}`);
      }
      const first = await list(defined(order.lines[0]), "?limit=4&offset=0");
      const second = await list(defined(order.lines[0]), "?limit=4&offset=4");
      expect(first.body).toMatchObject({ total: 6, limit: 4, offset: 0 });
      expect(first.body.items).toHaveLength(4);
      expect(second.body.items).toHaveLength(2);
      const all = [...first.body.items, ...second.body.items].map((item) => item.reference);
      expect(new Set(all).size).toBe(6);
    });

    it.each(["limit=0", "limit=101", "limit=x", "offset=-1", "offset=10001"])(
      "rejects ?%s with 400",
      async (query) => {
        const order = await world.place([{ quantity: 1 }]);
        const result = await list(defined(order.lines[0]), `?${query}`);
        expect(result.status).toBe(400);
      },
    );
  });

  describe("unknown ids", () => {
    it("answers 404 for an unknown product, an unknown variant and a variant of another product", async () => {
      const [one, two] = [
        await world.place([{ quantity: 1 }]),
        await world.place([{ quantity: 1 }]),
      ];
      const a = defined(one.lines[0]);
      const b = defined(two.lines[0]);
      for (const target of [
        path(MISSING_ID, a.variantId),
        path(a.productId, MISSING_ID),
        path(a.productId, b.variantId),
      ]) {
        const result = await http<ProblemBody>(world.owner.baseUrl, "GET", target);
        expect(result.status, target).toBe(404);
        expect(result.body).toMatchObject({ code: "not_found" });
      }
    });

    it("answers 400 for a malformed id", async () => {
      const result = await http(
        world.owner.baseUrl,
        "GET",
        `/admin/products/xyz/variants/${MISSING_ID}/inventory/reservations`,
      );
      expect(result.status).toBe(400);
    });
  });

  describe("permission: orders.read, NOT catalog.read (reservations link orders)", () => {
    it("forbids the viewer (catalog.read only) and allows the manager and the owner", async () => {
      const order = await world.place([{ quantity: 1 }]);
      const line = defined(order.lines[0]);
      const viewer = await list(line, "", world.viewer);
      expect(viewer.status).toBe(403);
      expect(viewer.body).toMatchObject({ code: "forbidden" });
      expect((await list(line, "", world.manager)).status).toBe(200);
      expect((await list(line, "", world.owner)).status).toBe(200);
      expect((await list(line, "", world.anonymous)).status).toBe(401);
    });

    it("maps the roles as the permission matrix says (the viewer has no orders.read, manager and owner do)", () => {
      expect(permissionsOf("viewer")).not.toContain("orders.read");
      expect(permissionsOf("viewer")).toContain("catalog.read");
      expect(permissionsOf("manager")).toContain("orders.read");
      expect(permissionsOf("owner")).toContain("orders.read");
    });

    it("needs orders.read and nothing else: a principal with only orders.read passes, one with catalog.read but no orders.read does not", async () => {
      const order = await world.place([{ quantity: 1 }]);
      const line = defined(order.lines[0]);
      expect((await list(line, "", onlyOrdersRead)).status).toBe(200);
      const denied = await list(line, "", onlyCatalogRead);
      expect(denied.status).toBe(403);
      expect(denied.body).toMatchObject({ code: "forbidden" });
    });

    it("leaves the other inventory reads on catalog.read (the viewer still reads levels and movements)", async () => {
      const order = await world.place([{ quantity: 1 }]);
      const line = defined(order.lines[0]);
      const base = `/admin/products/${line.productId}/variants/${line.variantId}/inventory`;
      expect((await http(world.viewer.baseUrl, "GET", base)).status).toBe(200);
      expect((await http(world.viewer.baseUrl, "GET", `${base}/movements`)).status).toBe(200);
    });
  });

  describe("statement count", () => {
    it("issues the same number of statements for 1 and for 60 reservations", async () => {
      const few = await world.place([{ quantity: 1 }]);
      const many = await world.place([{ quantity: 1 }]);
      for (let index = 0; index < 59; index += 1) {
        await insertReservation(defined(many.lines[0]).variantId, "active", 1, `n-${index}`);
      }

      async function statements(line: { productId: string; variantId: string }): Promise<number> {
        const poolOfApp = world.owner.app.get<pg.Pool>(PG_POOL, { strict: false });
        const spy = vi.spyOn(poolOfApp, "query");
        try {
          expect((await list(line, "?limit=100")).status).toBe(200);
          return spy.mock.calls.length;
        } finally {
          spy.mockRestore();
        }
      }
      const small = await statements(defined(few.lines[0]));
      expect(await statements(defined(many.lines[0]))).toBe(small);
      expect(small).toBe(4);
      expect((await list(defined(many.lines[0]), "?limit=100")).body.total).toBe(60);
    });
  });
});
