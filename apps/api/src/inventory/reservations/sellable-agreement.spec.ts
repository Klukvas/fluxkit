import { isVariantSellable, type ProductStatus } from "@fluxkit/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type RunningApp } from "../../test/app.js";
import { caller, createCatalogFixture, type CatalogFixture } from "../../test/catalog-fixtures.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { insertAdminUserRow, ownerAuthenticator } from "../../test/inventory-fixtures.js";
import { ensureMigrated } from "../../test/migrate.js";
import { priceProductVariants } from "../../test/pricing-fixtures.js";
import { StockWorld } from "../../test/stock-world.js";
import { ReservationsService } from "./reservations.service.js";

const HOUR = 3_600_000;

/**
 * R7: the store and `reserve` must agree with the one core rule `isVariantSellable` on every combination of product
 * status, variant activity and shop price. A product here has one variant (the default one), so the store shows the
 * product exactly when that variant is sellable.
 */
describe("isVariantSellable agrees with the store and with reserve (real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let running: RunningApp;
  let fx: CatalogFixture;
  let world: StockWorld;
  let service: ReservationsService;
  let actorId = "";

  beforeAll(async () => {
    await ensureMigrated();
    actorId = await insertAdminUserRow(pool);
    running = await startApp({ adminAuthenticator: ownerAuthenticator(actorId) });
    const call = caller(() => running.baseUrl);
    fx = await createCatalogFixture(call);
    world = new StockWorld(call, pool, fx);
    service = running.app.get(ReservationsService, { strict: false });
  });

  afterAll(async () => {
    await running.app.close();
    await fx.cleanup(pool);
    await pool.query("delete from admin_user where id = $1", [actorId]);
    await pool.end();
  });

  const statuses: ProductStatus[] = ["draft", "active", "archived"];

  it.each(
    statuses.flatMap((productStatus) =>
      [true, false].flatMap((variantIsActive) =>
        [true, false].map((hasShopPrice) => ({ productStatus, variantIsActive, hasShopPrice })),
      ),
    ),
  )("%j", async (facts) => {
    const call = caller(() => running.baseUrl);
    const product = await world.createProduct();
    const variantId = product.variants[0]?.id ?? "";
    await world.receive({ productId: product.id, variantId }, 5);
    // A price in another currency never makes a variant sellable.
    await priceProductVariants(pool, product.id, 1_000, facts.hasShopPrice ? "UAH" : "USD");
    await pool.query("update variant set is_active = $2 where id = $1", [
      variantId,
      facts.variantIsActive,
    ]);
    await pool.query(
      "update product set status = $2, published_at = case when $2 = 'draft' then null else now() end where id = $1",
      [product.id, facts.productStatus],
    );

    const expected = isVariantSellable(facts);
    const detail = await call("GET", `/store/products/${product.slug}`);
    expect(detail.status, "store detail").toBe(expected ? 200 : 404);
    const reserved = await service.reserve({
      variantId,
      quantity: 1,
      expiresAt: new Date(Date.now() + HOUR),
    });
    if (expected) {
      expect(reserved.ok, JSON.stringify(reserved)).toBe(true);
    } else {
      expect(reserved).toEqual({ ok: false, reason: "variant_not_sellable" });
    }
  });
});
