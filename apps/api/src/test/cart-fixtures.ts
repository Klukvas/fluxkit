import { randomUUID } from "node:crypto";
import type pg from "pg";
import { defaultLocationId } from "./inventory-fixtures.js";

export interface CartTestProduct {
  id: string;
  slug: string;
}

export interface CartVariantOptions {
  /** Defaults to a unique SKU. */
  sku?: string;
  isActive?: boolean;
  /** Shop-currency (UAH) price in minor units; `null` makes a priceless variant. Default 1000. */
  price?: number | null;
  compareAt?: number;
  /** A price in another currency, stored next to (or instead of) the shop one. */
  otherCurrency?: { currency: string; amount: number };
  /** Default false: untracked, always in stock. */
  trackInventory?: boolean;
  allowBackorder?: boolean;
  onHand?: number;
  reserved?: number;
  title?: Record<string, string>;
  /** Makes the variant the red or blue one of a product that offers the colour option. */
  color?: "red" | "blue";
  isDefault?: boolean;
}

/**
 * TEST ONLY. Catalog rows for the cart specs, written straight into the tables (like the store spec does) so that the
 * cart specs do not depend on the admin endpoints. Everything is created with a unique run id and removed by `cleanup`.
 */
export class CartCatalog {
  readonly runId = randomUUID().slice(0, 8);
  private typeId = "";
  private digitalTypeId = "";
  private colorOptionId = "";
  private readonly colorValueIds = new Map<string, string>();
  private readonly productIds: string[] = [];
  private counter = 0;

  constructor(private readonly pool: pg.Pool) {}

  async init(): Promise<void> {
    this.typeId = await this.insert(
      "insert into product_type (code, name) values ($1, $2::jsonb) returning id",
      [`cart_type_${this.runId}`, JSON.stringify({ uk: "Тип", en: "Type" })],
    );
    this.digitalTypeId = await this.insert(
      "insert into product_type (code, name, requires_shipping) values ($1, $2::jsonb, false) returning id",
      [`cart_digital_${this.runId}`, JSON.stringify({ uk: "Цифровий", en: "Digital" })],
    );
    this.colorOptionId = await this.insert(
      "insert into option (code, name) values ($1, $2::jsonb) returning id",
      [`cart_color_${this.runId}`, JSON.stringify({ uk: "Колір", en: "Color" })],
    );
    for (const [code, label, position] of [
      ["red", { uk: "Червоний", en: "Red" }, 0],
      ["blue", { uk: "Синій" }, 1],
    ] as const) {
      this.colorValueIds.set(
        code,
        await this.insert(
          "insert into option_value (option_id, code, label, position) values ($1, $2, $3::jsonb, $4) returning id",
          [this.colorOptionId, code, JSON.stringify(label), position],
        ),
      );
    }
  }

  private async insert(statement: string, params: unknown[]): Promise<string> {
    const result = await this.pool.query<{ id: string }>(statement, params);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Test setup bug: the insert returned no row");
    }
    return row.id;
  }

  /** A product with the colour option chosen (red and blue offered) when `withColors`. */
  async product(
    options: {
      status?: "draft" | "active" | "archived";
      title?: Record<string, string>;
      withColors?: boolean;
      /** A product type that ships nothing (`requires_shipping = false`): the order needs no shipping address. */
      digital?: boolean;
    } = {},
  ): Promise<CartTestProduct> {
    this.counter += 1;
    const slug = `cart-p${this.counter}-${this.runId}`;
    const status = options.status ?? "active";
    const id = await this.insert(
      `insert into product (product_type_id, slug, title, status, published_at)
       values ($1, $2, $3::jsonb, $4, $5) returning id`,
      [
        options.digital === true ? this.digitalTypeId : this.typeId,
        slug,
        JSON.stringify(
          options.title ?? { uk: `Товар ${this.counter}`, en: `Product ${this.counter}` },
        ),
        status,
        status === "active" ? new Date() : null,
      ],
    );
    this.productIds.push(id);
    if (options.withColors === true) {
      await this.pool.query(
        "insert into product_option (product_id, option_id, position) values ($1, $2, 0)",
        [id, this.colorOptionId],
      );
      let position = 0;
      for (const valueId of this.colorValueIds.values()) {
        await this.pool.query(
          `insert into product_option_value (product_id, option_id, option_value_id, position)
           values ($1, $2, $3, $4)`,
          [id, this.colorOptionId, valueId, position],
        );
        position += 1;
      }
    }
    return { id, slug };
  }

  async variant(productId: string, options: CartVariantOptions = {}): Promise<string> {
    this.counter += 1;
    const sku = options.sku ?? `CART-${this.runId.toUpperCase()}-${this.counter}`;
    const signature =
      options.color === undefined ? "" : `cart_color_${this.runId}=${options.color}`;
    const variantId = await this.insert(
      `insert into variant (product_id, sku, title, option_signature, is_default, is_active,
                            track_inventory, allow_backorder, position)
       values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9) returning id`,
      [
        productId,
        sku,
        options.title === undefined ? null : JSON.stringify(options.title),
        signature,
        options.isDefault ?? options.color !== "blue",
        options.isActive ?? true,
        options.trackInventory ?? false,
        options.allowBackorder ?? false,
        this.counter,
      ],
    );
    if (options.color !== undefined) {
      await this.pool.query(
        `insert into variant_option_value (variant_id, product_id, option_id, option_value_id)
         values ($1, $2, $3, $4)`,
        [variantId, productId, this.colorOptionId, this.colorValueIds.get(options.color)],
      );
    }
    const price = options.price === undefined ? 1000 : options.price;
    if (price !== null) {
      await this.pool.query(
        "insert into price (variant_id, currency, amount, compare_at_amount) values ($1, 'UAH', $2, $3)",
        [variantId, price, options.compareAt ?? null],
      );
    }
    if (options.otherCurrency !== undefined) {
      await this.pool.query(
        "insert into price (variant_id, currency, amount) values ($1, $2, $3)",
        [variantId, options.otherCurrency.currency, options.otherCurrency.amount],
      );
    }
    if (options.onHand !== undefined) {
      await this.pool.query(
        "insert into inventory_level (variant_id, location_id, on_hand, reserved) values ($1, $2, $3, $4)",
        [variantId, await defaultLocationId(this.pool), options.onHand, options.reserved ?? 0],
      );
    }
    return variantId;
  }

  /** A product with one default variant: the common "simple product". */
  async simple(
    options: CartVariantOptions & {
      status?: "draft" | "active" | "archived";
      title?: Record<string, string>;
      digital?: boolean;
    } = {},
  ): Promise<{ productId: string; slug: string; variantId: string }> {
    const product = await this.product({
      status: options.status,
      title: options.title,
      digital: options.digital,
    });
    const variantId = await this.variant(product.id, { isDefault: true, ...options });
    return { productId: product.id, slug: product.slug, variantId };
  }

  async setPrice(
    variantId: string,
    amount: number,
    compareAt: number | null = null,
  ): Promise<void> {
    await this.pool.query(
      `insert into price (variant_id, currency, amount, compare_at_amount) values ($1, 'UAH', $2, $3)
       on conflict (variant_id, currency) do update set amount = $2, compare_at_amount = $3`,
      [variantId, amount, compareAt],
    );
  }

  async deletePrice(variantId: string): Promise<void> {
    await this.pool.query("delete from price where variant_id = $1 and currency = 'UAH'", [
      variantId,
    ]);
  }

  async setActive(variantId: string, isActive: boolean): Promise<void> {
    await this.pool.query("update variant set is_active = $2 where id = $1", [variantId, isActive]);
  }

  async setProductStatus(
    productId: string,
    status: "draft" | "active" | "archived",
  ): Promise<void> {
    await this.pool.query(
      "update product set status = $2, published_at = coalesce(published_at, now()) where id = $1",
      [productId, status],
    );
  }

  async setStock(variantId: string, onHand: number, reserved = 0): Promise<void> {
    const locationId = await defaultLocationId(this.pool);
    await this.pool.query(
      `insert into inventory_level (variant_id, location_id, on_hand, reserved) values ($1, $2, $3, $4)
       on conflict (variant_id, location_id) do update set on_hand = $3, reserved = $4`,
      [variantId, locationId, onHand, reserved],
    );
  }

  async media(
    productId: string,
    url: string,
    position: number,
    options: { color?: "red" | "blue"; alt?: Record<string, string> } = {},
  ): Promise<void> {
    await this.pool.query(
      `insert into media (product_id, option_id, option_value_id, url, alt, position)
       values ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        productId,
        options.color === undefined ? null : this.colorOptionId,
        options.color === undefined ? null : this.colorValueIds.get(options.color),
        url,
        options.alt === undefined ? null : JSON.stringify(options.alt),
        position,
      ],
    );
  }

  async cleanup(): Promise<void> {
    // Products first (cascade to variants, prices, levels, option rows, media and cart lines), then the dictionaries.
    await this.pool.query("delete from product where id = any($1::uuid[])", [this.productIds]);
    await this.pool.query("delete from product_type where id = any($1::uuid[])", [
      [this.typeId, this.digitalTypeId],
    ]);
    await this.pool.query("delete from option where id = $1", [this.colorOptionId]);
  }
}
