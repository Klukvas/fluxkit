import { startApp } from "../test/app.js";
import { PersonalDataReader } from "../privacy/export/personal-data.reader.js";
import { Shopper } from "../test/shopper.js";
import type { WaybillRequest } from "@fluxkit/core";
import { sql } from "drizzle-orm";
import { findPostgresError } from "../common/postgres-errors.js";
import {
  ShippingDirectoryService,
  type EstimateQuery,
} from "./store/shipping-directory.service.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureMigrated } from "../test/migrate.js";
import { ShipmentWorld } from "../test/shipment-world.js";
import { raceAdminRevocation } from "../test/admin-revocation-race.js";
import {
  createManagedShippingFixture,
  type ManagedShippingFixture,
  testSecretsKeyRing,
} from "../test/integration-provider-fixture.js";
import { SecretCipher } from "../integrations/secret-cipher.js";
import { ShippingProviders } from "./registry/shipping-providers.js";
import { http } from "../test/http.js";
import { ShipmentTrackingService } from "./shipments/shipment-tracking.service.js";
import { trackShipments } from "../jobs/track-shipments.job.js";

const KEY_A = "invented-shipping-key-A";
const KEY_B = "invented-shipping-key-B";
describe("managed shipping bindings (real Postgres, fixture carrier transport)", () => {
  let world: ShipmentWorld;
  const ring = testSecretsKeyRing();
  const cipher = new SecretCipher(ring);
  const owner = randomUUID();
  let a: string;
  let methodCode: string;
  let fixture: ManagedShippingFixture;
  let calls: ManagedShippingFixture["shipping"]["calls"];
  let holdCities: (() => void)[] | undefined;
  let citiesStarted: (() => void) | undefined;
  let observedBinding: string | null = null;
  let creatingOrder: string | undefined;
  const bindingsAtHttpStart: (string | null)[] = [];
  beforeAll(async () => {
    await ensureMigrated([], { reset: true });
    fixture = await createManagedShippingFixture();
    calls = fixture.shipping.calls;
    fixture.shipping.estimateAmounts.set(KEY_A, 100);
    fixture.shipping.estimateAmounts.set(KEY_B, 200);
    world = await ShipmentWorld.start({
      shippingDelegated: true,
      secretsKeyRing: ring,
      integrationProvidersDir: fixture.dir,
      shipmentCallTimeouts: { waybillMs: 3000, trackingMs: 3000, labelMs: 3000 },
    });
    await world.pool.query(
      "insert into integration(id,kind,provider_code) values($1,'shipping','testship')",
      [owner],
    );
    a = await version(KEY_A);
    await activate(a);
    await world.pool.query(
      "insert into shipping_provider_setting(provider_code,settings) values('testship',$1)",
      [
        JSON.stringify({
          senderName: "Test Sender",
          senderPhone: "380501234567",
          senderDivisionId: 123,
          payerDefault: "Recipient",
          defaultParcel: { weightGrams: 500, lengthMm: 200, widthMm: 150, heightMm: 100 },
        }),
      ],
    );
    const method = await world.methods.create({
      kind: "pickup_point",
      providerCode: "testship",
      pricing: { type: "flat", amount: 0 },
    });
    methodCode = method.code;
    fixture.shipping.backend.now = () => world.clock.now();
    fixture.shipping.onRequest = async (call, input) => {
      if (creatingOrder !== undefined) {
        const pending = await world.pool.query<{ binding: string }>(
          "select integration_credential_version_id as binding from shipment where order_id=$1 and status='pending'",
          [creatingOrder],
        );
        bindingsAtHttpStart.push(pending.rows[0]?.binding ?? null);
      }
      if (call.operation === "searchCities" && holdCities !== undefined) {
        await new Promise<void>((resolve) => {
          holdCities?.push(resolve);
          if (holdCities?.length === 3) citiesStarted?.();
        });
      }
      if (call.operation === "createWaybill") {
        const request = input as WaybillRequest;
        const rows = await world.pool.query<{ binding: string }>(
          "select integration_credential_version_id as binding from shipment where client_reference=$1",
          [request.clientReference],
        );
        observedBinding = rows.rows[0]?.binding ?? null;
      }
    };
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (world) await world.stop();
    if (fixture) await fixture.remove();
    await ensureMigrated([], { reset: true });
  });
  async function version(key: string, environment = "sandbox") {
    const id = randomUUID(),
      secretId = randomUUID();
    const next = await world.pool.query<{ n: number }>(
      "select coalesce(max(generation),0)::int+1 n from integration_credential_version where integration_id=$1",
      [owner],
    );
    const generation = next.rows[0]?.n ?? 1;
    await world.pool.query(
      "insert into integration_credential_version(id,integration_id,generation,purpose,state,environment) values($1,$2,$3,'outbound','candidate',$4)",
      [id, owner, generation, environment],
    );
    const sealed = cipher.seal(
      {
        secretId,
        integrationId: owner,
        kind: "shipping",
        providerCode: "testship",
        field: "api_key",
        generation,
      },
      key,
    );
    await world.pool.query(
      "insert into integration_secret(id,version_id,field,key_id,nonce,ciphertext,tag) values($1,$2,'api_key',$3,$4,$5,$6)",
      [secretId, id, sealed.keyId, sealed.nonce, sealed.ciphertext, sealed.tag],
    );
    return id;
  }
  async function activate(id: string) {
    await world.pool.query(
      "update integration_credential_version set state='draining' where integration_id=$1 and state='active'",
      [owner],
    );
    await world.pool.query("update integration_credential_version set state='active' where id=$1", [
      id,
    ]);
    await world.pool.query(
      "update integration set enabled=true,active_outbound_version_id=$2 where id=$1",
      [owner, id],
    );
    await world.pool.query("update integration_revision set revision=revision+1");
  }
  async function paid() {
    const placed = await world.orders.place([{ quantity: 1 }], {
      shippingAddress: undefined,
      shipping: { methodCode, pickupPointRef: "test-city-kyiv-point-1" },
    });
    expect((await world.orders.pay(placed)).status).toBe(200);
    return placed;
  }
  it.each(
    ["prepare", "cancel", "reconcile", "refresh"].flatMap((operation) =>
      ["disable", "revoke"].map((action) => ({ operation, action })),
    ),
  )(
    "does not deadlock owner $action against shipment $operation",
    async ({ operation, action }) => {
      const id = await version(KEY_A);
      await activate(id);
      const placed = await paid();
      let shipmentId = "";
      if (operation !== "prepare") {
        if (operation === "reconcile")
          fixture.shipping.backend.failWaybill("createWaybill", {
            afterEffect: true,
            message: "test_lost_response",
          });
        const created = await world.create(placed.id);
        expect(created.status).toBe(201);
        shipmentId = created.body.shipment.id;
        if (operation === "refresh")
          fixture.shipping.backend.setTracking(created.body.shipment.trackingNumber ?? "", {
            status: "in_transit",
            carrierStatusCode: "TEST_TRANSIT",
          });
      }
      const raced = await raceAdminRevocation<{
        status: number;
        body: { code?: string; rule?: string };
      }>(
        world.pool,
        world.orders.ownerId,
        owner,
        id,
        () =>
          operation === "prepare"
            ? world.create(placed.id)
            : world.action(
                placed.id,
                shipmentId,
                operation === "cancel"
                  ? "cancel"
                  : operation === "refresh"
                    ? "refresh"
                    : "reconcile",
              ),
        action === "disable" ? "disable" : "revoke",
      );
      expect(raced.revocationError).toBeUndefined();
      if (operation === "prepare") {
        expect(raced.result.status).toBe(409);
        expect(raced.result.body).toMatchObject({
          code: "rule_violation",
          rule: "provider_not_enabled",
        });
      } else {
        expect(raced.result.status).toBe(200);
      }
      await activate(await version(KEY_B));
    },
  );
  it("binds before the first waybill call and retains A after rotation and disable", async () => {
    const placed = await paid();
    a = await version(KEY_A);
    await activate(a); // Cold version: authorization must also see the committed binding.
    creatingOrder = placed.id;
    const shipment = await world.created(placed.id);
    creatingOrder = undefined;
    expect(bindingsAtHttpStart).toEqual([a, a]);
    expect(observedBinding).toBe(a);
    const b = await version(KEY_B);
    await activate(b);
    calls.length = 0;
    expect((await world.action(placed.id, shipment.id, "refresh")).status).toBe(200);
    expect((await world.label(placed.id, shipment.id)).status).toBe(200);
    expect(calls.every((call) => call.key === KEY_A)).toBe(true);
    const waiting = await paid();
    await world.pool.query(
      "update integration_credential_version set state='draining' where id=$1",
      [b],
    );
    await world.pool.query("update integration set enabled=false where id=$1", [owner]);
    await world.pool.query("update integration_revision set revision=revision+1");
    expect(await world.orders.owner.app.get(ShippingProviders).active()).toEqual([]);
    const before = calls.length;
    expect((await world.create(waiting.id)).status).toBe(409);
    expect(calls).toHaveLength(before);
    expect(await world.shipmentRows(waiting.id)).toEqual([]);
    expect((await world.action(placed.id, shipment.id, "cancel")).status).toBe(200);
    expect(calls.at(-1)?.key).toBe(KEY_A);
    await activate(b);
  });
  it("refuses sender profile edits while shipments still depend on it", async () => {
    const placed = await paid();
    await world.created(placed.id);
    const result = await http<{ rule: string }>(
      world.orders.owner.baseUrl,
      "PUT",
      "/admin/shipping/providers/testship/settings",
      {
        body: {
          settings: {
            senderName: "Changed Sender",
            senderPhone: "380501234567",
            senderDivisionId: 123,
            payerDefault: "Recipient",
            defaultParcel: { weightGrams: 500, lengthMm: 200, widthMm: 150, heightMm: 100 },
          },
        },
      },
    );
    expect(result.status).toBe(409);
    expect(result.body.rule).toBe("shipping_profile_work_open");
  });
  it("isolates directory positive, negative and single-flight caches across versions and environments", async () => {
    const source = world.orders.owner.app.get(ShippingProviders),
      directory = world.orders.owner.app.get(ShippingDirectoryService);
    const pa = await source.get("testship");
    if (!pa) throw new Error("missing_test_port");
    const estimateQuery: EstimateQuery = {
      providerCode: "testship",
      methodCode: "cache_test",
      service: null,
      cityRef: "123",
      pickupPointRef: "test-city-kyiv-point-1",
      subtotal: { amount: 100, currency: "UAH" },
    };
    expect((await directory.estimate(pa, estimateQuery))?.amount).toBe(200);
    await directory.searchCities(pa, "empty", "en");
    await directory.resolvePickupPoint(pa, "test-city-kyiv-point-1");
    expect((await directory.resolvePickupPoint(pa, "missing-point")).status).toBe("unknown");
    const b = await version(KEY_A, "production");
    await activate(b);
    const pb = await source.get("testship");
    if (!pb) throw new Error("missing_test_port");
    calls.length = 0;
    expect((await directory.estimate(pb, estimateQuery))?.amount).toBe(100);
    const [point] = await Promise.all([
      directory.resolvePickupPoint(pb, "test-city-kyiv-point-1"),
      directory.resolvePickupPoint(pb, "test-city-kyiv-point-1"),
    ]);
    expect((await directory.resolvePickupPoint(pb, "missing-point")).status).toBe("unknown");
    await Promise.all([
      directory.searchCities(pb, "empty", "en"),
      directory.searchCities(pb, "empty", "en"),
    ]);
    expect(calls.filter((call) => call.operation === "findPickupPoint")).toHaveLength(2);
    expect(calls.filter((call) => call.operation === "searchCities")).toHaveLength(1);
    expect(point?.status).toBe("found");
    expect(calls.filter((call) => call.operation === "authorization")).toHaveLength(1);
    expect(calls.every((call) => call.environment === "production")).toBe(true);
    await activate(b);
  });
  it("uses the caller transaction for availability, bound lookup and export metadata", async () => {
    const source = world.orders.owner.app.get(ShippingProviders),
      db = world.orders.db;
    for (const op of ["active", "bound", "metadata", "admit"]) {
      const pending = db.transaction(async (tx) => {
        await tx.execute(sql`set local search_path = pg_catalog`);
        if (op === "active") return source.available(tx);
        if (op === "admit") return source.admit(tx, "testship");
        if (op === "bound")
          return source.forShipment(
            { providerCode: "testship", integrationCredentialVersionId: a },
            tx,
          );
        return source.processorCodes(tx);
      });
      await expect(pending.then(() => undefined, findPostgresError)).resolves.toMatchObject({
        code: "42P01",
      });
    }
  });
  it("rolls back availability timeout to a savepoint and commits the caller's writes", async () => {
    const source = world.orders.owner.app.get(ShippingProviders),
      db = world.orders.db;
    const blocker = await world.pool.connect();
    await blocker.query("begin");
    await blocker.query("lock table integration_revision in access exclusive mode");
    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout='20ms'`);
        expect(await source.available(tx)).toEqual([]);
        return (await tx.execute(sql`select 42 as committed`)).rows;
      });
      expect(result).toEqual([{ committed: 42 }]);
    } finally {
      await blocker.query("rollback");
      blocker.release();
    }
  });
  it("exports retained processor metadata without decrypting unavailable credentials", async () => {
    const app = await startApp({
      shippingDelegated: true,
      integrationProvidersDir: fixture.dir,
    });
    try {
      await expect(app.app.get(ShippingProviders).active()).rejects.toMatchObject({
        code: "service_unavailable",
      });
      expect(await app.app.get(PersonalDataReader).processors(world.orders.db)).toContainEqual({
        kind: "shipping",
        name: "testship",
      });
    } finally {
      await app.app.close();
    }
  });
  it("uses one provider snapshot when rotation occurs during an options request", async () => {
    const first = await version(KEY_A);
    await activate(first);
    const directory = world.orders.owner.app.get(ShippingDirectoryService);
    const shopper = new Shopper(world.orders.owner.baseUrl);
    const { variantId } = await world.orders.catalog.simple({ price: 1000, onHand: 5 });
    expect((await shopper.post("/store/cart/items", { variantId, quantity: 1 })).status).toBe(200);
    let ready: () => void = () => {
      throw new Error("barrier_not_ready");
    };
    let resume: () => void = () => {
      throw new Error("barrier_not_ready");
    };
    const captured = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const release = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const original = directory.providers.bind(directory);
    // A barrier around the real read: no fabricated provider or DB response.
    const probe = vi.spyOn(directory, "providers").mockImplementationOnce(async (executor) => {
      const snapshot = await original(executor);
      ready();
      await release;
      return snapshot;
    });
    try {
      const response = shopper.get(
        "/store/shipping/options?country=UA&pickupPointRef=test-city-kyiv-point-1",
      );
      await captured;
      const second = await version(KEY_B, "production");
      await activate(second);
      calls.length = 0;
      resume();
      expect((await response).status).toBe(200);
      expect(calls).toEqual([]);
    } finally {
      resume();
      probe.mockRestore();
    }
  });
  it.each(["disable", "revoke"])(
    "refuses directory work queued before %s without another transport start",
    async (action) => {
      const id = await version(KEY_A);
      await activate(id);
      const source = world.orders.owner.app.get(ShippingProviders),
        directory = world.orders.owner.app.get(ShippingDirectoryService);
      const port = await source.get("testship");
      if (!port) throw new Error("missing_port");
      await port.checkConnection(new AbortController().signal);
      holdCities = [];
      const started = new Promise<void>((resolve) => {
        citiesStarted = resolve;
      });
      const running = ["one", "two", "three"].map((query) =>
        directory.searchCities(port, query, "en"),
      );
      await started;
      const queued = directory.searchCities(port, "queued", "en");
      const refused = expect(queued).rejects.toBeDefined();
      expect(directory.gateState("testship").queued).toBe(1);
      await world.pool.query(
        "update integration_credential_version set state=$2,revoked_at=$3 where id=$1",
        [
          id,
          action === "disable" ? "draining" : "revoked",
          action === "revoke" ? new Date() : null,
        ],
      );
      await world.pool.query(
        "update integration set enabled=false,active_outbound_version_id=$2 where id=$1",
        [owner, action === "disable" ? id : null],
      );
      await world.pool.query("update integration_revision set revision=revision+1");
      const count = calls.length;
      const releases = holdCities;
      holdCities = undefined;
      releases.forEach((release) => release());
      await Promise.all(running);
      await refused;
      expect(calls).toHaveLength(count);
      await activate(await version(KEY_B));
    },
  );
  it("reconciles an unknown waybill with its original key after rotation", async () => {
    const first = await version(KEY_A);
    await activate(first);
    const placed = await paid();
    fixture.shipping.backend.failWaybill("createWaybill", {
      afterEffect: true,
      message: "test_lost_response",
    });
    const created = await world.create(placed.id);
    expect(created.status).toBe(201);
    expect(created.body.shipment.status).toBe("unknown");
    await activate(await version(KEY_B));
    calls.length = 0;
    const answer = await world.action(placed.id, created.body.shipment.id, "reconcile");
    expect(answer.status).toBe(200);
    expect(answer.body.status).toBe("created");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.key === KEY_A)).toBe(true);
    expect(calls.filter((call) => call.operation === "findWaybill")).toHaveLength(1);
  });
  it("refuses null-bound legacy operations with credential_unavailable and backs their tracking group off", async () => {
    const placed = await world.paid("address_no_carrier");
    const id = randomUUID();
    await world.pool.query(
      "insert into shipment(id,order_id,provider_code,status,client_reference,declared_value_amount,currency,payer,weight_grams,length_mm,width_mm,height_mm,seats,provider_ref,tracking_number,next_track_at) values($1,$2,'testship','created',$3,100,'UAH','sender',1,1,1,1,1,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','999000',now()-interval '1 minute')",
      [id, placed.id, placed.number],
    );
    const before = calls.length;
    expect((await world.action(placed.id, id, "refresh")).body.rule).toBe("credential_unavailable");
    expect((await world.action(placed.id, id, "cancel")).body.rule).toBe("credential_unavailable");
    expect(
      (
        await trackShipments(
          { tracking: world.orders.owner.app.get(ShipmentTrackingService) },
          new Date(),
        )
      ).providerFailures,
    ).toBe(1);
    expect(calls).toHaveLength(before);
    await world.pool.query("delete from shipment where id=$1", [id]);
  });
  it("splits env-mode legacy-null and retained managed groups for the same carrier", async () => {
    const va = await version(KEY_A);
    await activate(va);
    const first = await paid();
    const sa = await world.created(first.id);
    await activate(await version(KEY_B));
    const second = await paid();
    const sb = await world.created(second.id);
    const legacy = await world.paid("address_no_carrier"),
      id = randomUUID();
    await world.pool.query(
      "insert into shipment(id,order_id,provider_code,status,client_reference,declared_value_amount,currency,payer,weight_grams,length_mm,width_mm,height_mm,seats,provider_ref,tracking_number) values($1,$2,'testship','created',$3,100,'UAH','sender',1,1,1,1,1,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','999001')",
      [id, legacy.id, legacy.number],
    );
    await world.pool.query(
      "update shipment set next_track_at=now()-interval '1 minute' where id=ANY($1::uuid[])",
      [[sa.id, sb.id, id]],
    );
    const env = await startApp({
      shippingDelegated: false,
      secretsKeyRing: ring,
      integrationProvidersDir: fixture.dir,
      extraShippingProviders: fixture.shipping.envProviders(),
    });
    try {
      calls.length = 0;
      const result = await trackShipments(
        { tracking: env.app.get(ShipmentTrackingService) },
        new Date(),
      );
      expect(result.scanned).toBe(3);
      expect(result.providerFailures).toBe(0);
      const polls = calls.filter((call) => call.operation === "track");
      expect(polls.map((call) => call.key).sort()).toEqual(
        [KEY_A, KEY_B, "invented-env-shipping-key"].sort(),
      );
      expect(polls.every((call) => call.numbers.length === 1)).toBe(true);
    } finally {
      await env.app.close();
    }
    await world.pool.query("delete from shipment where id=$1", [id]);
  });
  it("splits tracking by version and backs off a revoked group without starving another", async () => {
    await activate(a);
    const first = await paid();
    const sa = await world.created(first.id);
    const b = await version(KEY_B, "production");
    await activate(b);
    const second = await paid();
    const sb = await world.created(second.id);
    await world.pool.query(
      "update shipment set next_track_at=now()-interval '1 minute' where id=ANY($1::uuid[])",
      [[sa.id, sb.id]],
    );
    calls.length = 0;
    const tracking = world.orders.owner.app.get(ShipmentTrackingService);
    await trackShipments({ tracking }, new Date());
    const polls = calls.filter((call) => call.operation === "track");
    expect(polls.map((call) => call.key).sort()).toEqual([KEY_A, KEY_B]);
    expect(polls.every((call) => call.numbers.length === 1)).toBe(true);
    const retained = await world.orders.owner.app
      .get(ShippingProviders)
      .forShipment({ providerCode: "testship", integrationCredentialVersionId: a });
    if (!retained) throw new Error("missing_retained_client");
    await world.pool.query(
      "update integration_credential_version set state='revoked',revoked_at=now() where id=$1",
      [a],
    );
    await world.pool.query(
      "update shipment set next_track_at=now()-interval '1 minute' where id=ANY($1::uuid[])",
      [[sa.id, sb.id]],
    );
    calls.length = 0;
    const result = await trackShipments({ tracking }, new Date());
    expect(result.providerFailures).toBe(1);
    expect(calls.filter((call) => call.operation === "track").map((call) => call.key)).toEqual([
      KEY_B,
    ]);
    expect((await world.label(first.id, sa.id)).status).toBeGreaterThanOrEqual(400);
    expect((await world.action(first.id, sa.id, "cancel")).status).toBeGreaterThanOrEqual(400);
    expect(calls.every((call) => call.key !== KEY_A)).toBe(true);
    const count = calls.length;
    const signal = () => new AbortController().signal;
    for (const lookup of [
      () => retained.searchCities({ query: "Test", locale: "en", limit: 10 }, signal()),
      () => retained.listPickupPoints({ cityRef: "123", kinds: ["branch"] }, signal()),
      () => retained.findPickupPoint({ ref: "test-city-kyiv-point-1" }, signal()),
    ])
      await expect(lookup()).rejects.toMatchObject({ codes: ["credential_revoked"] });
    const settings = {
      senderName: "Test Sender",
      senderPhone: "380501234567",
      senderDivisionId: 123,
      payerDefault: "Recipient",
      defaultParcel: { weightGrams: 500, lengthMm: 200, widthMm: 150, heightMm: 100 },
    };
    const request: WaybillRequest = {
      clientReference: "ABCD-EF01",
      service: null,
      payer: "recipient",
      declaredValue: { amount: 100, currency: "UAH" },
      parcel: { weightGrams: 500, lengthMm: 200, widthMm: 150, heightMm: 100, seats: 1 },
      description: "Test parcel",
      recipient: { firstName: "Test", lastName: "Recipient", phone: "380501234567" },
      destination: {
        kind: "pickup_point",
        cityRef: "123",
        pickupPointRef: "test-city-kyiv-point-1",
      },
      settings,
    };
    for (const operation of [
      () => retained.checkConnection(signal()),
      () => retained.createWaybill(request, signal()),
      () =>
        retained.findWaybill(
          {
            clientReference: "ABCD-EF01",
            createdAfter: new Date(0).toISOString(),
            createdBefore: new Date().toISOString(),
          },
          signal(),
        ),
      () =>
        retained.cancelWaybill({ providerRef: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }, signal()),
      () => retained.track({ trackingNumbers: ["100001"], phones: [] }, signal()),
      () =>
        retained.fetchLabel(
          {
            providerRef: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            trackingNumber: "100001",
            format: "pdf",
          },
          signal(),
        ),
      () =>
        retained.estimate(
          {
            service: null,
            destination: {
              kind: "pickup_point",
              cityRef: "123",
              pickupPointRef: "test-city-kyiv-point-1",
            },
            declaredValue: { amount: 100, currency: "UAH" },
            parcel: null,
            settings,
          },
          signal(),
        ),
    ])
      await expect(operation()).resolves.toMatchObject({
        ok: false,
        reason: "unavailable",
        providerCodes: expect.arrayContaining(["credential_revoked"]),
      });
    expect(calls).toHaveLength(count);
  });
});
