import { createHash, randomUUID } from "node:crypto";
import { ORDER_READ_PORT, type OrderReadPort } from "@fluxkit/core";
import { Logger } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AdminOrdersWorld, countStatements } from "../../test/admin-orders-world.js";
import { deepKeys } from "../../test/cart-helpers.js";
import { CUSTOMER_SESSION_COOKIE_NAME } from "../../customers/auth/customer-session-cookie.js";
import { createTestCustomer, deleteTestCustomers } from "../../test/customer-fixtures.js";
import { customerLoginCookie } from "../../test/customer-http.js";
import { changesOf, checkoutAs, checkoutBody, orderRow } from "../../test/order-http.js";
import { Shopper } from "../../test/shopper.js";
import { AdminOrderViewService } from "./admin-order-view.js";

const PASSWORD = "correct horse battery staple";
const sha256Hex = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Keys that must never appear anywhere in an admin response or in the port's view, at any depth. */
const FORBIDDEN_KEYS = [
  "accessToken",
  "accessTokenHash",
  "access_token_hash",
  "accessExpiresAt",
  "idempotencyKey",
  "idempotency_key",
  "requestFingerprint",
  "request_fingerprint",
  "passwordHash",
  "password_hash",
  "failedLoginCount",
  "lockedUntil",
  "onHand",
  "on_hand",
  "reserved",
  "available",
  "locationId",
  "location_id",
  "reservationId",
  "reservation_id",
  "stock",
  "isInternal",
];

describe("GET /admin/orders/:id and the OrderReadPort (real Postgres)", () => {
  let world: AdminOrdersWorld;
  let port: OrderReadPort;
  const customers: string[] = [];

  beforeAll(async () => {
    world = await AdminOrdersWorld.start();
    port = world.owner.app.get<OrderReadPort>(ORDER_READ_PORT);
  });

  afterAll(async () => {
    await deleteTestCustomers(world.db, customers);
    await world.stop();
  });

  /** A guest order of two lines: a red variant with an image, a compare-at price and every locale, and a plain one. */
  async function placeRich(): Promise<{
    id: string;
    number: string;
    key: string;
    accessToken: string;
    variants: string[];
  }> {
    const product = await world.catalog.product({
      withColors: true,
      title: { uk: "Футболка", en: "T-shirt" },
    });
    await world.catalog.media(product.id, "https://img.test/tee-red.jpg", 0, { color: "red" });
    const red = await world.catalog.variant(product.id, {
      color: "red",
      price: 700,
      compareAt: 900,
      trackInventory: true,
      onHand: 20,
      title: { uk: "Червона", en: "Red one" },
    });
    const plain = await world.catalog.simple({
      price: 250,
      trackInventory: true,
      onHand: 20,
      productTitle: { uk: "Кепка" },
    });
    const shopper = new Shopper(world.owner.baseUrl);
    await shopper.post("/store/cart/items", { variantId: red, quantity: 3 });
    await shopper.post("/store/cart/items", { variantId: plain.variantId, quantity: 2 });
    const key = randomUUID();
    const result = await checkoutAs(
      shopper,
      checkoutBody(3 * 700 + 2 * 250, {
        email: "Rich.Buyer@Example.test",
        phone: "+38 (050) 123-45-67",
        billingAddress: { countryCode: "UA", city: "Львів", line1: "вул. Шевченка 2" },
        locale: "en",
      }),
      key,
    );
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    const number = world.placed.track(result.body.order?.number ?? "");
    return {
      id: (await orderRow(world.pool, number)).id,
      number,
      key,
      accessToken: result.body.accessToken ?? "",
      variants: [red, plain.variantId],
    };
  }

  describe("completeness", () => {
    it("shows contact, both addresses, the item snapshot with every locale, totals, the journal and each line's reservations", async () => {
      const order = await placeRich();
      const result = await world.detail(order.id);
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.headers.get("cache-control")).toBe("no-store");
      const view = result.body;

      expect(Object.keys(view).sort()).toEqual(
        [
          "adjustments",
          "billingAddress",
          "cancelledAt",
          "cancellationReason",
          "contact",
          "contactErasedAt",
          "currency",
          "customerId",
          "discountTotal",
          "expiredAt",
          "expiresAt",
          "fulfilledAt",
          "history",
          "id",
          "isGuest",
          "items",
          "locale",
          "number",
          "paidAt",
          "paymentReference",
          "payments",
          "placedAt",
          "shipments",
          "shipping",
          "shippingAddress",
          "shippingTotal",
          "status",
          "subtotal",
          "taxTotal",
          "total",
        ].sort(),
      );
      expect(view).toMatchObject({
        id: order.id,
        number: order.number,
        status: "awaiting_payment",
        locale: "en",
        currency: "UAH",
        customerId: null,
        isGuest: true,
        contactErasedAt: null,
        contact: {
          email: "rich.buyer@example.test",
          phone: "+380501234567",
          firstName: "Іван",
          lastName: "Петренко",
        },
        shippingAddress: {
          countryCode: "UA",
          city: "Київ",
          line1: "вул. Хрещатик 1",
          postalCode: "01001",
        },
        billingAddress: { countryCode: "UA", city: "Львів", line1: "вул. Шевченка 2" },
        subtotal: { amount: 2600, currency: "UAH" },
        shippingTotal: { amount: 0, currency: "UAH" },
        discountTotal: { amount: 0, currency: "UAH" },
        taxTotal: { amount: 0, currency: "UAH" },
        total: { amount: 2600, currency: "UAH" },
        adjustments: [],
        paidAt: null,
        fulfilledAt: null,
        cancelledAt: null,
        expiredAt: null,
        cancellationReason: null,
        paymentReference: null,
      });

      expect(view.items).toHaveLength(2);
      const [red, cap] = view.items;
      expect(Object.keys(red ?? {}).sort()).toEqual(
        [
          "compareAtAmount",
          "imageUrl",
          "lineTotal",
          "optionValues",
          "position",
          "productId",
          "productTitle",
          "quantity",
          "requiresShipping",
          "reservations",
          "sku",
          "unitPrice",
          "variantId",
          "variantTitle",
        ].sort(),
      );
      expect(red).toMatchObject({
        position: 0,
        variantId: order.variants[0],
        productTitle: { uk: "Футболка", en: "T-shirt" },
        variantTitle: { uk: "Червона", en: "Red one" },
        optionValues: [
          { option: { uk: "Колір", en: "Color" }, value: { uk: "Червоний", en: "Red" } },
        ],
        imageUrl: "https://img.test/tee-red.jpg",
        unitPrice: { amount: 700, currency: "UAH" },
        compareAtAmount: 900,
        quantity: 3,
        lineTotal: { amount: 2100, currency: "UAH" },
        requiresShipping: true,
        reservations: [{ status: "active", quantity: 3 }],
      });
      expect(cap).toMatchObject({
        position: 1,
        variantId: order.variants[1],
        productTitle: { uk: "Кепка" },
        variantTitle: null,
        optionValues: [],
        imageUrl: null,
        compareAtAmount: null,
        quantity: 2,
        reservations: [{ status: "active", quantity: 2 }],
      });

      expect(view.history).toHaveLength(1);
      expect(view.history[0]).toMatchObject({
        fromStatus: null,
        toStatus: "awaiting_payment",
        actorType: "guest",
        actorAdminId: null,
        reason: null,
      });
      expect(Date.parse(view.placedAt)).toBeLessThan(Date.parse(view.expiresAt));
    });

    it("follows the order through payment, fulfilment and a paid cancel: journal actors, reasons, timestamps and reservation statuses", async () => {
      const paid = await world.place([{ quantity: 2 }, { quantity: 1 }]);
      expect((await world.pay(paid, "BANK-77", world.manager)).status).toBe(200);
      const afterPay = (await world.detail(paid.id)).body;
      expect(afterPay).toMatchObject({ status: "paid", paymentReference: "BANK-77" });
      expect(afterPay.paidAt).not.toBeNull();
      expect(afterPay.items.map((item) => item.reservations)).toEqual([
        [{ status: "committed", quantity: 2 }],
        [{ status: "committed", quantity: 1 }],
      ]);
      expect((await world.fulfil(paid.id, world.owner)).status).toBe(200);
      const done = (await world.detail(paid.id)).body;
      expect(done.status).toBe("fulfilled");
      expect(done.fulfilledAt).not.toBeNull();
      expect(
        done.history.map((entry) => [
          entry.fromStatus,
          entry.toStatus,
          entry.actorType,
          entry.actorAdminId,
        ]),
      ).toEqual([
        [null, "awaiting_payment", "guest", null],
        ["awaiting_payment", "paid", "admin", world.managerId],
        ["paid", "fulfilled", "admin", world.ownerId],
      ]);

      const cancelled = await world.place([{ quantity: 1 }]);
      expect((await world.cancel(cancelled.id, "  Wrong address  ", world.manager)).status).toBe(
        200,
      );
      const view = (await world.detail(cancelled.id)).body;
      expect(view).toMatchObject({ status: "cancelled", cancellationReason: "Wrong address" });
      expect(view.items[0]?.reservations).toEqual([{ status: "released", quantity: 1 }]);
      expect(view.history.at(-1)).toMatchObject({
        fromStatus: "awaiting_payment",
        toStatus: "cancelled",
        actorType: "admin",
        actorAdminId: world.managerId,
        reason: "Wrong address",
      });
    });
  });

  describe("guest or customer", () => {
    it("a customer's order carries the customer id and is not a guest order; deleting the account keeps it a non-guest order", async () => {
      const account = await createTestCustomer(world.db, { password: PASSWORD });
      customers.push(account.id);
      const cookie = await customerLoginCookie(world.anonymous.baseUrl, account.email, PASSWORD);
      const shopper = new Shopper(world.owner.baseUrl);
      shopper.setCookie(CUSTOMER_SESSION_COOKIE_NAME, cookie.slice(cookie.indexOf("=") + 1));
      const order = await world.place([{ quantity: 1 }], {}, shopper);
      const asCustomer = (await world.detail(order.id)).body;
      expect(asCustomer).toMatchObject({ customerId: account.id, isGuest: false });
      expect(
        (await world.list(`?q=${encodeURIComponent(order.number)}`)).body.items[0],
      ).toMatchObject({ customerId: account.id });

      await deleteTestCustomers(world.db, [account.id]);
      customers.splice(customers.indexOf(account.id), 1);
      const afterDelete = (await world.detail(order.id)).body;
      expect(afterDelete).toMatchObject({ customerId: null, isGuest: false });
      expect(afterDelete.contact).toEqual(asCustomer.contact);

      const guest = await world.place([{ quantity: 1 }]);
      expect((await world.detail(guest.id)).body).toMatchObject({
        customerId: null,
        isGuest: true,
      });
    });
  });

  describe("secrecy", () => {
    it("no token, hash, idempotency key, fingerprint, reservation id, location or stock figure appears in any key or value, in the detail, the list or the port", async () => {
      const order = await placeRich();
      expect((await world.pay({ id: order.id, total: 2600 }, "REF-S")).status).toBe(200);
      const row = await orderRow(world.pool, order.number);
      const reservationRows = await world.pool.query<{ id: string; location_id: string }>(
        `select r.id, r.location_id from order_item_reservation l
           join order_item i on i.id = l.order_item_id
           join reservation r on r.id = l.reservation_id where i.order_id = $1`,
        [order.id],
      );
      expect(reservationRows.rows).toHaveLength(2);
      const secrets = [
        order.accessToken,
        row.access_token_hash ?? "",
        sha256Hex(order.accessToken),
        order.key,
        row.request_fingerprint,
        ...reservationRows.rows.flatMap((entry) => [entry.id, entry.location_id]),
      ];
      expect(secrets.every((secret) => secret.length >= 32)).toBe(true);

      const responses: unknown[] = [
        (await world.detail(order.id)).body,
        (await world.list(`?q=${encodeURIComponent(order.number)}`)).body,
        (await world.pay({ id: order.id, total: 2600 }, "REF-S")).body,
        await port.getOrder(order.id),
      ];
      for (const response of responses) {
        const wire = JSON.stringify(response);
        const keys = deepKeys(response);
        for (const key of FORBIDDEN_KEYS) {
          expect(keys.has(key), `key ${key}`).toBe(false);
        }
        for (const secret of secrets) {
          expect(wire, `value ${secret.slice(0, 8)}...`).not.toContain(secret);
        }
      }
      const detail = (await world.detail(order.id)).body;
      for (const item of detail.items) {
        for (const reservation of item.reservations) {
          expect(Object.keys(reservation).sort()).toEqual(["quantity", "status"]);
        }
      }
    });
  });

  describe("the OrderReadPort", () => {
    it("is registered under the core token and is the same service the admin routes use", () => {
      expect(ORDER_READ_PORT).toBe("fluxkit:order-read-port");
      expect(port).toBe(world.owner.app.get(AdminOrderViewService));
    });

    it("returns exactly the admin detail view, in every status, and the action responses are that same view", async () => {
      const awaiting = await placeRich();
      const paid = await world.place([{ quantity: 2 }]);
      const paidResponse = await world.pay(paid, "REF-P");
      const fulfilled = await world.place([{ quantity: 1 }]);
      await world.pay(fulfilled, "REF-F");
      const fulfilResponse = await world.fulfil(fulfilled.id);
      const cancelled = await world.place([{ quantity: 1 }]);
      const cancelResponse = await world.cancel(cancelled.id, "Port check");

      for (const id of [awaiting.id, paid.id, fulfilled.id, cancelled.id]) {
        const http = (await world.detail(id)).body;
        const viaPort = await port.getOrder(id);
        expect(viaPort).toEqual(http);
        // JSON round trip: the same bytes a plugin would see, not only the same structure.
        expect(JSON.stringify(viaPort)).toBe(JSON.stringify(http));
      }
      expect(paidResponse.body).toEqual(await port.getOrder(paid.id));
      expect(fulfilResponse.body).toEqual(await port.getOrder(fulfilled.id));
      expect(cancelResponse.body).toEqual(await port.getOrder(cancelled.id));
    });

    it("answers undefined for an unknown order and for text that is not an id, and never throws for them", async () => {
      expect(await port.getOrder("6f1c1d2e-8b43-4f4e-9c55-0a1b2c3d4e5f")).toBeUndefined();
      for (const text of ["", "not-a-uuid", "7K3M-9QX2", "' or 1=1 --", "x".repeat(5000)]) {
        expect(await port.getOrder(text), text.slice(0, 20)).toBeUndefined();
      }
    });
  });

  describe("cost and logs", () => {
    it("issues the same number of statements for an order of 1 line and of 20", async () => {
      const one = await world.place([{ quantity: 1 }]);
      const twenty = await world.place(Array.from({ length: 20 }, () => ({ quantity: 1 })));
      await world.detail(one.id);
      const small = await countStatements(() => world.detail(one.id));
      const large = await countStatements(() => world.detail(twenty.id));
      expect((await world.detail(twenty.id)).body.items).toHaveLength(20);
      expect(small).toBeGreaterThan(0);
      expect(large).toBe(small);
      const viaPort = await countStatements(() => port.getOrder(twenty.id));
      expect(viaPort).toBe(small);
    });

    it("logs carry no email, phone, address, name, token, key, reason or payment reference through every route", async () => {
      const lines: string[] = [];
      const capture = (chunk: unknown): boolean => {
        lines.push(String(chunk));
        return true;
      };
      const stdout = vi.spyOn(process.stdout, "write").mockImplementation(capture);
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(capture);
      const logged = ["error", "warn", "log", "debug", "verbose"] as const;
      const spies = logged.map((level) =>
        vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
          lines.push(JSON.stringify(message));
        }),
      );
      const secretEmail = "secret.person@example.test";
      const rich = await placeRich();
      const secretToken = rich.accessToken;
      const secretKey = rich.key;
      try {
        const secretOrder = await world.place([{ quantity: 1 }], {
          email: secretEmail,
          phone: "+380509998877",
          firstName: "Секретний",
          lastName: "Покупець",
          shippingAddress: { countryCode: "UA", city: "Секретне місто", line1: "Таємна вулиця 7" },
        });
        await world.list(`?q=${encodeURIComponent(secretEmail)}`);
        await world.detail(secretOrder.id);
        await world.markPaid(secretOrder.id, {
          reference: "SECRET-REFERENCE-9",
          amount: { amount: 1, currency: "UAH" },
        });
        await world.pay(secretOrder, "SECRET-REFERENCE-9");
        await world.cancel(secretOrder.id, "Секретна причина скасування");
        await world.fulfil(secretOrder.id);
        // And failures: unknown order, invalid body.
        await world.cancel("6f1c1d2e-8b43-4f4e-9c55-0a1b2c3d4e5f", "Секретна причина скасування");
        await world.markPaid(secretOrder.id, { reference: "SECRET-REFERENCE-9", amount: "oops" });
        await world.list("?status=SECRET-STATUS");
      } finally {
        stdout.mockRestore();
        stderr.mockRestore();
        for (const spy of spies) spy.mockRestore();
      }
      const output = lines.join("");
      for (const secret of [
        secretEmail,
        "380509998877",
        "Секретний",
        "Покупець",
        "Секретне місто",
        "Таємна вулиця",
        "SECRET-REFERENCE-9",
        "Секретна причина",
        "SECRET-STATUS",
        secretToken,
        secretKey,
      ]) {
        expect(secret.length).toBeGreaterThan(5);
        expect(output, secret).not.toContain(secret);
      }
    });
  });

  it("every route sends Cache-Control: no-store, errors included", async () => {
    const order = await world.place([{ quantity: 1 }]);
    const results = [
      await world.list(),
      await world.detail(order.id),
      await world.detail("6f1c1d2e-8b43-4f4e-9c55-0a1b2c3d4e5f"),
      await world.detail("bad"),
      await world.cancel(order.id, ""),
      await world.cancel(order.id, "ok"),
      await world.cancel(order.id, "again"),
      await world.fulfil(order.id),
    ];
    for (const result of results) {
      expect(result.headers.get("cache-control")).toBe("no-store");
    }
    expect(results.map((result) => result.status)).toEqual([
      200, 200, 404, 400, 400, 200, 409, 409,
    ]);
    expect(await changesOf(world.pool, order.id)).toHaveLength(2);
  });
});
