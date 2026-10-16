import pg from "pg";
import { expect } from "vitest";
import type { ProductDetailResponse } from "../catalog/admin/products/products.schemas.js";
import type { Call, CatalogFixture } from "./catalog-fixtures.js";
import { priceProductVariants } from "./pricing-fixtures.js";

export interface StockedVariant {
  productId: string;
  variantId: string;
}

export interface StockOptions {
  /** Units received at the default location before the test starts (a journal `receipt`). Default 0: no level row. */
  onHand?: number;
  trackInventory?: boolean;
  allowBackorder?: boolean;
  /** Publish the product (default true). A draft product is not sellable. */
  publish?: boolean;
}

/** Builds products for reservation specs through the real admin API; only prices are written straight into the table. */
export class StockWorld {
  private counter = 0;

  constructor(
    private readonly call: Call,
    private readonly pool: pg.Pool,
    private readonly fx: CatalogFixture,
  ) {}

  async createProduct(): Promise<ProductDetailResponse> {
    this.counter += 1;
    const result = await this.call<ProductDetailResponse>("POST", "/admin/products", {
      productTypeId: this.fx.teeTypeId,
      title: {
        uk: `Резерв ${this.fx.runId} ${this.counter}`,
        en: `Reserve ${this.fx.runId} ${this.counter}`,
      },
      attributes: { [this.fx.materialAttributeCode]: "cotton" },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body;
  }

  async variant(options: StockOptions = {}): Promise<StockedVariant> {
    const product = await this.createProduct();
    const variantId = product.variants[0]?.id ?? "";
    if (options.publish !== false) {
      await priceProductVariants(this.pool, product.id);
      const published = await this.call("POST", `/admin/products/${product.id}/publish`);
      expect(published.status, JSON.stringify(published.body)).toBe(200);
    }
    const flags = {
      ...(options.trackInventory === undefined ? {} : { trackInventory: options.trackInventory }),
      ...(options.allowBackorder === undefined ? {} : { allowBackorder: options.allowBackorder }),
    };
    if (Object.keys(flags).length > 0) {
      const patched = await this.call(
        "PATCH",
        `/admin/products/${product.id}/variants/${variantId}`,
        flags,
      );
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    }
    if ((options.onHand ?? 0) > 0) {
      await this.receive({ productId: product.id, variantId }, options.onHand ?? 0);
    }
    return { productId: product.id, variantId };
  }

  async receive(target: StockedVariant, delta: number): Promise<void> {
    const result = await this.call(
      "POST",
      `/admin/products/${target.productId}/variants/${target.variantId}/inventory/adjustments`,
      { delta, kind: "receipt" },
    );
    expect(result.status, JSON.stringify(result.body)).toBe(201);
  }
}

export interface ReservationRowForTest {
  id: string;
  status: string;
  quantity: number;
  reference: string | null;
  location_id: string;
  expires_at: Date;
}

export async function reservationsOf(
  pool: pg.Pool,
  variantId: string,
): Promise<ReservationRowForTest[]> {
  const result = await pool.query(
    `select id, status, quantity, reference, location_id, expires_at
       from reservation where variant_id = $1 order by created_at, id`,
    [variantId],
  );
  return result.rows as ReservationRowForTest[];
}

/**
 * The invariants of a level that must hold after any interleaving (ADR 0011): units are never negative, reserved
 * equals the active reservations, and (without backorder) never exceeds on hand.
 */
export async function expectLevelInvariants(
  pool: pg.Pool,
  variantId: string,
  locationId: string,
  options: { allowBackorder?: boolean } = {},
): Promise<{ onHand: number; reserved: number }> {
  const level = await pool.query(
    "select on_hand, reserved from inventory_level where variant_id = $1 and location_id = $2",
    [variantId, locationId],
  );
  const row = level.rows[0] as { on_hand: number; reserved: number } | undefined;
  expect(row, "the level row exists").toBeDefined();
  const onHand = row?.on_hand ?? -1;
  const reserved = row?.reserved ?? -1;
  expect(onHand, "on_hand >= 0").toBeGreaterThanOrEqual(0);
  expect(reserved, "reserved >= 0").toBeGreaterThanOrEqual(0);
  if (options.allowBackorder !== true) {
    expect(reserved, "reserved <= on_hand").toBeLessThanOrEqual(onHand);
  }
  const active = await pool.query(
    `select coalesce(sum(quantity), 0)::int as held from reservation
      where variant_id = $1 and location_id = $2 and status = 'active'`,
    [variantId, locationId],
  );
  expect(reserved, "reserved equals the active reservations").toBe(
    (active.rows[0] as { held: number }).held,
  );
  return { onHand, reserved };
}
