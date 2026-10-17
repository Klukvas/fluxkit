import { permissionsOf, type AdminRole } from "@fluxkit/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import type { RunningApp } from "../../test/app.js";
import { AdminOrdersWorld } from "../../test/admin-orders-world.js";
import { createTestCustomer, deleteTestCustomers } from "../../test/customer-fixtures.js";
import { customerLoginCookie } from "../../test/customer-http.js";
import { http, type HttpResult } from "../../test/http.js";
import { SOME_ID } from "../../test/routes.js";

const PASSWORD = "correct horse battery staple";

describe("admin orders: access and input validation (real Postgres)", () => {
  let world: AdminOrdersWorld;
  const customers: string[] = [];

  beforeAll(async () => {
    world = await AdminOrdersWorld.start();
  });

  afterAll(async () => {
    await deleteTestCustomers(world.db, customers);
    await world.stop();
  });

  describe("permission matrix on all five routes", () => {
    interface Case {
      name: string;
      permission: "orders.read" | "orders.write";
      call: (baseUrl: string, id: string, csrf?: boolean) => Promise<HttpResult<unknown>>;
      pay?: boolean;
    }
    const cases: Case[] = [
      {
        name: "GET /admin/orders",
        permission: "orders.read",
        call: (url, _id, csrf) => http(url, "GET", "/admin/orders", { csrf }),
      },
      {
        name: "GET /admin/orders/:id",
        permission: "orders.read",
        call: (url, id, csrf) => http(url, "GET", `/admin/orders/${id}`, { csrf }),
      },
      {
        name: "POST /admin/orders/:id/cancel",
        permission: "orders.write",
        call: (url, id, csrf) =>
          http(url, "POST", `/admin/orders/${id}/cancel`, { body: { reason: "test" }, csrf }),
      },
      {
        name: "POST /admin/orders/:id/mark-paid",
        permission: "orders.write",
        call: (url, id, csrf) =>
          http(url, "POST", `/admin/orders/${id}/mark-paid`, {
            body: { reference: "REF-1", amount: { amount: 1000, currency: "UAH" } },
            csrf,
          }),
      },
      {
        name: "POST /admin/orders/:id/mark-fulfilled",
        permission: "orders.write",
        call: (url, id, csrf) => http(url, "POST", `/admin/orders/${id}/mark-fulfilled`, { csrf }),
      },
    ];

    it.each(cases)(
      "$name: 401 anonymous, 403 without the CSRF header, 403 viewer (who changes nothing), 200 manager and owner",
      async (route) => {
        // The one order every role acts on: mark-fulfilled needs it paid, the others work on a fresh one each.
        const fresh = async () => {
          const order = await world.place([{ quantity: 1 }]);
          if (route.name.endsWith("mark-fulfilled")) {
            expect((await world.pay(order)).status).toBe(200);
          }
          return order;
        };
        const target = await fresh();

        const asAnonymous = await route.call(world.anonymous.baseUrl, target.id);
        expect(asAnonymous.status, "anonymous").toBe(401);
        expect(asAnonymous.headers.get("cache-control")).toBe("no-store");

        if (!route.name.startsWith("GET")) {
          expect((await route.call(world.owner.baseUrl, target.id, false)).status, "no CSRF").toBe(
            403,
          );
          expect(
            (await route.call(world.anonymous.baseUrl, target.id, false)).status,
            "anonymous without CSRF",
          ).toBe(403);
        }

        const statusBefore = (await world.pool.query("select status from sales_order where id = $1", [target.id]))
          .rows[0] as { status: string };
        const asViewer = await route.call(world.viewer.baseUrl, target.id);
        expect(asViewer.status, "viewer").toBe(403);
        expect(asViewer.body).toMatchObject({ code: "forbidden" });
        expect((asViewer.body as ProblemBody).detail).toContain(route.permission);
        expect(permissionsOf("viewer")).not.toContain(route.permission);
        const statusAfter = (await world.pool.query("select status from sales_order where id = $1", [target.id]))
          .rows[0] as { status: string };
        expect(statusAfter, "a forbidden call must not change the order").toEqual(statusBefore);

        for (const [role, running] of [
          ["manager", world.manager],
          ["owner", world.owner],
        ] as [AdminRole, RunningApp][]) {
          expect(permissionsOf(role)).toContain(route.permission);
          // Each role gets its own order for the writes (a second cancel or payment of one order is a 409).
          const own = role === "owner" ? target : await fresh();
          const result = await route.call(running.baseUrl, own.id);
          expect(result.status, `${role}: ${JSON.stringify(result.body)}`).toBe(200);
          expect(result.headers.get("cache-control")).toBe("no-store");
        }
      },
    );

    it("a customer session cookie and a guest order token are not admin credentials", async () => {
      const account = await createTestCustomer(world.db, { password: PASSWORD });
      customers.push(account.id);
      const cookie = await customerLoginCookie(world.anonymous.baseUrl, account.email, PASSWORD);
      const order = await world.place([{ quantity: 1 }]);
      for (const headers of [
        { cookie },
        { authorization: `Bearer ${order.accessToken}` },
        { "x-access-token": order.accessToken },
        { cookie: `fluxkit_admin_session=${order.accessToken}` },
      ]) {
        for (const [method, path, body] of [
          ["GET", "/admin/orders", undefined],
          ["GET", `/admin/orders/${order.id}`, undefined],
          ["POST", `/admin/orders/${order.id}/cancel`, { reason: "x" }],
          [
            "POST",
            `/admin/orders/${order.id}/mark-paid`,
            { reference: "R", amount: { amount: order.total, currency: "UAH" } },
          ],
          ["POST", `/admin/orders/${order.id}/mark-fulfilled`, undefined],
        ] as const) {
          const result = await http<ProblemBody>(world.anonymous.baseUrl, method, path, {
            body,
            headers,
          });
          expect(result.status, `${method} ${path} with ${Object.keys(headers).join(",")}`).toBe(
            401,
          );
        }
      }
      const row = await world.pool.query("select status from sales_order where id = $1", [order.id]);
      expect(row.rows[0]).toEqual({ status: "awaiting_payment" });
    });

    it("an unknown order is 404 and a malformed id is 400, for every route and for the roles that may ask", async () => {
      for (const running of [world.manager, world.owner]) {
        expect((await http(running.baseUrl, "GET", `/admin/orders/${SOME_ID}`)).status).toBe(404);
        expect(
          (
            await http(running.baseUrl, "POST", `/admin/orders/${SOME_ID}/cancel`, {
              body: { reason: "x" },
            })
          ).status,
        ).toBe(404);
        expect(
          (
            await http(running.baseUrl, "POST", `/admin/orders/${SOME_ID}/mark-paid`, {
              body: { reference: "R", amount: { amount: 1, currency: "UAH" } },
            })
          ).status,
        ).toBe(404);
        expect(
          (await http(running.baseUrl, "POST", `/admin/orders/${SOME_ID}/mark-fulfilled`)).status,
        ).toBe(404);
        for (const [method, path, body] of [
          ["GET", "/admin/orders/not-a-uuid", undefined],
          ["GET", "/admin/orders/7K3M-9QX2", undefined],
          ["POST", "/admin/orders/not-a-uuid/cancel", { reason: "x" }],
          [
            "POST",
            "/admin/orders/1/mark-paid",
            { reference: "R", amount: { amount: 1, currency: "UAH" } },
          ],
          ["POST", "/admin/orders/%27%20or%201=1/mark-fulfilled", undefined],
        ] as const) {
          const result = await http<ProblemBody>(running.baseUrl, method, path, { body });
          expect(result.status, `${method} ${path}`).toBe(400);
          expect(result.body).toMatchObject({ code: "validation_failed" });
        }
      }
    });
  });

  describe("GET /admin/orders: query validation", () => {
    it("accepts the documented forms", async () => {
      for (const query of [
        "",
        "?limit=1",
        "?limit=100&offset=10000",
        "?status=paid",
        "?placedFrom=2030-01-01T00:00:00Z",
        "?placedFrom=2030-01-01T00:00:00.123Z&placedTo=2030-02-01T02:00:00%2B02:00",
        "?placedFrom=2030-01-01T00:00:00Z&placedTo=2030-01-01T00:00:00Z",
        "?q=",
        "?q=%20%20",
        "?q=7k3m9qx2",
      ]) {
        const result = await world.list(query);
        expect(result.status, `${query}: ${JSON.stringify(result.body)}`).toBe(200);
      }
    });

    it("rejects with 400 and a per-field error: bad status, bad dates, reversed range, bad paging, unknown parameters", async () => {
      const cases: [string, string][] = [
        ["?status=shipped", "status"],
        ["?status=", "status"],
        ["?status=PAID", "status"],
        ["?status=paid&status=expired", "status"],
        ["?placedFrom=yesterday", "placedFrom"],
        ["?placedFrom=2030-01-01", "placedFrom"],
        ["?placedFrom=2030-01-01T00:00:00", "placedFrom"],
        ["?placedFrom=2030-02-30T00:00:00Z", "placedFrom"],
        ["?placedFrom=2030-13-01T00:00:00Z", "placedFrom"],
        ["?placedFrom=1999-12-31T23:59:59Z", "placedFrom"],
        ["?placedTo=2200-01-01T00:00:00Z", "placedTo"],
        ["?placedTo=0000-01-01T00:00:00Z", "placedTo"],
        ["?placedTo=99999-01-01T00:00:00Z", "placedTo"],
        ["?placedFrom=", "placedFrom"],
        ["?placedFrom=2030-02-01T00:00:00Z&placedTo=2030-01-01T00:00:00Z", "placedTo"],
        ["?limit=0", "limit"],
        ["?limit=101", "limit"],
        ["?limit=1000000000", "limit"],
        ["?limit=-1", "limit"],
        ["?limit=1.5", "limit"],
        ["?limit=1e2", "limit"],
        ["?limit=x", "limit"],
        ["?offset=-1", "offset"],
        ["?offset=10001", "offset"],
        ["?stauts=paid", "stauts"],
        ["?customerId=" + SOME_ID, "customerId"],
        [`?q=${"a".repeat(255)}`, "q"],
        ["?q=a&q=b", "q"],
      ];
      for (const [query, path] of cases) {
        const result = await world.list(query);
        expect(result.status, query).toBe(400);
        expect(result.body, query).toMatchObject({ code: "validation_failed" });
        expect(
          (result.body.errors ?? []).map((error) => error.path),
          query,
        ).toContain(path);
      }
    });

    it("answers the same 400 to every role that may ask, and the viewer never reaches validation", async () => {
      expect((await world.list("?limit=0", world.manager)).status).toBe(400);
      expect((await world.list("?limit=0", world.viewer)).status).toBe(403);
    });
  });

  describe("POST bodies: validation", () => {
    const cancelRaw = (id: string, body: unknown) =>
      http<ProblemBody>(world.owner.baseUrl, "POST", `/admin/orders/${id}/cancel`, { body });
    const payRaw = (id: string, body: unknown) =>
      http<ProblemBody>(world.owner.baseUrl, "POST", `/admin/orders/${id}/mark-paid`, { body });
    const paths = (result: HttpResult<ProblemBody>) =>
      (result.body.errors ?? []).map((error) => `${error.path}:${error.code}`);

    it("cancel needs a reason: missing, empty, blank, too long, wrong type, unknown field, control characters", async () => {
      const order = await world.place([{ quantity: 1 }]);
      const bad: [unknown, string][] = [
        [{}, "reason:required"],
        [{ reason: "" }, "reason:too_small"],
        [{ reason: "   \t\n " }, "reason:too_small"],
        [{ reason: "x".repeat(501) }, "reason:too_big"],
        [{ reason: `${" ".repeat(10)}${"x".repeat(501)}${" ".repeat(10)}` }, "reason:too_big"],
        [{ reason: 5 }, "reason:invalid_type"],
        [{ reason: null }, "reason:invalid_type"],
        [{ reason: ["a"] }, "reason:invalid_type"],
        [{ reason: "ok", extra: 1 }, "extra:unknown_field"],
        [{ reason: "ok\u0000bad" }, "reason:invalid_characters"],
        [{ reason: "ok\u001bbad" }, "reason:invalid_characters"],
        [{ reason: "ok\u0085bad" }, "reason:invalid_characters"],
      ];
      for (const [body, expected] of bad) {
        const result = await cancelRaw(order.id, body);
        expect(result.status, JSON.stringify(body).slice(0, 80)).toBe(400);
        expect(paths(result)).toContain(expected);
      }
      // A body that is not an object at all.
      for (const body of [null, "reason", 5, [], [{ reason: "x" }]]) {
        expect((await cancelRaw(order.id, body)).status, JSON.stringify(body)).toBe(400);
      }
      // Nothing above touched the order.
      const row = await world.pool.query("select status from sales_order where id = $1", [order.id]);
      expect(row.rows[0]).toEqual({ status: "awaiting_payment" });
    });

    it("cancel accepts 1 and exactly 500 characters, trims them, and keeps tabs and line feeds", async () => {
      const [short, long, multiline] = [
        await world.place([{ quantity: 1 }]),
        await world.place([{ quantity: 1 }]),
        await world.place([{ quantity: 1 }]),
      ];
      expect((await cancelRaw(short.id, { reason: "  x  " })).status).toBe(200);
      expect((await cancelRaw(long.id, { reason: `  ${"я".repeat(500)}  ` })).status).toBe(200);
      expect((await cancelRaw(multiline.id, { reason: "line one\n\tline two" })).status).toBe(200);
      const rows = await world.pool.query<{ id: string; cancellation_reason: string }>(
        "select id, cancellation_reason from sales_order where id = any($1::uuid[])",
        [[short.id, long.id, multiline.id]],
      );
      const byId = new Map(rows.rows.map((row) => [row.id, row.cancellation_reason]));
      expect(byId.get(short.id)).toBe("x");
      expect(byId.get(long.id)).toBe("я".repeat(500));
      expect(byId.get(multiline.id)).toBe("line one\n\tline two");
    });

    it("mark-paid validates the reference: missing, empty, blank, too long, wrong type, control characters; edge lengths pass", async () => {
      const order = await world.place([{ quantity: 1 }]);
      const amount = { amount: order.total, currency: "UAH" };
      const bad: [unknown, string][] = [
        [{ amount }, "reference:required"],
        [{ reference: "", amount }, "reference:too_small"],
        [{ reference: " \t ", amount }, "reference:too_small"],
        [{ reference: "x".repeat(256), amount }, "reference:too_big"],
        [{ reference: 12, amount }, "reference:invalid_type"],
        [{ reference: null, amount }, "reference:invalid_type"],
        [{ reference: "a\u0000b", amount }, "reference:invalid_characters"],
        [{ reference: "R", amount, source: "plugin" }, "source:unknown_field"],
        [{ reference: "R", amount, orderId: SOME_ID }, "orderId:unknown_field"],
      ];
      for (const [body, expected] of bad) {
        const result = await payRaw(order.id, body);
        expect(result.status, JSON.stringify(body).slice(0, 80)).toBe(400);
        expect(paths(result)).toContain(expected);
      }
      const row = await world.pool.query("select status from sales_order where id = $1", [order.id]);
      expect(row.rows[0]).toEqual({ status: "awaiting_payment" });

      const edge = await world.place([{ quantity: 1 }]);
      const ok = await payRaw(edge.id, {
        reference: `  ${"r".repeat(255)}  `,
        amount: { amount: edge.total, currency: "UAH" },
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const stored = await world.pool.query("select payment_reference from sales_order where id = $1", [edge.id]);
      expect(stored.rows[0]).toEqual({ payment_reference: "r".repeat(255) });
    });

    it("mark-paid validates the amount exactly: missing, float, negative, too big, NaN-like, wrong types, unknown currency", async () => {
      const order = await world.place([{ quantity: 1 }]);
      const reference = "REF-A";
      const bad: [unknown, string][] = [
        [{ reference }, "amount:required"],
        [{ reference, amount: null }, "amount:invalid_type"],
        [{ reference, amount: 1000 }, "amount:invalid_type"],
        [{ reference, amount: { currency: "UAH" } }, "amount.amount:required"],
        [{ reference, amount: { amount: 1000 } }, "amount.currency:required"],
        [{ reference, amount: { amount: "1000", currency: "UAH" } }, "amount.amount:invalid_type"],
        [{ reference, amount: { amount: 1000.5, currency: "UAH" } }, "amount.amount:not_an_integer"],
        [{ reference, amount: { amount: -1, currency: "UAH" } }, "amount.amount:negative_amount"],
        [{ reference, amount: { amount: 10 ** 12 + 1, currency: "UAH" } }, "amount.amount:amount_out_of_range"],
        [{ reference, amount: { amount: 1e21, currency: "UAH" } }, "amount.amount:amount_out_of_range"],
        [{ reference, amount: { amount: 1000, currency: "uah" } }, "amount.currency:unsupported_currency"],
        [{ reference, amount: { amount: 1000, currency: "XXX" } }, "amount.currency:unsupported_currency"],
        [{ reference, amount: { amount: 1000, currency: 980 } }, "amount.currency:invalid_type"],
        [{ reference, amount: { amount: 1000, currency: "UAH", extra: 1 } }, "amount.extra:unknown_field"],
      ];
      for (const [body, expected] of bad) {
        const result = await payRaw(order.id, body);
        expect(result.status, JSON.stringify(body)).toBe(400);
        expect(paths(result), JSON.stringify(body)).toContain(expected);
      }
      // 1e999 is not representable in JSON.parse's output as a finite number: it must not be paid either.
      const infinity = await http<ProblemBody>(
        world.owner.baseUrl,
        "POST",
        `/admin/orders/${order.id}/mark-paid`,
        {
          rawBody: `{"reference":"REF-A","amount":{"amount":1e999,"currency":"UAH"}}`,
        },
      );
      expect(infinity.status).toBe(400);
      const row = await world.pool.query("select status from sales_order where id = $1", [order.id]);
      expect(row.rows[0]).toEqual({ status: "awaiting_payment" });
    });

    it("the amount is judged against the order only after it is valid: a valid but wrong amount or currency is a 409, not a 400", async () => {
      const order = await world.place([{ quantity: 2 }]);
      for (const amount of [
        { amount: order.total - 1, currency: "UAH" },
        { amount: order.total + 1, currency: "UAH" },
        { amount: 0, currency: "UAH" },
        { amount: order.total, currency: "USD" },
        { amount: order.total, currency: "EUR" },
      ]) {
        const result = await payRaw(order.id, { reference: "REF-W", amount });
        expect(result.status, JSON.stringify(amount)).toBe(409);
        expect(result.body).toMatchObject({ code: "rule_violation", rule: "amount_mismatch" });
      }
    });
  });
});
