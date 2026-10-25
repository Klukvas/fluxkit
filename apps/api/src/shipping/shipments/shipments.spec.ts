import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ORDER_READ_PORT, type OrderReadPort } from "@fluxkit/core";
import { SOME_ID } from "../../test/routes.js";
import { FIND_WAYBILL_MARGIN_MS, RECONCILE_NOT_FOUND_MIN_AGE_MS } from "./shipments.service.js";
import { captureLogs } from "../../test/shipping-fixtures.js";
import { PARCEL, ShipmentWorld, TEST_POINT_REF } from "../../test/shipment-world.js";
import { Shopper } from "../../test/shopper.js";
import {
  TEST_WAYBILL_COST_MINOR_UNITS,
  testLabelBytes,
} from "../../test/test-shipping-provider.js";

const HOUR = 60 * 60 * 1000;

describe("shipments: create, reconcile, cancel, refresh, label (ADR 0029 decision 10; real app, real Postgres)", () => {
  let world: ShipmentWorld;

  beforeAll(async () => {
    world = await ShipmentWorld.start();
  });

  beforeEach(() => {
    world.resetProviders();
    // A shipment's created_at is the API clock; moving it keeps the order of shipments of one order fixed.
    world.clock.advanceMinutes(1);
  });

  afterAll(async () => {
    await world.stop();
  });

  describe("create", () => {
    it("writes the shipment as pending first, then created with the carrier's number and cost; the journal and ONE shipment.created event; the order does not change", async () => {
      const order = await world.paid("pickup");
      const before = await world.orders.detail(order.id);
      const now = world.clock.now();

      const result = await world.create(order.id);

      expect(result.status).toBe(201);
      expect(result.body.failure).toBeNull();
      const shipment = result.body.shipment;
      expect(shipment).toMatchObject({
        status: "created",
        providerCode: "fake",
        trackingNumber: expect.stringMatching(/^TEST[0-9A-F]{6}\d{6}$/),
        clientReference: order.number,
        declaredValue: { amount: order.total, currency: "UAH" },
        carrierCost: { amount: TEST_WAYBILL_COST_MINOR_UNITS, currency: "UAH" },
        payer: "sender",
        weightGrams: PARCEL.weightGrams,
        createdBy: world.orders.ownerId,
        createdAt: now.toISOString(),
        nextTrackAt: new Date(now.getTime() + 2 * HOUR).toISOString(),
      });
      expect(shipment.history).toEqual([
        {
          fromStatus: null,
          toStatus: "pending",
          carrierStatusCode: null,
          actorType: "admin",
          actorAdminId: world.orders.ownerId,
          at: expect.any(String),
        },
        {
          fromStatus: "pending",
          toStatus: "created",
          carrierStatusCode: null,
          actorType: "admin",
          actorAdminId: world.orders.ownerId,
          at: expect.any(String),
        },
      ]);
      expect(await world.events(shipment.id)).toEqual([
        {
          type: "shipment.created",
          payload: {
            shipmentId: shipment.id,
            orderId: order.id,
            orderNumber: order.number,
            status: "created",
          },
        },
      ]);

      // What reached the carrier: our order number, the point, the recipient, the parcel.
      const [request] = world.provider().waybillRequests;
      expect(request).toMatchObject({
        clientReference: order.number,
        payer: "sender",
        declaredValue: { amount: order.total, currency: "UAH" },
        parcel: { weightGrams: 1_200, lengthMm: 300, widthMm: 200, heightMm: 100, seats: 1 },
        description: "Одяг",
        recipient: { firstName: "Іван", lastName: "Петренко", phone: "+380501234567" },
        destination: {
          kind: "pickup_point",
          cityRef: "test-city-kyiv",
          pickupPointRef: TEST_POINT_REF,
        },
      });

      // The row keeps no name and no phone.
      const [row] = await world.shipmentRows(order.id);
      const stored = JSON.stringify(row);
      expect(stored).not.toContain("Петренко");
      expect(stored).not.toContain("380501234567");
      expect(row).toMatchObject({
        status: "created",
        tracking_number: shipment.trackingNumber,
        provider_ref: `test-waybill-${shipment.trackingNumber?.slice(4) ?? ""}`,
      });

      const after = await world.orders.detail(order.id);
      expect(after.body.status).toBe("paid");
      expect(after.body.fulfilledAt).toBeNull();
      expect(after.body.history).toEqual(before.body.history);
      expect(after.body.items).toEqual(before.body.items);
      expect(after.body.shipments).toEqual([shipment]);
    });

    it("an address order of a carrier sends the order's address; carrier_on_delivery defaults the payer to the recipient", async () => {
      const address = await world.paid("address_carrier");
      expect((await world.create(address.id)).status).toBe(201);
      expect(world.provider().waybillRequests[0]?.destination).toEqual({
        kind: "address",
        address: { countryCode: "UA", city: "Київ", line1: "вул. Хрещатик 1", postalCode: "01001" },
      });

      const onDelivery = await world.paid("carrier_on_delivery");
      const created = await world.create(onDelivery.id);
      expect(created.body.shipment.payer).toBe("recipient");
      const explicit = await world.paid("carrier_on_delivery");
      expect(
        (await world.create(explicit.id, { ...PARCEL, payer: "sender" })).body.shipment.payer,
      ).toBe("sender");
    });

    it("a declared value may be given in the order currency, never another one", async () => {
      const order = await world.paid("pickup");
      const wrong = await world.create(order.id, {
        ...PARCEL,
        declaredValue: { amount: 500, currency: "EUR" },
      });
      expect(wrong.status).toBe(400);
      expect(wrong.body.errors).toEqual([
        expect.objectContaining({ path: "declaredValue.currency", code: "currency_mismatch" }),
      ]);
      const right = await world.create(order.id, {
        ...PARCEL,
        declaredValue: { amount: 500, currency: "UAH" },
      });
      expect(right.status).toBe(201);
      expect(right.body.shipment.declaredValue).toEqual({ amount: 500, currency: "UAH" });
    });

    it.each([
      ["an empty body", {}],
      ["an unknown field", { ...PARCEL, recipientPhone: "+380501234567" }],
      ["weight 0", { ...PARCEL, weightGrams: 0 }],
      ["a fractional size", { ...PARCEL, lengthMm: 1.5 }],
      ["an empty description", { ...PARCEL, description: "  " }],
      ["seats", { ...PARCEL, seats: 2 }],
    ])("refuses %s with 400 and writes nothing", async (_name, body) => {
      const order = await world.paid("pickup");
      const result = await world.create(order.id, body);
      expect(result.status).toBe(400);
      expect(result.body.code).toBe("validation_failed");
      expect(await world.shipmentRows(order.id)).toEqual([]);
      expect(world.provider().calls.createWaybill).toBe(0);
    });

    it("404 for an unknown order", async () => {
      const result = await world.create(SOME_ID);
      expect(result.status).toBe(404);
    });

    it("refuses an order that is not paid (awaiting payment, cancelled) with 409 order_not_paid; nothing written, no carrier call", async () => {
      const unpaid = await world.place("pickup");
      const refused = await world.create(unpaid.id);
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: "rule_violation", rule: "order_not_paid" });

      const cancelled = await world.place("pickup");
      expect((await world.orders.cancel(cancelled.id)).status).toBe(200);
      expect((await world.create(cancelled.id)).body.rule).toBe("order_not_paid");

      expect(await world.shipmentRows(unpaid.id)).toEqual([]);
      expect(await world.shipmentRows(cancelled.id)).toEqual([]);
      expect(world.provider().calls.createWaybill).toBe(0);
    });

    it("refuses a fulfilled order too (only a paid order ships)", async () => {
      const order = await world.paid("pickup");
      expect((await world.orders.fulfil(order.id)).status).toBe(200);
      expect((await world.create(order.id)).body.rule).toBe("order_not_paid");
    });

    it("refuses while a line awaits stock (the mark-fulfilled rule) with 409 awaiting_stock; commits nothing", async () => {
      const order = await world.paid("pickup", [
        { quantity: 1 },
        { quantity: 2, onHand: 0, allowBackorder: true },
      ]);
      const before = await world.orders.detail(order.id);
      const refused = await world.create(order.id);
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: "rule_violation", rule: "awaiting_stock" });
      expect(await world.shipmentRows(order.id)).toEqual([]);
      expect(world.provider().calls.createWaybill).toBe(0);
      const after = await world.orders.detail(order.id);
      expect(after.body.items.map((item) => item.reservations)).toEqual(
        before.body.items.map((item) => item.reservations),
      );
      expect(after.body.status).toBe("paid");
    });

    it("refuses an order without a carrier: no shipping snapshot, or a method without a provider (409 no_carrier)", async () => {
      const noMethod = await world.orders.place([{ quantity: 1 }], {
        shipping: { methodCode: world.method.address_no_carrier?.code },
      });
      expect((await world.orders.pay(noMethod)).status).toBe(200);
      const refused = await world.create(noMethod.id);
      expect(refused.status).toBe(409);
      expect(refused.body.rule).toBe("no_carrier");

      const digital = await world.orders.place([{ quantity: 1, digital: true }], {
        shippingAddress: undefined,
      });
      expect((await world.orders.pay(digital)).status).toBe(200);
      expect((await world.create(digital.id)).body.rule).toBe("no_carrier");
    });

    it("one active shipment per order: a second create is 409 shipment_exists; after a cancel a new one can be created", async () => {
      const order = await world.paid("pickup");
      const first = await world.created(order.id);
      const second = await world.create(order.id);
      expect(second.status).toBe(409);
      expect(second.body.rule).toBe("shipment_exists");
      expect(world.provider().calls.createWaybill).toBe(1);

      expect((await world.action(order.id, first.id, "cancel")).status).toBe(200);
      world.clock.advanceMinutes(1);
      const again = await world.create(order.id);
      expect(again.status).toBe(201);
      expect((await world.list(order.id)).body.items.map((entry) => entry.status)).toEqual([
        "cancelled",
        "created",
      ]);
    });

    it("the carrier refuses: 201 failed with the typed reason and codes (no text); journal pending -> failed; a new create is allowed", async () => {
      const order = await world.paid("pickup");
      world.provider().failWaybill("createWaybill", {
        reason: "rejected",
        providerCodes: ["20000200039"],
      });
      const result = await world.create(order.id);
      expect(result.status).toBe(201);
      expect(result.body.failure).toEqual({ reason: "rejected", providerCodes: ["20000200039"] });
      expect(result.body.shipment).toMatchObject({
        status: "failed",
        trackingNumber: null,
        nextTrackAt: null,
      });
      expect(result.body.shipment.history.map((entry) => entry.toStatus)).toEqual([
        "pending",
        "failed",
      ]);
      expect((await world.events(result.body.shipment.id)).map((event) => event.payload)).toEqual([
        {
          shipmentId: result.body.shipment.id,
          orderId: order.id,
          orderNumber: order.number,
          status: "failed",
        },
      ]);
      world.clock.advanceMinutes(1);
      expect((await world.created(order.id)).status).toBe("created");
    });

    it("invalid credentials are a refusal too (failed), never unknown", async () => {
      const order = await world.paid("pickup");
      world.provider().failWaybill("createWaybill", { reason: "invalid_credentials" });
      const result = await world.create(order.id);
      expect(result.body.shipment.status).toBe("failed");
      expect(result.body.failure).toEqual({ reason: "invalid_credentials", providerCodes: [] });
    });
  });

  describe("a lost answer: unknown, then reconcile (never a blind retry)", () => {
    it("a timeout leaves the shipment unknown (result not known); reconcile finds the waybill by our order number and makes it created", async () => {
      const order = await world.paid("pickup");
      world.provider().failWaybill("createWaybill", { afterEffect: true, hang: true });
      const result = await world.create(order.id);
      expect(result.status).toBe(201);
      expect(result.body.failure).toBeNull();
      const unknown = result.body.shipment;
      expect(unknown).toMatchObject({ status: "unknown", trackingNumber: null, nextTrackAt: null });
      expect((await world.events(unknown.id)).map((event) => event.type)).toEqual([
        "shipment.status_changed",
      ]);
      // A second create is refused: the unknown one may exist at the carrier.
      expect((await world.create(order.id)).body.rule).toBe("shipment_exists");

      const [atCarrier] = world.provider().waybills.values();
      const reconciled = await world.action(order.id, unknown.id, "reconcile");
      expect(reconciled.status).toBe(200);
      expect(reconciled.body).toMatchObject({
        status: "created",
        trackingNumber: atCarrier?.created.trackingNumber,
        carrierCost: { amount: TEST_WAYBILL_COST_MINOR_UNITS, currency: "UAH" },
      });
      // An instant window, never a date (review M-2): from the creation minus the margin to now plus the margin.
      const createdAt = new Date(unknown.createdAt).getTime();
      expect(world.provider().findRequests).toEqual([
        {
          clientReference: order.number,
          createdAfter: new Date(createdAt - FIND_WAYBILL_MARGIN_MS).toISOString(),
          createdBefore: new Date(
            world.clock.now().getTime() + FIND_WAYBILL_MARGIN_MS,
          ).toISOString(),
        },
      ]);
      expect(world.provider().calls.createWaybill).toBe(1);
      expect(reconciled.body.history.map((entry) => [entry.fromStatus, entry.toStatus])).toEqual([
        [null, "pending"],
        ["pending", "unknown"],
        ["unknown", "created"],
      ]);
      expect((await world.events(unknown.id)).map((event) => event.type)).toEqual([
        "shipment.status_changed",
        "shipment.created",
      ]);
    });

    it("an 'unavailable' answer and a thrown error are lost answers too (unknown), not refusals", async () => {
      const network = await world.paid("pickup");
      world.provider().failWaybill("createWaybill", { reason: "unavailable" });
      expect((await world.create(network.id)).body.shipment.status).toBe("unknown");

      const thrown = await world.paid("pickup");
      world.provider().failWaybill("createWaybill", { message: "socket hang up" });
      expect((await world.create(thrown.id)).body.shipment.status).toBe("unknown");
    });

    it("an answer that breaks the port is not stored: unknown", async () => {
      const order = await world.paid("pickup");
      world.provider().failWaybill("createWaybill", {
        answer: { providerRef: "bad ref with spaces", trackingNumber: "X", carrierCost: null },
      });
      const result = await world.create(order.id);
      expect(result.body.shipment).toMatchObject({ status: "unknown", trackingNumber: null });
    });

    it("the carrier created nothing: reconcile makes it failed, and a new create is allowed", async () => {
      const order = await world.paid("pickup");
      world.provider().failWaybill("createWaybill", { hang: true });
      const unknown = (await world.create(order.id)).body.shipment;
      world.clock.advanceMinutes(RECONCILE_NOT_FOUND_MIN_AGE_MS / 60_000);
      const reconciled = await world.action(order.id, unknown.id, "reconcile");
      expect(reconciled.status).toBe(200);
      expect(reconciled.body.status).toBe("failed");
      expect((await world.events(unknown.id)).map((event) => event.payload["status"])).toEqual([
        "unknown",
        "failed",
      ]);
      world.clock.advanceMinutes(1);
      expect((await world.created(order.id)).status).toBe("created");
    });

    it("review M-2: a 'not found' for a shipment younger than the minimum age is 409 reconcile_too_early; it stays unknown", async () => {
      const order = await world.paid("pickup");
      world.provider().failWaybill("createWaybill", { hang: true });
      const unknown = (await world.create(order.id)).body.shipment;
      // The carrier's list may lag right after a timed-out save: a negative answer this early proves nothing.
      world.clock.advanceMinutes(RECONCILE_NOT_FOUND_MIN_AGE_MS / 60_000 - 1);
      const early = await world.action(order.id, unknown.id, "reconcile");
      expect(early.status).toBe(409);
      expect(early.body).toMatchObject({ code: "rule_violation", rule: "reconcile_too_early" });
      expect(early.headers.get("retry-after")).toBe("60");
      expect(world.provider().calls.findWaybill).toBe(1);
      expect((await world.list(order.id)).body.items[0]?.status).toBe("unknown");
      expect(await world.journal(unknown.id)).toHaveLength(2);
      // A create is still refused: the shipment may exist at the carrier.
      expect((await world.create(order.id)).body.rule).toBe("shipment_exists");

      world.clock.advanceMinutes(1);
      const late = await world.action(order.id, unknown.id, "reconcile");
      expect(late.status).toBe(200);
      expect(late.body.status).toBe("failed");
      // The window reaches past the time of THIS lookup, not only past the creation.
      expect(world.provider().findRequests.at(-1)).toEqual({
        clientReference: order.number,
        createdAfter: new Date(
          new Date(unknown.createdAt).getTime() - FIND_WAYBILL_MARGIN_MS,
        ).toISOString(),
        createdBefore: new Date(world.clock.now().getTime() + FIND_WAYBILL_MARGIN_MS).toISOString(),
      });
    });

    it("review M-2: a waybill the carrier dated after UTC midnight is found (a date-only lookup of the creation day would miss it)", async () => {
      const now = world.clock.now();
      // The next 23:59:50 UTC (forward only: other specs rely on created_at moving on).
      const nearMidnight = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 23, 59, 50),
      );
      world.clock.set(nearMidnight);
      const order = await world.paid("pickup");
      const provider = world.provider();
      // The carrier saves the waybill 20 s later, on the next UTC (and Kyiv) day, then the answer is lost.
      provider.now = () => new Date(nearMidnight.getTime() + 20_000);
      provider.failWaybill("createWaybill", { afterEffect: true, hang: true });
      const unknown = (await world.create(order.id)).body.shipment;
      expect(unknown.status).toBe("unknown");
      expect(unknown.createdAt.slice(0, 10)).not.toBe(
        new Date(nearMidnight.getTime() + 20_000).toISOString().slice(0, 10),
      );
      world.clock.advanceMinutes(10);
      const reconciled = await world.action(order.id, unknown.id, "reconcile");
      expect(reconciled.status).toBe(200);
      expect(reconciled.body.status).toBe("created");
      const [request] = provider.findRequests;
      expect(request?.createdAfter.slice(0, 10)).toBe(nearMidnight.toISOString().slice(0, 10));
    });

    it("review M-2: the test carrier honours the window: a waybill created outside it is not found", async () => {
      const order = await world.paid("pickup");
      const provider = world.provider();
      // A waybill the carrier dates an hour BEFORE our shipment row (another, older one with our order number).
      provider.now = () => new Date(world.clock.now().getTime() - 60 * 60_000);
      provider.failWaybill("createWaybill", { afterEffect: true, hang: true });
      const unknown = (await world.create(order.id)).body.shipment;
      world.clock.advanceMinutes(RECONCILE_NOT_FOUND_MIN_AGE_MS / 60_000);
      const reconciled = await world.action(order.id, unknown.id, "reconcile");
      expect(reconciled.status).toBe(200);
      expect(reconciled.body.status).toBe("failed");
    });

    it("reconcile while the carrier is down or slow: 503 shipping_provider_unavailable with Retry-After; still unknown", async () => {
      const order = await world.paid("pickup");
      world.provider().failWaybill("createWaybill", { hang: true });
      const unknown = (await world.create(order.id)).body.shipment;

      world.provider().failWaybill("findWaybill", { reason: "unavailable", providerCodes: ["E1"] });
      const down = await world.action(order.id, unknown.id, "reconcile");
      expect(down.status).toBe(503);
      expect(down.headers.get("retry-after")).toBe("30");
      expect(down.body).toMatchObject({
        code: "shipping_provider_unavailable",
        reason: "unavailable",
        providerCodes: ["E1"],
      });

      world.provider().failWaybill("findWaybill", { hang: true });
      expect((await world.action(order.id, unknown.id, "reconcile")).status).toBe(503);
      expect((await world.list(order.id)).body.items[0]?.status).toBe("unknown");
      expect(await world.journal(unknown.id)).toHaveLength(2);
    });

    it("reconcile of a shipment that is not unknown is 409 shipment_not_unknown with no carrier call", async () => {
      const order = await world.paid("pickup");
      const created = await world.created(order.id);
      const refused = await world.action(order.id, created.id, "reconcile");
      expect(refused.status).toBe(409);
      expect(refused.body.rule).toBe("shipment_not_unknown");
      expect(world.provider().calls.findWaybill).toBe(0);
    });

    it("a pending shipment left by a crash is reconcilable once it is older than two minutes, not before", async () => {
      const order = await world.paid("pickup");
      world.provider().failWaybill("createWaybill", { hang: true });
      const unknown = (await world.create(order.id)).body.shipment;
      // Turn it back into a stuck `pending` row (what a crash between the two transactions leaves).
      await world.pool.query(
        "update shipment set status = 'pending', created_at = $2 where id = $1",
        [unknown.id, world.clock.now()],
      );
      expect((await world.action(order.id, unknown.id, "reconcile")).body.rule).toBe(
        "shipment_not_unknown",
      );
      world.clock.advanceMinutes(3);
      // Reconcilable now, but a "not found" this young does not settle it (review M-2).
      const early = await world.action(order.id, unknown.id, "reconcile");
      expect(early.body.rule).toBe("reconcile_too_early");
      world.clock.advanceMinutes(RECONCILE_NOT_FOUND_MIN_AGE_MS / 60_000);
      const reconciled = await world.action(order.id, unknown.id, "reconcile");
      expect(reconciled.status).toBe(200);
      expect(reconciled.body.status).toBe("failed");
    });
  });

  describe("cancel", () => {
    it("cancels the waybill at the carrier, then the shipment: shipment.cancelled; the order and its stock stay as they were", async () => {
      const order = await world.paid("pickup");
      const created = await world.created(order.id);
      const before = await world.orders.detail(order.id);
      const cancelled = await world.action(order.id, created.id, "cancel");
      expect(cancelled.status).toBe(200);
      expect(cancelled.body).toMatchObject({
        status: "cancelled",
        cancelledAt: world.clock.now().toISOString(),
        nextTrackAt: null,
      });
      expect((await world.events(created.id)).map((event) => event.type)).toEqual([
        "shipment.created",
        "shipment.cancelled",
      ]);
      const after = await world.orders.detail(order.id);
      expect(after.body.status).toBe("paid");
      expect(after.body.items).toEqual(before.body.items);
      expect(after.body.history).toEqual(before.body.history);
    });

    it("the carrier refuses: 409 carrier_rejected with the codes, nothing changes", async () => {
      const order = await world.paid("pickup");
      const created = await world.created(order.id);
      world.provider().failWaybill("cancelWaybill", {
        reason: "rejected",
        providerCodes: ["NOT_CANCELLABLE"],
      });
      const refused = await world.action(order.id, created.id, "cancel");
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        code: "rule_violation",
        rule: "carrier_rejected",
        providerCodes: ["NOT_CANCELLABLE"],
      });
      expect((await world.list(order.id)).body.items[0]?.status).toBe("created");
    });

    it("an unknown or a failed shipment cannot be cancelled (409 invalid_transition), with no carrier call", async () => {
      const order = await world.paid("pickup");
      world.provider().failWaybill("createWaybill", { hang: true });
      const unknown = (await world.create(order.id)).body.shipment;
      const refused = await world.action(order.id, unknown.id, "cancel");
      expect(refused.status).toBe(409);
      expect(refused.body.rule).toBe("invalid_transition");
      expect(world.provider().calls.cancelWaybill).toBe(0);
    });

    it("a shipment of another order is 404", async () => {
      const order = await world.paid("pickup");
      const other = await world.paid("pickup");
      const created = await world.created(order.id);
      expect((await world.action(other.id, created.id, "cancel")).status).toBe(404);
      expect((await world.action(order.id, SOME_ID, "cancel")).status).toBe(404);
    });
  });

  describe("refresh", () => {
    it("asks the carrier for one shipment: a new status is a journal row by the admin with the carrier code and an event", async () => {
      const order = await world.paid("pickup");
      const created = await world.created(order.id);
      const at = new Date(world.clock.now().getTime() - 5 * 60_000);
      world.provider().setTracking(created.trackingNumber ?? "", {
        status: "in_transit",
        carrierStatusCode: "5",
        carrierStatusAt: at,
      });
      const refreshed = await world.action(order.id, created.id, "refresh");
      expect(refreshed.status).toBe(200);
      expect(refreshed.body).toMatchObject({
        status: "in_transit",
        carrierStatusCode: "5",
        carrierStatusAt: at.toISOString(),
        nextTrackAt: new Date(world.clock.now().getTime() + 4 * HOUR).toISOString(),
      });
      expect(refreshed.body.history.at(-1)).toMatchObject({
        fromStatus: "created",
        toStatus: "in_transit",
        carrierStatusCode: "5",
        actorType: "admin",
        actorAdminId: world.orders.ownerId,
      });
      expect(world.provider().trackRequests).toEqual([
        { trackingNumbers: [created.trackingNumber], phones: ["+380501234567"] },
      ]);
      expect((await world.events(created.id)).map((event) => event.payload["status"])).toEqual([
        "created",
        "in_transit",
      ]);

      // Delivered: terminal, no more tracking; the order is still only paid (fulfilment stays manual).
      world
        .provider()
        .setTracking(created.trackingNumber ?? "", { status: "delivered", carrierStatusCode: "9" });
      const delivered = await world.action(order.id, created.id, "refresh");
      expect(delivered.body).toMatchObject({
        status: "delivered",
        deliveredAt: world.clock.now().toISOString(),
        nextTrackAt: null,
      });
      expect((await world.orders.detail(order.id)).body.status).toBe("paid");
    });

    it("the same status again changes only the carrier code: no journal row and no event", async () => {
      const order = await world.paid("pickup");
      const created = await world.created(order.id);
      world
        .provider()
        .setTracking(created.trackingNumber ?? "", { status: "created", carrierStatusCode: "1" });
      const refreshed = await world.action(order.id, created.id, "refresh");
      expect(refreshed.body).toMatchObject({ status: "created", carrierStatusCode: "1" });
      expect(await world.journal(created.id)).toHaveLength(2);
      expect(await world.events(created.id)).toHaveLength(1);
    });

    it("the carrier is down: 503 with the reason, nothing changes; a shipment without a waybill is 409 shipment_not_tracked", async () => {
      const order = await world.paid("pickup");
      const created = await world.created(order.id);
      world.provider().failWaybill("track", { reason: "unavailable" });
      const down = await world.action(order.id, created.id, "refresh");
      expect(down.status).toBe(503);
      expect(down.body.code).toBe("shipping_provider_unavailable");

      const lost = await world.paid("pickup");
      world.provider().failWaybill("createWaybill", { hang: true });
      const unknown = (await world.create(lost.id)).body.shipment;
      const refused = await world.action(lost.id, unknown.id, "refresh");
      expect(refused.status).toBe(409);
      expect(refused.body.rule).toBe("shipment_not_tracked");
    });

    it("a status the machine does not allow from here is ignored, not applied", async () => {
      const order = await world.paid("pickup");
      const created = await world.created(order.id);
      world.provider().setTracking(created.trackingNumber ?? "", {
        status: "returned",
        carrierStatusCode: "103",
      });
      const refreshed = await world.action(order.id, created.id, "refresh");
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.status).toBe("created");
      expect(await world.journal(created.id)).toHaveLength(2);
    });
  });

  describe("label", () => {
    it("streams the carrier's PDF through our API with pinned headers", async () => {
      const order = await world.paid("pickup");
      const created = await world.created(order.id);
      const response = await world.label(order.id, created.id);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("content-disposition")).toBe(
        `attachment; filename="label-${order.number}.pdf"`,
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(response.headers.get("content-length")).toBe(String(bytes.length));
      const [row] = await world.shipmentRows(order.id);
      expect(bytes).toEqual(testLabelBytes(String(row?.["provider_ref"])));
    });

    it("no waybill yet (unknown) or cancelled: 409 label_not_available, no carrier call", async () => {
      const order = await world.paid("pickup");
      world.provider().failWaybill("createWaybill", { hang: true });
      const unknown = (await world.create(order.id)).body.shipment;
      const response = await world.label(order.id, unknown.id);
      expect(response.status).toBe(409);
      expect(response.headers.get("content-type")).toContain("application/problem+json");
      expect(((await response.json()) as { rule: string }).rule).toBe("label_not_available");
      expect(world.provider().calls.fetchLabel).toBe(0);
    });

    it("an answer that is not a PDF, or too large, is never passed on (503)", async () => {
      const order = await world.paid("pickup");
      const created = await world.created(order.id);
      world.provider().labelBytes = new TextEncoder().encode("<html><script>alert(1)</script>");
      const html = await world.label(order.id, created.id);
      expect(html.status).toBe(503);
      expect(html.headers.get("content-type")).toContain("application/problem+json");

      const huge = new Uint8Array(10 * 1024 * 1024 + 1);
      huge.set(new TextEncoder().encode("%PDF-"));
      world.provider().labelBytes = huge;
      expect((await world.label(order.id, created.id)).status).toBe(503);

      world.provider().labelBytes = null;
      world.provider().labelContentType = "text/html";
      expect((await world.label(order.id, created.id)).status).toBe(503);
    });

    it("the carrier is down: 503 with Retry-After", async () => {
      const order = await world.paid("pickup");
      const created = await world.created(order.id);
      world.provider().failWaybill("fetchLabel", { hang: true });
      const response = await world.label(order.id, created.id);
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("30");
    });
  });

  describe("order views", () => {
    it("the store view shows only shipments with a waybill number, with the normalized status; the admin view and OrderReadPort show all", async () => {
      const order = await world.paid("pickup");
      world.provider().failWaybill("createWaybill", { reason: "rejected" });
      await world.create(order.id);
      world.clock.advanceMinutes(1);
      const created = await world.created(order.id);

      const store = await new Shopper(world.orders.owner.baseUrl).post<{ shipments: unknown[] }>(
        "/store/orders/lookup",
        { number: order.number, accessToken: order.accessToken },
      );
      expect(store.status).toBe(200);
      expect(store.body.shipments).toEqual([
        {
          providerCode: "fake",
          trackingNumber: created.trackingNumber,
          status: "created",
          createdAt: created.createdAt,
          updatedAt: expect.any(String),
          deliveredAt: null,
          cancelledAt: null,
        },
      ]);

      const admin = await world.orders.detail(order.id);
      expect(admin.body.shipments.map((entry) => entry.status)).toEqual(["failed", "created"]);
      const port = world.orders.owner.app.get<OrderReadPort>(ORDER_READ_PORT);
      expect((await port.getOrder(order.id))?.shipments).toEqual(admin.body.shipments);
      expect((await world.list(order.id)).body.items).toEqual(admin.body.shipments);
    });
  });

  describe("logs", () => {
    it("never carry the recipient's name or phone, a carrier's message or a key", async () => {
      const secret = "Іван Петренко +380501234567 apiKey=SECRET-PROVIDER-KEY-123";
      const logs = captureLogs();
      try {
        const order = await world.paid("pickup");
        world.provider().failWaybill("createWaybill", { message: secret });
        const unknown = (await world.create(order.id)).body.shipment;
        world.provider().failWaybill("findWaybill", { message: secret });
        await world.action(order.id, unknown.id, "reconcile");
        const other = await world.paid("pickup");
        const created = await world.created(other.id);
        world.provider().failWaybill("track", { message: secret });
        await world.action(other.id, created.id, "refresh");
        world.provider().failWaybill("fetchLabel", { message: secret });
        await world.label(other.id, created.id);
        world.provider().failWaybill("cancelWaybill", { message: secret });
        await world.action(other.id, created.id, "cancel");
      } finally {
        logs.stop();
      }
      const text = logs.text();
      expect(text).toContain("createWaybill");
      for (const needle of ["Петренко", "380501234567", "SECRET-PROVIDER-KEY", "apiKey", "Іван"]) {
        expect(text).not.toContain(needle);
      }
    });
  });

  describe("outbox atomicity", () => {
    it("when the event cannot be written, the status change and its journal row roll back with it", async () => {
      const order = await world.paid("pickup");
      await world.pool.query(`
        create or replace function test_refuse_shipment_created() returns trigger language plpgsql as $$
        begin
          if new.type = 'shipment.created' then raise exception 'test: outbox refused'; end if;
          return new;
        end $$;
        create trigger test_refuse_shipment_created before insert on domain_event
          for each row execute function test_refuse_shipment_created();
      `);
      const logs = captureLogs();
      try {
        const result = await world.create(order.id);
        expect(result.status).toBe(500);
      } finally {
        logs.stop();
        await world.pool.query(`
          drop trigger test_refuse_shipment_created on domain_event;
          drop function test_refuse_shipment_created();
        `);
      }
      const [row] = await world.shipmentRows(order.id);
      expect(row?.["status"]).toBe("pending");
      expect(row?.["tracking_number"]).toBeNull();
      const shipmentId = String(row?.["id"]);
      expect((await world.journal(shipmentId)).map((entry) => entry.to_status)).toEqual([
        "pending",
      ]);
      expect(await world.events(shipmentId)).toEqual([]);
    });
  });
});
