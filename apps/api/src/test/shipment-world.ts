import { expect } from "vitest";
import type { ProblemBody } from "../common/problem.filter.js";
import { ShippingProviderRegistry } from "../shipping/registry/index.js";
import type { StartAppOptions, RunningApp } from "./app.js";
import { AdminOrdersWorld, type PlaceLine, type PlacedForAdmin } from "./admin-orders-world.js";
import { FakeClock } from "./fake-clock.js";
import { http, type HttpResult } from "./http.js";
import { ShippingMethods, type TestMethod, type TestMethodOptions } from "./shipping-fixtures.js";
import {
  TEST_PROVIDER_CODE,
  testShippingProviders,
  type TestShippingProvider,
} from "./test-shipping-provider.js";

/** TEST ONLY. Shared by the shipment specs (plan step 8). */

/** A point of the test provider's directory (`TEST_POINTS`). */
export const TEST_POINT_REF = "test-city-kyiv-point-1";

/** The body of `POST /admin/orders/{id}/shipments` the specs send unless they test the body. */
export const PARCEL = Object.freeze({
  weightGrams: 1_200,
  lengthMm: 300,
  widthMm: 200,
  heightMm: 100,
  description: "Одяг",
});

export interface ShipmentForTest {
  id: string;
  status: string;
  providerCode: string;
  providerService: string | null;
  trackingNumber: string | null;
  carrierStatusCode: string | null;
  carrierStatusAt: string | null;
  clientReference: string;
  declaredValue: { amount: number; currency: string };
  carrierCost: { amount: number; currency: string } | null;
  payer: string;
  weightGrams: number;
  createdBy: string | null;
  createdAt: string;
  cancelledAt: string | null;
  deliveredAt: string | null;
  nextTrackAt: string | null;
  history: {
    fromStatus: string | null;
    toStatus: string;
    carrierStatusCode: string | null;
    actorType: string;
    actorAdminId: string | null;
  }[];
}

export type ShipmentAnswer = ShipmentForTest & ProblemBody;
export type CreateAnswer = {
  shipment: ShipmentForTest;
  failure: { reason: string; providerCodes: string[] } | null;
} & ProblemBody;

export type PlacedKind =
  "pickup" | "address_carrier" | "address_no_carrier" | "carrier_on_delivery";

/**
 * TEST ONLY. The admin order world with the in-repo test carrier mounted in every app and four methods: a pickup point
 * method and an address method of the test carrier, an address method without a carrier, and a pickup point method the
 * recipient pays on delivery. Every method is free (flat 0), so the order total is the subtotal and `AdminOrdersWorld.place`
 * keeps working. The methods are removed in `stop`, after the orders (other spec files require that no method stays active).
 */
export class ShipmentWorld {
  readonly clock: FakeClock;
  readonly methods: ShippingMethods;
  readonly method: Partial<Record<PlacedKind, TestMethod>> = {};

  private constructor(
    readonly orders: AdminOrdersWorld,
    clock: FakeClock,
  ) {
    this.clock = clock;
    this.methods = new ShippingMethods(orders.pool);
  }

  static async start(options: StartAppOptions = {}): Promise<ShipmentWorld> {
    const clock = new FakeClock(new Date());
    const orders = await AdminOrdersWorld.start({
      clock,
      extraShippingProviders: testShippingProviders(),
      shipmentCallTimeouts: { waybillMs: 400, trackingMs: 400, labelMs: 400 },
      ...options,
    });
    const world = new ShipmentWorld(orders, clock);
    const free = { type: "flat", amount: 0 };
    const make = (options: TestMethodOptions) =>
      world.methods.create({ pricing: free, ...options });
    world.method.pickup = await make({ kind: "pickup_point", providerCode: TEST_PROVIDER_CODE });
    world.method.address_carrier = await make({
      kind: "address",
      providerCode: TEST_PROVIDER_CODE,
    });
    world.method.address_no_carrier = await make({ kind: "address", providerCode: null });
    world.method.carrier_on_delivery = await make({
      kind: "pickup_point",
      providerCode: TEST_PROVIDER_CODE,
      pricing: { type: "carrier_on_delivery" },
    });
    return world;
  }

  get pool() {
    return this.orders.pool;
  }

  /** The test carrier inside one of the apps (each app has its own instance). */
  provider(running: RunningApp = this.orders.owner): TestShippingProvider {
    return running.app
      .get(ShippingProviderRegistry)
      .get(TEST_PROVIDER_CODE) as TestShippingProvider;
  }

  resetProviders(): void {
    for (const running of [this.orders.owner, this.orders.manager, this.orders.viewer]) {
      this.provider(running).reset();
    }
  }

  /** A guest order of `kind` (not paid). */
  place(
    kind: PlacedKind = "pickup",
    lines: PlaceLine[] = [{ quantity: 1 }],
  ): Promise<PlacedForAdmin> {
    const method = this.method[kind];
    if (method === undefined) {
      throw new Error(`Test setup bug: no method for ${kind}`);
    }
    const pickup = kind === "pickup" || kind === "carrier_on_delivery";
    return this.orders.place(lines, {
      ...(pickup ? { shippingAddress: undefined } : {}),
      shipping: pickup
        ? { methodCode: method.code, pickupPointRef: TEST_POINT_REF }
        : { methodCode: method.code },
    });
  }

  /** A paid guest order of `kind`, ready for a waybill. */
  async paid(kind: PlacedKind = "pickup", lines?: PlaceLine[]): Promise<PlacedForAdmin> {
    const placed = await this.place(kind, lines);
    const paid = await this.orders.pay(placed);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    return placed;
  }

  create(
    orderId: string,
    body: unknown = PARCEL,
    running: RunningApp = this.orders.owner,
  ): Promise<HttpResult<CreateAnswer>> {
    return http<CreateAnswer>(running.baseUrl, "POST", `/admin/orders/${orderId}/shipments`, {
      body,
    });
  }

  /** Creates a waybill that the carrier accepts and returns the shipment. */
  async created(
    orderId: string,
    running: RunningApp = this.orders.owner,
  ): Promise<ShipmentForTest> {
    const result = await this.create(orderId, PARCEL, running);
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(result.body.shipment.status).toBe("created");
    return result.body.shipment;
  }

  action(
    orderId: string,
    shipmentId: string,
    action: "cancel" | "refresh" | "reconcile",
    running: RunningApp = this.orders.owner,
  ): Promise<HttpResult<ShipmentAnswer>> {
    return http<ShipmentAnswer>(
      running.baseUrl,
      "POST",
      `/admin/orders/${orderId}/shipments/${shipmentId}/${action}`,
    );
  }

  list(
    orderId: string,
    running: RunningApp = this.orders.owner,
  ): Promise<HttpResult<{ items: ShipmentForTest[] } & ProblemBody>> {
    return http(running.baseUrl, "GET", `/admin/orders/${orderId}/shipments`);
  }

  /** The label route, read raw (it answers a PDF, not JSON). */
  label(orderId: string, shipmentId: string, running: RunningApp = this.orders.owner) {
    return fetch(`${running.baseUrl}/admin/orders/${orderId}/shipments/${shipmentId}/label`);
  }

  async shipmentRows(orderId: string): Promise<Record<string, unknown>[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      "select * from shipment where order_id = $1 order by created_at, id",
      [orderId],
    );
    return result.rows;
  }

  async journal(shipmentId: string) {
    const result = await this.pool.query<{
      from_status: string | null;
      to_status: string;
      carrier_status_code: string | null;
      actor_type: string;
      actor_admin_id: string | null;
    }>(
      `select from_status, to_status, carrier_status_code, actor_type, actor_admin_id
         from shipment_status_change where shipment_id = $1 order by created_at, id`,
      [shipmentId],
    );
    return result.rows;
  }

  async events(shipmentId: string) {
    const result = await this.pool.query<{ type: string; payload: Record<string, unknown> }>(
      "select type, payload from domain_event where aggregate_id = $1 order by created_at, id",
      [shipmentId],
    );
    return result.rows;
  }

  async stop(): Promise<void> {
    try {
      await this.orders.placed.cleanup();
      await this.methods.cleanup();
    } finally {
      await this.orders.stop();
    }
  }
}
