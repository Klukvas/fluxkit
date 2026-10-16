import { MAX_ON_HAND } from "@fluxkit/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Page } from "../../common/pagination.js";
import type { ProblemBody } from "../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../test/app.js";
import {
  caller,
  createCatalogFixture,
  expectWaitsForProductLock,
  type Call,
  type CatalogFixture,
} from "../../test/catalog-fixtures.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { http } from "../../test/http.js";
import {
  defaultLocationId,
  expectJournalReplays,
  expectWaitsForLevelLock,
  insertAdminUserRow,
  insertLocation,
  levelCount,
  levelOf,
  movementsOf,
  ownerAuthenticator,
} from "../../test/inventory-fixtures.js";
import { ensureMigrated } from "../../test/migrate.js";
import { InventoryService } from "./inventory.service.js";
import type { ProductDetailResponse } from "../../catalog/admin/products/products.schemas.js";
import type {
  AdjustmentResponse,
  InventoryResponse,
  MovementResponse,
} from "./inventory.schemas.js";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("admin inventory API (real app, real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let running: RunningApp;
  let call: Call;
  let fx: CatalogFixture;
  let actorId = "";
  let mainId = "";
  let counter = 0;
  const extraLocationIds: string[] = [];

  function problem(result: { body: unknown }): ProblemBody {
    return result.body as ProblemBody;
  }

  async function createProduct(): Promise<ProductDetailResponse> {
    counter += 1;
    const result = await call<ProductDetailResponse>("POST", "/admin/products", {
      productTypeId: fx.teeTypeId,
      title: { uk: `Склад ${fx.runId} ${counter}`, en: `Stock ${fx.runId} ${counter}` },
      attributes: { [fx.materialAttributeCode]: "cotton" },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body;
  }

  /** A draft product and the id of its default variant. */
  async function newVariant(): Promise<{ productId: string; variantId: string }> {
    const product = await createProduct();
    return { productId: product.id, variantId: product.variants[0]?.id ?? "" };
  }

  const inventoryPath = (productId: string, variantId: string, tail = "") =>
    `/admin/products/${productId}/variants/${variantId}/inventory${tail}`;

  async function adjust(
    productId: string,
    variantId: string,
    body: unknown,
  ): Promise<{ status: number; body: AdjustmentResponse }> {
    return call<AdjustmentResponse>(
      "POST",
      inventoryPath(productId, variantId, "/adjustments"),
      body,
    );
  }

  async function receive(productId: string, variantId: string, delta: number) {
    const result = await adjust(productId, variantId, { delta, kind: "receipt" });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result;
  }

  async function setReserved(variantId: string, locationId: string, reserved: number) {
    await pool.query(
      "update inventory_level set reserved = $3 where variant_id = $1 and location_id = $2",
      [variantId, locationId, reserved],
    );
  }

  beforeAll(async () => {
    await ensureMigrated();
    actorId = await insertAdminUserRow(pool);
    running = await startApp({ adminAuthenticator: ownerAuthenticator(actorId) });
    call = caller(() => running.baseUrl);
    fx = await createCatalogFixture(call);
    mainId = await defaultLocationId(pool);
    for (const code of ["north", "south"]) {
      extraLocationIds.push(await insertLocation(pool, `${code}_${fx.runId}`));
    }
  });

  afterAll(async () => {
    await running.app.close();
    await fx.cleanup(pool);
    await pool.query("delete from location where id = any($1::uuid[])", [extraLocationIds]);
    await pool.query("delete from admin_user where id = $1", [actorId]);
    await pool.end();
  });

  describe("GET /admin/products/:id/variants/:variantId/inventory", () => {
    it("shows the flags and an empty list for a variant without levels, and creates no row", async () => {
      const { productId, variantId } = await newVariant();
      const result = await call<InventoryResponse>("GET", inventoryPath(productId, variantId));
      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        variantId,
        trackInventory: true,
        allowBackorder: false,
        levels: [],
        totalAvailable: 0,
      });
      expect(await levelCount(pool, variantId)).toBe(0);
      expect((await movementsOf(pool, variantId)).length).toBe(0);
    });

    it("shows on hand, reserved and available per location, and the total available", async () => {
      const { productId, variantId } = await newVariant();
      const [north, south] = extraLocationIds;
      await receive(productId, variantId, 10);
      await adjust(productId, variantId, { locationId: north, delta: 7, kind: "receipt" });
      await adjust(productId, variantId, { locationId: south, delta: 2, kind: "receipt" });
      await setReserved(variantId, mainId, 4);
      await setReserved(variantId, south ?? "", 2);
      await call("PATCH", `/admin/products/${productId}/variants/${variantId}`, {
        allowBackorder: true,
      });

      const result = await call<InventoryResponse>("GET", inventoryPath(productId, variantId));
      expect(result.status).toBe(200);
      expect(result.body.allowBackorder).toBe(true);
      expect(result.body.levels.map((level) => level.locationCode)).toEqual(
        [`main`, `north_${fx.runId}`, `south_${fx.runId}`].sort(),
      );
      const byCode = Object.fromEntries(
        result.body.levels.map((level) => [level.locationCode, level]),
      );
      expect(byCode["main"]).toEqual({
        locationId: mainId,
        locationCode: "main",
        onHand: 10,
        reserved: 4,
        available: 6,
      });
      expect(byCode[`south_${fx.runId}`]).toMatchObject({ onHand: 2, reserved: 2, available: 0 });
      expect(result.body.totalAvailable).toBe(6 + 7 + 0);
    });

    it("answers 404 for an unknown product, an unknown variant and a variant of another product", async () => {
      const a = await newVariant();
      const b = await newVariant();
      expect((await call("GET", inventoryPath(MISSING_ID, MISSING_ID))).status).toBe(404);
      expect((await call("GET", inventoryPath(a.productId, MISSING_ID))).status).toBe(404);
      const foreign = await call<ProblemBody>("GET", inventoryPath(a.productId, b.variantId));
      expect(foreign.status).toBe(404);
      expect(foreign.body).toMatchObject({ code: "not_found" });
    });

    it("answers 400 for a malformed id", async () => {
      const result = await call<ProblemBody>("GET", inventoryPath("not-a-uuid", MISSING_ID));
      expect(result.status).toBe(400);
      expect(result.body.errors).toContainEqual(expect.objectContaining({ path: "id" }));
    });
  });

  describe("POST .../inventory/adjustments", () => {
    it("creates the level on the first receipt at the default location and journals it with the actor", async () => {
      const { productId, variantId } = await newVariant();
      expect(await levelCount(pool, variantId)).toBe(0);
      const result = await adjust(productId, variantId, {
        delta: 12,
        kind: "receipt",
        reason: "  First delivery ",
        reference: "PO-1",
      });
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      expect(result.body.level).toEqual({
        locationId: mainId,
        locationCode: "main",
        onHand: 12,
        reserved: 0,
        available: 12,
      });
      expect(result.body.movement).toMatchObject({
        variantId,
        locationId: mainId,
        locationCode: "main",
        kind: "receipt",
        delta: 12,
        onHandAfter: 12,
        reason: "First delivery",
        reference: "PO-1",
        actorId,
      });
      expect(result.body.movement.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 12, reserved: 0 });
      expect(await movementsOf(pool, variantId)).toEqual([
        {
          kind: "receipt",
          delta: 12,
          on_hand_after: 12,
          reason: "First delivery",
          reference: "PO-1",
          actor_id: actorId,
          location_id: mainId,
        },
      ]);
    });

    it("changes the level by delta or to an absolute value, and the journal replays", async () => {
      const { productId, variantId } = await newVariant();
      await receive(productId, variantId, 10);
      const shrink = await adjust(productId, variantId, {
        delta: -3,
        kind: "adjustment",
        reason: "damaged",
      });
      expect(shrink.status).toBe(201);
      expect(shrink.body.movement).toMatchObject({ kind: "adjustment", delta: -3, onHandAfter: 7 });
      const counted = await adjust(productId, variantId, { setOnHand: 20, kind: "adjustment" });
      expect(counted.body.movement).toMatchObject({ delta: 13, onHandAfter: 20 });
      const returned = await adjust(productId, variantId, { delta: 1, kind: "return" });
      expect(returned.body.movement).toMatchObject({ kind: "return", delta: 1, onHandAfter: 21 });
      const lowered = await adjust(productId, variantId, { setOnHand: 0, kind: "adjustment" });
      expect(lowered.body.movement).toMatchObject({ delta: -21, onHandAfter: 0 });

      const journal = await movementsOf(pool, variantId);
      expect(journal.map((row) => row.delta)).toEqual([10, -3, 13, 1, -21]);
      expectJournalReplays(journal, 0);
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 0, reserved: 0 });
    });

    it("keeps one level per location and an explicit locationId wins over the default", async () => {
      const { productId, variantId } = await newVariant();
      const [north] = extraLocationIds;
      const result = await adjust(productId, variantId, {
        locationId: north,
        delta: 5,
        kind: "receipt",
      });
      expect(result.status).toBe(201);
      expect(result.body.level.locationId).toBe(north);
      expect(result.body.level.locationCode).toBe(`north_${fx.runId}`);
      expect(await levelOf(pool, variantId, mainId)).toBeUndefined();
      expect(await levelOf(pool, variantId, north ?? "")).toEqual({ on_hand: 5, reserved: 0 });
    });

    it("works for a variant that is not tracked", async () => {
      const { productId, variantId } = await newVariant();
      await call("PATCH", `/admin/products/${productId}/variants/${variantId}`, {
        trackInventory: false,
      });
      const result = await adjust(productId, variantId, { delta: 3, kind: "receipt" });
      expect(result.status, JSON.stringify(result.body)).toBe(201);
    });

    it("stores an empty reason or reference as null", async () => {
      const { productId, variantId } = await newVariant();
      const result = await adjust(productId, variantId, {
        delta: 1,
        kind: "receipt",
        reason: "",
        reference: null,
      });
      expect(result.status).toBe(201);
      expect(result.body.movement).toMatchObject({ reason: null, reference: null });
    });

    describe("refusals of the core stock rules", () => {
      /** 3 on hand, 2 of them reserved, so an adjustment can run into the floor, the reservation and the ceiling. */
      async function withReserved() {
        const ids = await newVariant();
        await receive(ids.productId, ids.variantId, 3);
        await setReserved(ids.variantId, mainId, 2);
        return ids;
      }

      it.each([
        ["a fractional delta", { delta: 1.5, kind: "receipt" }, "delta", "invalid_quantity"],
        [
          "a fractional setOnHand",
          { setOnHand: 2.5, kind: "adjustment" },
          "setOnHand",
          "invalid_quantity",
        ],
        [
          "a delta beyond the safe integers",
          { delta: 1e300, kind: "receipt" },
          "delta",
          "invalid_quantity",
        ],
        [
          "a delta that pushes on hand above the maximum",
          { delta: MAX_ON_HAND, kind: "receipt" },
          "delta",
          "on_hand_out_of_range",
        ],
        [
          "a setOnHand above the maximum",
          { setOnHand: MAX_ON_HAND + 1, kind: "adjustment" },
          "setOnHand",
          "on_hand_out_of_range",
        ],
      ])("answers 400 validation_failed for %s", async (_name, body, path, code) => {
        const { productId, variantId } = await withReserved();
        const result = await adjust(productId, variantId, body);
        expect(result.status, JSON.stringify(result.body)).toBe(400);
        expect(problem(result)).toMatchObject({ code: "validation_failed" });
        expect(problem(result).errors).toContainEqual(expect.objectContaining({ path, code }));
        expect(await movementsOf(pool, variantId)).toHaveLength(1);
      });

      it.each([
        ["a delta below zero on hand", { delta: -4, kind: "adjustment" }, "negative_on_hand"],
        ["a negative setOnHand", { setOnHand: -1, kind: "adjustment" }, "negative_on_hand"],
        ["a delta below the reserved units", { delta: -2, kind: "adjustment" }, "below_reserved"],
        [
          "a setOnHand below the reserved units",
          { setOnHand: 1, kind: "adjustment" },
          "below_reserved",
        ],
        ["a delta of zero", { delta: 0, kind: "adjustment" }, "no_change"],
        ["a setOnHand equal to on hand", { setOnHand: 3, kind: "adjustment" }, "no_change"],
        [
          "a receipt with a negative delta",
          { delta: -1, kind: "receipt" },
          "kind_requires_increase",
        ],
        [
          "a return that lowers on hand",
          { setOnHand: 2, kind: "return" },
          "kind_requires_increase",
        ],
      ])("answers 409 rule_violation for %s", async (_name, body, rule) => {
        const { productId, variantId } = await withReserved();
        const result = await adjust(productId, variantId, body);
        expect(result.status, JSON.stringify(result.body)).toBe(409);
        expect(problem(result)).toMatchObject({ code: "rule_violation", rule });
        expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 3, reserved: 2 });
        expect(await movementsOf(pool, variantId)).toHaveLength(1);
      });

      it("creates neither a level nor a movement when the first adjustment is refused", async () => {
        const { productId, variantId } = await newVariant();
        const result = await adjust(productId, variantId, { delta: -1, kind: "adjustment" });
        expect(result.status).toBe(409);
        expect(problem(result)).toMatchObject({ rule: "negative_on_hand" });
        expect(await levelCount(pool, variantId)).toBe(0);
        expect(await movementsOf(pool, variantId)).toHaveLength(0);
      });
    });

    describe("request validation", () => {
      it.each([
        ["neither delta nor setOnHand", { kind: "receipt" }],
        ["both delta and setOnHand", { delta: 1, setOnHand: 1, kind: "adjustment" }],
        ["a missing kind", { delta: 1 }],
        ["the sale kind (only a reservation commit sells)", { delta: -1, kind: "sale" }],
        ["an unknown kind", { delta: 1, kind: "gift" }],
        ["an unknown field", { delta: 1, kind: "receipt", onHand: 1 }],
        ["a delta as a string", { delta: "1", kind: "receipt" }],
        ["a malformed locationId", { delta: 1, kind: "receipt", locationId: "x" }],
        ["a reason that is too long", { delta: 1, kind: "receipt", reason: "x".repeat(501) }],
        ["a reference that is too long", { delta: 1, kind: "receipt", reference: "x".repeat(256) }],
        ["a reason with a NUL character", { delta: 1, kind: "receipt", reason: "a\u0000b" }],
        ["an array body", [{ delta: 1, kind: "receipt" }]],
      ])("answers 400 for %s and writes nothing", async (_name, body) => {
        const { productId, variantId } = await newVariant();
        const result = await adjust(productId, variantId, body);
        expect(result.status, JSON.stringify(result.body)).toBe(400);
        expect(problem(result)).toMatchObject({ code: "validation_failed" });
        expect(await levelCount(pool, variantId)).toBe(0);
      });

      it("names the field for the delta/setOnHand rule and for the kind", async () => {
        const { productId, variantId } = await newVariant();
        const both = await adjust(productId, variantId, { delta: 1, setOnHand: 1, kind: "return" });
        expect(problem(both).errors).toContainEqual(
          expect.objectContaining({ code: "delta_or_set_on_hand" }),
        );
        const sale = await adjust(productId, variantId, { delta: 1, kind: "sale" });
        expect(problem(sale).errors).toContainEqual(
          expect.objectContaining({ path: "kind", code: "invalid_value" }),
        );
      });

      it("answers 400 invalid_reference for an unknown location", async () => {
        const { productId, variantId } = await newVariant();
        const result = await adjust(productId, variantId, {
          delta: 1,
          kind: "receipt",
          locationId: MISSING_ID,
        });
        expect(result.status).toBe(400);
        expect(problem(result).errors).toContainEqual(
          expect.objectContaining({ path: "locationId", code: "invalid_reference" }),
        );
        expect(await levelCount(pool, variantId)).toBe(0);
      });

      it("answers 404 for an unknown product, an unknown variant and a variant of another product", async () => {
        const a = await newVariant();
        const b = await newVariant();
        const body = { delta: 1, kind: "receipt" };
        expect((await adjust(MISSING_ID, MISSING_ID, body)).status).toBe(404);
        expect((await adjust(a.productId, MISSING_ID, body)).status).toBe(404);
        expect((await adjust(a.productId, b.variantId, body)).status).toBe(404);
        expect(await levelCount(pool, b.variantId)).toBe(0);
      });
    });

    it("keeps the actor out of the request: a body cannot set actorId", async () => {
      const { productId, variantId } = await newVariant();
      const result = await adjust(productId, variantId, {
        delta: 1,
        kind: "receipt",
        actorId: MISSING_ID,
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toContainEqual(
        expect.objectContaining({ path: "actorId", code: "unknown_field" }),
      );
    });

    it("journals a system change (no admin user, as the demo seed makes) with a null actor", async () => {
      const { productId, variantId } = await newVariant();
      const service = running.app.get(InventoryService, { strict: false });
      const result = await service.adjust(
        productId,
        variantId,
        { delta: 6, kind: "receipt", reason: "System change" },
        null,
      );
      expect(result.movement.actorId).toBeNull();
      const journal = await movementsOf(pool, variantId);
      expect(journal).toHaveLength(1);
      expect(journal[0]).toMatchObject({ delta: 6, on_hand_after: 6, actor_id: null });
    });

    it("keeps the journal row when the acting admin user is deleted later, without the actor", async () => {
      const leaverId = await insertAdminUserRow(pool);
      const leaver = await startApp({ adminAuthenticator: ownerAuthenticator(leaverId) });
      try {
        const { productId, variantId } = await newVariant();
        const result = await http<AdjustmentResponse>(
          leaver.baseUrl,
          "POST",
          inventoryPath(productId, variantId, "/adjustments"),
          { body: { delta: 4, kind: "receipt" } },
        );
        expect(result.status).toBe(201);
        expect(result.body.movement.actorId).toBe(leaverId);
        await pool.query("delete from admin_user where id = $1", [leaverId]);
        const journal = await movementsOf(pool, variantId);
        expect(journal).toHaveLength(1);
        expect(journal[0]).toMatchObject({ delta: 4, actor_id: null });
      } finally {
        await leaver.app.close();
      }
    });
  });

  describe("GET .../inventory/movements", () => {
    it("lists the journal newest first with every field, and only this variant's rows", async () => {
      const { productId, variantId } = await newVariant();
      const other = await newVariant();
      await receive(other.productId, other.variantId, 99);
      await adjust(productId, variantId, { delta: 5, kind: "receipt", reference: "PO-7" });
      await adjust(productId, variantId, {
        delta: -2,
        kind: "adjustment",
        reason: "lost",
      });
      const result = await call<Page<MovementResponse>>(
        "GET",
        inventoryPath(productId, variantId, "/movements"),
      );
      expect(result.status).toBe(200);
      expect(result.body.total).toBe(2);
      expect(result.body.items.map((item) => item.delta)).toEqual([-2, 5]);
      expect(result.body.items[0]).toEqual({
        id: expect.any(String),
        variantId,
        locationId: mainId,
        locationCode: "main",
        kind: "adjustment",
        delta: -2,
        onHandAfter: 3,
        reason: "lost",
        reference: null,
        actorId,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
      expect(result.body.items[1]).toMatchObject({ reference: "PO-7", reason: null });
    });

    it("paginates with limit and offset, defaults to 50 and rejects bad paging", async () => {
      const { productId, variantId } = await newVariant();
      for (let step = 1; step <= 5; step += 1) {
        await receive(productId, variantId, step);
      }
      const path = inventoryPath(productId, variantId, "/movements");
      const first = await call<Page<MovementResponse>>("GET", `${path}?limit=2`);
      expect(first.body).toMatchObject({ total: 5, limit: 2, offset: 0 });
      expect(first.body.items.map((item) => item.delta)).toEqual([5, 4]);
      const second = await call<Page<MovementResponse>>("GET", `${path}?limit=2&offset=2`);
      expect(second.body.items.map((item) => item.delta)).toEqual([3, 2]);
      const last = await call<Page<MovementResponse>>("GET", `${path}?limit=2&offset=4`);
      expect(last.body.items.map((item) => item.delta)).toEqual([1]);
      const all = await call<Page<MovementResponse>>("GET", path);
      expect(all.body).toMatchObject({ total: 5, limit: 50, offset: 0 });
      for (const query of ["?limit=0", "?limit=101", "?offset=-1", "?limit=x"]) {
        expect((await call("GET", `${path}${query}`)).status, query).toBe(400);
      }
    });

    it("is empty for a variant with no movements and 404 for unknown ids", async () => {
      const { productId, variantId } = await newVariant();
      const empty = await call<Page<MovementResponse>>(
        "GET",
        inventoryPath(productId, variantId, "/movements"),
      );
      expect(empty.body).toMatchObject({ items: [], total: 0 });
      expect((await call("GET", inventoryPath(productId, MISSING_ID, "/movements"))).status).toBe(
        404,
      );
      expect((await call("GET", inventoryPath(MISSING_ID, variantId, "/movements"))).status).toBe(
        404,
      );
    });
  });

  describe("locking", () => {
    it("waits for the inventory_level row lock", async () => {
      const { productId, variantId } = await newVariant();
      await receive(productId, variantId, 5);
      await expectWaitsForLevelLock(
        pool,
        variantId,
        mainId,
        () => adjust(productId, variantId, { delta: 1, kind: "receipt" }),
        (result) => expect(result.status).toBe(201),
      );
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 6, reserved: 0 });
    });

    it("reads the level with SELECT ... FOR UPDATE, after the product lock (statement order)", async () => {
      // The product lock and a plain UPDATE would also make a competing request wait, so the wait test above cannot
      // tell a missing FOR UPDATE; the reservation specs prove it by outcome (no lock, two buyers of the last unit).
      const { productId, variantId } = await newVariant();
      await receive(productId, variantId, 5);
      const spy = vi.spyOn(pg.Client.prototype, "query");
      try {
        await adjust(productId, variantId, { delta: 1, kind: "receipt" });
        const texts = spy.mock.calls.map((args) => {
          const first = args[0] as unknown;
          return typeof first === "string"
            ? first
            : typeof first === "object" && first !== null && "text" in first
              ? String((first as { text: unknown }).text)
              : "";
        });
        const productLock = texts.findIndex((text) => /from "product".*for update/is.test(text));
        const levelLock = texts.findIndex((text) =>
          /from "inventory_level".*for update/is.test(text),
        );
        const movementInsert = texts.findIndex((text) =>
          /insert into "stock_movement"/i.test(text),
        );
        expect(productLock).toBeGreaterThanOrEqual(0);
        expect(levelLock).toBeGreaterThan(productLock);
        expect(movementInsert).toBeGreaterThan(levelLock);
        expect(texts.some((text) => /\b(update|delete from)\s+"stock_movement"/i.test(text))).toBe(
          false,
        );
      } finally {
        spy.mockRestore();
      }
    });

    it("waits for the product row lock too (the order is product, then level)", async () => {
      const { productId, variantId } = await newVariant();
      await expectWaitsForProductLock(
        pool,
        productId,
        () => adjust(productId, variantId, { delta: 1, kind: "receipt" }),
        201,
      );
    });
  });

  describe("concurrency (parallel requests, real transactions)", () => {
    it("keeps on hand equal to the sum of the movements under parallel adjustments", async () => {
      const { productId, variantId } = await newVariant();
      await receive(productId, variantId, 100);
      const deltas = Array.from({ length: 24 }, (_, index) => (index % 3 === 0 ? -2 : 3));
      const results = await Promise.all(
        deltas.map((delta) =>
          adjust(productId, variantId, { delta, kind: delta < 0 ? "adjustment" : "receipt" }),
        ),
      );
      for (const result of results) {
        expect(result.status, JSON.stringify(result.body)).toBe(201);
      }
      const expected = 100 + deltas.reduce((sum, delta) => sum + delta, 0);
      const level = await levelOf(pool, variantId, mainId);
      expect(level?.on_hand).toBe(expected);
      const journal = await movementsOf(pool, variantId);
      expect(journal).toHaveLength(25);
      expectJournalReplays(journal, expected);
    });

    it("creates one level row for parallel first-time receipts of a variant and location", async () => {
      const { productId, variantId } = await newVariant();
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          adjust(productId, variantId, { delta: 5, kind: "receipt" }),
        ),
      );
      for (const result of results) {
        expect(result.status, JSON.stringify(result.body)).toBe(201);
      }
      expect(await levelCount(pool, variantId)).toBe(1);
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 60, reserved: 0 });
      expectJournalReplays(await movementsOf(pool, variantId), 60);
    });

    it("refuses what no longer fits: 10 parallel removals of 1 from 5 units succeed exactly 5 times", async () => {
      const { productId, variantId } = await newVariant();
      await receive(productId, variantId, 5);
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          adjust(productId, variantId, { delta: -1, kind: "adjustment" }),
        ),
      );
      expect(results.filter((result) => result.status === 201)).toHaveLength(5);
      const refused = results.filter((result) => result.status === 409);
      expect(refused).toHaveLength(5);
      for (const result of refused) {
        expect(problem(result)).toMatchObject({ rule: "negative_on_hand" });
      }
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 0, reserved: 0 });
      expectJournalReplays(await movementsOf(pool, variantId), 0);
    });
  });

  describe("permissions", () => {
    it("lets a viewer read inventory and movements but not adjust, and requires the CSRF header", async () => {
      const { productId, variantId } = await newVariant();
      await receive(productId, variantId, 5);
      const viewer = await startApp({ adminPrincipal: { role: "viewer" } });
      try {
        const base = viewer.baseUrl;
        expect((await http(base, "GET", inventoryPath(productId, variantId))).status).toBe(200);
        expect(
          (await http(base, "GET", inventoryPath(productId, variantId, "/movements"))).status,
        ).toBe(200);
        const denied = await http<ProblemBody>(
          base,
          "POST",
          inventoryPath(productId, variantId, "/adjustments"),
          { body: { delta: 1, kind: "receipt" } },
        );
        expect(denied.status).toBe(403);
        expect(denied.body).toMatchObject({ code: "forbidden" });
      } finally {
        await viewer.app.close();
      }
      const noCsrf = await http<ProblemBody>(
        running.baseUrl,
        "POST",
        inventoryPath(productId, variantId, "/adjustments"),
        { body: { delta: 1, kind: "receipt" }, csrf: false },
      );
      expect(noCsrf.status).toBe(403);
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 5, reserved: 0 });
    });
  });

  describe("deleting a never-published product", () => {
    it("removes its levels, journal and reservations with it, without error", async () => {
      const { productId, variantId } = await newVariant();
      await receive(productId, variantId, 5);
      await pool.query(
        `insert into reservation (variant_id, location_id, quantity, status, expires_at)
         values ($1, $2, 1, 'active', now() + interval '1 hour')`,
        [variantId, mainId],
      );
      await setReserved(variantId, mainId, 1);
      // A draft product's only variant is also the default one; delete the product, which removes its variants.
      const deleted = await call("DELETE", `/admin/products/${productId}`);
      expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);
      for (const table of ["inventory_level", "stock_movement", "reservation"]) {
        const result = await pool.query(
          `select count(*)::int as count from ${table} where variant_id = $1`,
          [variantId],
        );
        expect((result.rows[0] as { count: number }).count, table).toBe(0);
      }
    });
  });
});
