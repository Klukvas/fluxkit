import { permissionsOf } from "@fluxkit/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RunningApp } from "../../test/app.js";
import { http, type HttpResult } from "../../test/http.js";
import { PARCEL, ShipmentWorld } from "../../test/shipment-world.js";
import { RECONCILE_NOT_FOUND_MIN_AGE_MS } from "./shipments.service.js";

/**
 * The permission walk of the shipment routes (ADR 0029 decisions 10 and 13): `orders.read` to see (the list and the
 * label), `orders.write` to act; `shipping.manage` (the settings permission) grants nothing here. The viewer holds neither
 * order permission (personal data), manager and owner hold both.
 */
describe("shipments: access (real Postgres)", () => {
  let world: ShipmentWorld;

  beforeAll(async () => {
    world = await ShipmentWorld.start();
  });

  beforeEach(() => {
    world.resetProviders();
    world.clock.advanceMinutes(1);
  });

  afterAll(async () => {
    await world.stop();
  });

  it("the viewer role holds neither order permission, and shipping.manage is not what these routes ask for", () => {
    expect(permissionsOf("viewer")).not.toContain("orders.read");
    expect(permissionsOf("viewer")).not.toContain("orders.write");
    for (const role of ["owner", "manager"] as const) {
      expect(permissionsOf(role)).toEqual(expect.arrayContaining(["orders.read", "orders.write"]));
    }
  });

  interface Route {
    name: string;
    permission: "orders.read" | "orders.write";
    /** Makes what the route needs (a paid order, a created shipment) through the given app. */
    call: (running: RunningApp, csrf?: boolean) => Promise<HttpResult<unknown> | Response>;
    success: number;
  }

  /** A paid order and, when asked, a created shipment, through `running` (its own test carrier). */
  async function target(running: RunningApp, withShipment: boolean) {
    const order = await world.paid("pickup");
    if (!withShipment) {
      return { order, shipmentId: "" };
    }
    const created = await world.created(order.id, running);
    return { order, shipmentId: created.id };
  }

  const routes: Route[] = [
    {
      name: "GET /admin/orders/:id/shipments",
      permission: "orders.read",
      success: 200,
      call: async (running, csrf) => {
        const { order } = await target(world.orders.owner, false);
        return http(running.baseUrl, "GET", `/admin/orders/${order.id}/shipments`, { csrf });
      },
    },
    {
      name: "POST /admin/orders/:id/shipments",
      permission: "orders.write",
      success: 201,
      call: async (running, csrf) => {
        const { order } = await target(world.orders.owner, false);
        return http(running.baseUrl, "POST", `/admin/orders/${order.id}/shipments`, {
          body: PARCEL,
          csrf,
        });
      },
    },
    ...(["cancel", "refresh", "reconcile"] as const).map((action): Route => ({
      name: `POST /admin/orders/:id/shipments/:shipmentId/${action}`,
      permission: "orders.write",
      success: 200,
      call: async (running, csrf) => {
        const order = await world.paid("pickup");
        if (action === "reconcile") {
          // A lost answer made through the owner's app; any app's carrier then finds no waybill (failed, 200).
          world.provider().failWaybill("createWaybill", { hang: true });
          const lost = await world.create(order.id);
          expect(lost.body.shipment.status).toBe("unknown");
          // Old enough for a "not found" to settle it (review M-2).
          world.clock.advanceMinutes(RECONCILE_NOT_FOUND_MIN_AGE_MS / 60_000);
          return http(
            running.baseUrl,
            "POST",
            `/admin/orders/${order.id}/shipments/${lost.body.shipment.id}/${action}`,
            { csrf },
          );
        }
        // The shipment is made through the app under test (when it may), else through the owner's.
        const maker = running === world.orders.viewer || running === world.orders.anonymous;
        const created = await world.created(order.id, maker ? world.orders.owner : running);
        return http(
          running.baseUrl,
          "POST",
          `/admin/orders/${order.id}/shipments/${created.id}/${action}`,
          { csrf },
        );
      },
    })),
    {
      name: "GET /admin/orders/:id/shipments/:shipmentId/label",
      permission: "orders.read",
      success: 200,
      call: async (running) => {
        const maker = running === world.orders.viewer || running === world.orders.anonymous;
        const { order, shipmentId } = await target(maker ? world.orders.owner : running, true);
        return fetch(`${running.baseUrl}/admin/orders/${order.id}/shipments/${shipmentId}/label`);
      },
    },
  ];

  const statusOf = (result: HttpResult<unknown> | Response) => result.status;

  it.each(routes)(
    "$name: 401 anonymous, 403 viewer, 403 without the CSRF header on a write, success for manager and owner",
    async (route) => {
      expect(statusOf(await route.call(world.orders.anonymous)), "anonymous").toBe(401);
      expect(statusOf(await route.call(world.orders.viewer)), "viewer").toBe(403);
      if (route.permission === "orders.write") {
        expect(statusOf(await route.call(world.orders.manager, false)), "no CSRF header").toBe(403);
      }
      expect(statusOf(await route.call(world.orders.manager)), "manager").toBe(route.success);
      expect(statusOf(await route.call(world.orders.owner)), "owner").toBe(route.success);
    },
  );

  it("a refused viewer write changes nothing and calls no carrier", async () => {
    const order = await world.paid("pickup");
    const refused = await http(
      world.orders.viewer.baseUrl,
      "POST",
      `/admin/orders/${order.id}/shipments`,
      { body: PARCEL },
    );
    expect(refused.status).toBe(403);
    expect(await world.shipmentRows(order.id)).toEqual([]);
    expect(world.provider(world.orders.viewer).calls.createWaybill).toBe(0);
  });
});
