import { fileURLToPath } from "node:url";
import { getTableName, is } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../test/env.js";
import * as catalogSchema from "./schema/catalog.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Same value in every spec that needs the migrated schema: they run in parallel workers on one database. */
const SCHEMA_LOCK_KEY = 7_426_001;

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
// Verified on Postgres 16: ON DELETE RESTRICT also reports foreign_key_violation (23503), not restrict_violation (23001).
const RESTRICT_VIOLATION = FOREIGN_KEY_VIOLATION;

type Value = string | number | boolean | null;
type Row = Record<string, Value>;

const i18n = (text: string): string => JSON.stringify({ uk: text });

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Test setup bug: ${what} is missing`);
  return value;
}

describe("catalog schema (real Postgres)", () => {
  // Destructive: drops the whole schema in beforeAll/afterAll. requireTestDatabaseUrl refuses non-"_test" databases.
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let lockClient: pg.PoolClient;
  // Every test runs in its own transaction that is rolled back, so tests never see each other's rows.
  let client: pg.PoolClient;

  async function dropEverything(): Promise<void> {
    await pool.query('drop schema if exists "drizzle" cascade');
    // Reverse dependency order, no CASCADE (same reasoning as migrations.spec.ts).
    for (const name of [
      "search_synonym_group",
      "search_sync_queue",
      "search_index_state",
      "admin_audit_event",
      "privacy_request",
      "payment_refund",
      "payment_event",
      "payment",
      "email_message",
      "customer_auth_token",
      "shipment_status_change",
      "shipment",
      "order_shipping",
      "shipping_provider_setting",
      "shipping_method",
      "media_upload",
      "domain_event",
      "order_item_reservation",
      "order_status_change",
      "order_adjustment",
      "order_item",
      "sales_order",
      "cart_item",
      "cart",
      "customer_session",
      "customer",
      "reservation",
      "stock_movement",
      "inventory_level",
      "price",
      "location",
      "admin_session",
      "admin_user",
      "media",
      "variant_option_value",
      "variant",
      "product_option_value",
      "product_option",
      "product_category",
      "product",
      "brand",
      "category",
      "product_type_option",
      "product_type_attribute",
      "product_type",
      "option_value",
      "option",
      "attribute_option",
      "attribute",
      "health_check",
    ]) {
      await pool.query(`drop table if exists "${name}"`);
    }
    await pool.query('drop sequence if exists "search_sync_seq"');
    await pool.query('drop function if exists "admin_audit_event_append_only"()');
    await pool.query('drop function if exists "payment_event_append_only"()');
    await pool.query('drop function if exists "shipment_status_change_append_only"()');
    await pool.query('drop function if exists "order_shipping_immutable"()');
    await pool.query('drop function if exists "order_status_change_append_only"()');
    await pool.query('drop function if exists "order_adjustment_append_only"()');
    await pool.query('drop function if exists "order_item_immutable"()');
    await pool.query('drop function if exists "stock_movement_append_only"()');
  }

  beforeAll(async () => {
    lockClient = await pool.connect();
    await lockClient.query("select pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
    await dropEverything();
    await migrate(drizzle(pool), { migrationsFolder });
  }, 120_000);

  afterAll(async () => {
    try {
      await dropEverything();
    } finally {
      await lockClient.query("select pg_advisory_unlock($1)", [SCHEMA_LOCK_KEY]);
      lockClient.release();
      await pool.end();
    }
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query("begin");
  });

  afterEach(async () => {
    try {
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  async function insert(table: string, row: Row): Promise<Record<string, unknown>> {
    const columns = Object.keys(row);
    const result = await client.query(
      `insert into "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) ` +
        `values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning *`,
      Object.values(row),
    );
    return must(result.rows[0] as Record<string, unknown> | undefined, `${table} row`);
  }

  async function insertId(table: string, row: Row): Promise<string> {
    const created = await insert(table, row);
    if (typeof created.id !== "string") throw new Error(`Test setup bug: ${table} has no id`);
    return created.id;
  }

  async function count(table: string, where = "true"): Promise<number> {
    const result = await client.query(
      `select count(*)::int as count from "${table}" where ${where}`,
    );
    return must(result.rows[0] as { count: number } | undefined, "count row").count;
  }

  /** Runs one statement that must fail; asserts SQLSTATE and constraint name, then undoes the failed statement. */
  async function expectViolation(
    run: () => Promise<unknown>,
    code: string,
    constraint: string,
  ): Promise<void> {
    await client.query("savepoint expected_violation");
    const error = await run().then(
      () => undefined,
      (reason: unknown) => reason,
    );
    await client.query("rollback to savepoint expected_violation");
    expect(
      error,
      `expected "${constraint}" to be violated, but the statement succeeded`,
    ).toBeInstanceOf(pg.DatabaseError);
    if (!(error instanceof pg.DatabaseError)) return;
    expect({ code: error.code, constraint: error.constraint }).toEqual({ code, constraint });
  }

  const createProductType = (code = "clothing") =>
    insertId("product_type", { code, name: i18n(code) });
  const createOption = (code: string) => insertId("option", { code, name: i18n(code) });
  const createOptionValue = (optionId: string, code: string) =>
    insertId("option_value", { option_id: optionId, code, label: i18n(code) });
  const createBrand = (slug: string) => insertId("brand", { slug, name: i18n(slug) });
  const createCategory = (slug: string, parentId: string | null = null) =>
    insertId("category", { slug, name: i18n(slug), parent_id: parentId });
  const createAttribute = (code: string, extra: Row = {}) =>
    insertId("attribute", {
      code,
      name: i18n(code),
      input_type: "text",
      is_localized: false,
      ...extra,
    });
  const createProduct = (productTypeId: string, slug: string, extra: Row = {}) =>
    insertId("product", { product_type_id: productTypeId, slug, title: i18n(slug), ...extra });
  const chooseOption = (productId: string, optionId: string, position = 0) =>
    insert("product_option", { product_id: productId, option_id: optionId, position });
  const chooseValue = (productId: string, optionId: string, optionValueId: string) =>
    insert("product_option_value", {
      product_id: productId,
      option_id: optionId,
      option_value_id: optionValueId,
    });
  const createVariant = (productId: string, sku: string, extra: Row = {}) =>
    insertId("variant", { product_id: productId, sku, option_signature: "", ...extra });
  const assignValue = (
    variantId: string,
    productId: string,
    optionId: string,
    optionValueId: string,
  ) =>
    insert("variant_option_value", {
      variant_id: variantId,
      product_id: productId,
      option_id: optionId,
      option_value_id: optionValueId,
    });

  interface Shirt {
    productTypeId: string;
    productId: string;
    colorId: string;
    sizeId: string;
    colors: Record<string, string>;
    sizes: Record<string, string>;
    variantIds: string[];
  }

  /** ADR 0006 scenario (a): T-shirt with options color (red, black) and size (s, m, l) = 6 variants. */
  async function createShirt(): Promise<Shirt> {
    const productTypeId = await createProductType("clothing");
    const colorId = await createOption("color");
    const sizeId = await createOption("size");
    await insert("product_type_option", { product_type_id: productTypeId, option_id: colorId });
    await insert("product_type_option", {
      product_type_id: productTypeId,
      option_id: sizeId,
      position: 1,
    });

    const colors: Record<string, string> = {};
    for (const code of ["red", "black"]) colors[code] = await createOptionValue(colorId, code);
    const sizes: Record<string, string> = {};
    for (const code of ["s", "m", "l"]) sizes[code] = await createOptionValue(sizeId, code);

    const productId = await createProduct(productTypeId, "futbolka-basic", {
      status: "active",
      published_at: "2026-10-15T10:00:00Z",
      attributes: JSON.stringify({ material: "cotton" }),
    });
    await chooseOption(productId, colorId, 0);
    await chooseOption(productId, sizeId, 1);
    for (const valueId of Object.values(colors)) await chooseValue(productId, colorId, valueId);
    for (const valueId of Object.values(sizes)) await chooseValue(productId, sizeId, valueId);

    const variantIds: string[] = [];
    for (const [colorCode, colorValueId] of Object.entries(colors)) {
      for (const [sizeCode, sizeValueId] of Object.entries(sizes)) {
        const variantId = await createVariant(
          productId,
          `FUTBOLKA-BASIC-${colorCode.toUpperCase()}-${sizeCode.toUpperCase()}`,
          {
            option_signature: `color=${colorCode};size=${sizeCode}`,
            is_default: variantIds.length === 0,
            position: variantIds.length,
            attributes: JSON.stringify({ weight_g: 180 }),
          },
        );
        await assignValue(variantId, productId, colorId, colorValueId);
        await assignValue(variantId, productId, sizeId, sizeValueId);
        variantIds.push(variantId);
      }
    }

    // Two gallery images (no option value) and one image of the red color.
    await insert("media", {
      product_id: productId,
      url: "https://example.test/a.jpg",
      position: 0,
    });
    await insert("media", {
      product_id: productId,
      url: "https://example.test/b.jpg",
      position: 1,
    });
    await insert("media", {
      product_id: productId,
      option_id: colorId,
      option_value_id: must(colors.red, "red"),
      url: "https://example.test/red.jpg",
      alt: i18n("Red"),
    });

    return { productTypeId, productId, colorId, sizeId, colors, sizes, variantIds };
  }

  /** A draft product with one option (color) and two chosen values, and no variants yet. */
  async function createColorProduct(slug = "color-product") {
    const productTypeId = await createProductType(`type_${slug.replaceAll("-", "_")}`);
    const colorId = await createOption(`color_${slug.replaceAll("-", "_")}`);
    const red = await createOptionValue(colorId, "red");
    const black = await createOptionValue(colorId, "black");
    const productId = await createProduct(productTypeId, slug);
    await chooseOption(productId, colorId);
    await chooseValue(productId, colorId, red);
    await chooseValue(productId, colorId, black);
    return { productTypeId, productId, colorId, red, black };
  }

  // ---------------------------------------------------------------------------------------------
  // Positive cases
  // ---------------------------------------------------------------------------------------------

  describe("valid data", () => {
    it("accepts a T-shirt with 2 options and 6 variants, and its option signatures are consistent", async () => {
      const shirt = await createShirt();

      expect(shirt.variantIds).toHaveLength(6);
      expect(await count("variant", `product_id = '${shirt.productId}'`)).toBe(6);
      expect(await count("variant_option_value", `product_id = '${shirt.productId}'`)).toBe(12);
      expect(await count("product_option", `product_id = '${shirt.productId}'`)).toBe(2);
      expect(await count("product_option_value", `product_id = '${shirt.productId}'`)).toBe(5);
      expect(await count("media", `product_id = '${shirt.productId}'`)).toBe(3);

      // The consistency query from ADR 0006 section 2 must return zero rows.
      const inconsistent = await client.query(`
        select v.id from variant v
        left join (
          select vov.variant_id, string_agg(o.code || '=' || ov.code, ';' order by o.code) as signature
          from variant_option_value vov
          join option o on o.id = vov.option_id
          join option_value ov on ov.id = vov.option_value_id
          group by vov.variant_id
        ) s on s.variant_id = v.id
        where v.option_signature <> coalesce(s.signature, '')
      `);
      expect(inconsistent.rows).toEqual([]);
    });

    it("accepts an option-less product with exactly one default variant", async () => {
      const productTypeId = await createProductType("hand_tool");
      const brandId = await createBrand("acme");
      const categoryId = await createCategory("tools");
      const productId = await createProduct(productTypeId, "vykrutka-ph2-100", {
        brand_id: brandId,
        attributes: JSON.stringify({ tip_type: "ph2", length_mm: 100, magnetic: true }),
      });
      await insert("product_category", {
        product_id: productId,
        category_id: categoryId,
        is_primary: true,
      });
      await createVariant(productId, "VYKRUTKA-PH2-100", {
        option_signature: "",
        is_default: true,
        attributes: JSON.stringify({ supplier_code: "S-42" }),
      });

      expect(await count("variant", `product_id = '${productId}'`)).toBe(1);
      expect(await count("variant_option_value")).toBe(0);
    });

    it("accepts the attribute definitions of the ADR scenarios, including an internal non-public attribute", async () => {
      await createAttribute("supplier_code", {
        is_internal: true,
        is_visible_on_storefront: false,
      });
      await createAttribute("weight_g", {
        input_type: "number",
        unit: "g",
        is_filterable: true,
        is_sortable: true,
      });
      await createAttribute("care", { is_localized: true, is_searchable: true });
      await createAttribute("material", { input_type: "select", is_filterable: true });
      expect(await count("attribute")).toBe(4);
    });

    it("allows a second variant when the first is not the default, and two non-primary categories", async () => {
      const { productId } = await createColorProduct("allowed-second");
      await createVariant(productId, "ALLOWED-1", { option_signature: "a", is_default: true });
      await createVariant(productId, "ALLOWED-2", { option_signature: "b", is_default: false });
      await createVariant(productId, "ALLOWED-3", { option_signature: "c", is_default: false });

      const productTypeId = await createProductType("other_type");
      const secondProduct = await createProduct(productTypeId, "second-product");
      const first = await createCategory("first-category");
      const second = await createCategory("second-category");
      const third = await createCategory("third-category");
      await insert("product_category", {
        product_id: secondProduct,
        category_id: first,
        is_primary: true,
      });
      await insert("product_category", { product_id: secondProduct, category_id: second });
      await insert("product_category", { product_id: secondProduct, category_id: third });
      expect(await count("variant", `product_id = '${productId}'`)).toBe(3);
      expect(await count("product_category", `product_id = '${secondProduct}'`)).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Unique constraints
  // ---------------------------------------------------------------------------------------------

  describe("unique constraints", () => {
    it("rejects a duplicate sku across products", async () => {
      const productTypeId = await createProductType();
      const first = await createProduct(productTypeId, "first-product");
      const second = await createProduct(productTypeId, "second-product");
      await createVariant(first, "SAME-SKU", { is_default: true });
      await expectViolation(
        () => createVariant(second, "SAME-SKU", { is_default: true }),
        UNIQUE_VIOLATION,
        "variant_sku_key",
      );
    });

    it("rejects a duplicate product slug", async () => {
      const productTypeId = await createProductType();
      await createProduct(productTypeId, "same-slug");
      await expectViolation(
        () => createProduct(productTypeId, "same-slug"),
        UNIQUE_VIOLATION,
        "product_slug_key",
      );
    });

    it("rejects a duplicate category slug", async () => {
      await createCategory("same-slug");
      await expectViolation(
        () => createCategory("same-slug"),
        UNIQUE_VIOLATION,
        "category_slug_key",
      );
    });

    it("rejects a duplicate brand slug", async () => {
      await createBrand("same-slug");
      await expectViolation(() => createBrand("same-slug"), UNIQUE_VIOLATION, "brand_slug_key");
    });

    it("keeps slugs unique per entity type only (the same slug may be used by a product, a category and a brand)", async () => {
      const productTypeId = await createProductType();
      await createProduct(productTypeId, "shared-slug");
      await createCategory("shared-slug");
      await createBrand("shared-slug");
      expect(await count("brand", "slug = 'shared-slug'")).toBe(1);
    });

    it("rejects duplicate codes of attribute, option, product type, option value and attribute option", async () => {
      const attributeId = await createAttribute("dup_attribute");
      await expectViolation(
        () => createAttribute("dup_attribute"),
        UNIQUE_VIOLATION,
        "attribute_code_key",
      );

      const optionId = await createOption("dup_option");
      await expectViolation(() => createOption("dup_option"), UNIQUE_VIOLATION, "option_code_key");

      await createProductType("dup_type");
      await expectViolation(
        () => createProductType("dup_type"),
        UNIQUE_VIOLATION,
        "product_type_code_key",
      );

      await createOptionValue(optionId, "dup_value");
      await expectViolation(
        () => createOptionValue(optionId, "dup_value"),
        UNIQUE_VIOLATION,
        "option_value_option_id_code_key",
      );
      // The same value code under another option is fine.
      const otherOptionId = await createOption("other_option");
      await createOptionValue(otherOptionId, "dup_value");

      const attributeOption = (code: string) =>
        insert("attribute_option", { attribute_id: attributeId, code, label: i18n(code) });
      await attributeOption("dup_choice");
      await expectViolation(
        () => attributeOption("dup_choice"),
        UNIQUE_VIOLATION,
        "attribute_option_attribute_id_code_key",
      );
    });

    it("rejects a second variant with the same option_signature in one product", async () => {
      const { productId } = await createColorProduct("same-signature");
      await createVariant(productId, "SIG-1", { option_signature: "color=red" });
      await expectViolation(
        () => createVariant(productId, "SIG-2", { option_signature: "color=red" }),
        UNIQUE_VIOLATION,
        "variant_product_id_option_signature_key",
      );
      // The same signature in another product is fine.
      const productTypeId = await createProductType("another_type");
      const other = await createProduct(productTypeId, "other-product");
      await createVariant(other, "SIG-3", { option_signature: "color=red" });
    });

    it("rejects a second variant on an option-less product (two empty signatures)", async () => {
      const productTypeId = await createProductType("hand_tool");
      const productId = await createProduct(productTypeId, "screwdriver");
      await createVariant(productId, "SCREW-1", { option_signature: "" });
      await expectViolation(
        () => createVariant(productId, "SCREW-2", { option_signature: "" }),
        UNIQUE_VIOLATION,
        "variant_product_id_option_signature_key",
      );
    });

    it("rejects two default variants in one product", async () => {
      const { productId } = await createColorProduct("two-defaults");
      await createVariant(productId, "DEFAULT-1", { option_signature: "a", is_default: true });
      await expectViolation(
        () => createVariant(productId, "DEFAULT-2", { option_signature: "b", is_default: true }),
        UNIQUE_VIOLATION,
        "variant_product_id_default_key",
      );
    });

    it("rejects two primary categories of one product", async () => {
      const productTypeId = await createProductType();
      const productId = await createProduct(productTypeId, "two-primaries");
      const first = await createCategory("category-one");
      const second = await createCategory("category-two");
      await insert("product_category", {
        product_id: productId,
        category_id: first,
        is_primary: true,
      });
      await expectViolation(
        () =>
          insert("product_category", {
            product_id: productId,
            category_id: second,
            is_primary: true,
          }),
        UNIQUE_VIOLATION,
        "product_category_product_id_primary_key",
      );
    });

    it("rejects the same category assigned twice to a product", async () => {
      const productTypeId = await createProductType();
      const productId = await createProduct(productTypeId, "twice-category");
      const categoryId = await createCategory("category-one");
      await insert("product_category", { product_id: productId, category_id: categoryId });
      await expectViolation(
        () => insert("product_category", { product_id: productId, category_id: categoryId }),
        UNIQUE_VIOLATION,
        "product_category_pkey",
      );
    });

    it("rejects an attribute assigned twice to one product type (one level per attribute)", async () => {
      const productTypeId = await createProductType();
      const attributeId = await createAttribute("assigned_twice");
      const assign = (level: string) =>
        insert("product_type_attribute", {
          product_type_id: productTypeId,
          attribute_id: attributeId,
          level,
        });
      await assign("product");
      await expectViolation(
        () => assign("variant"),
        UNIQUE_VIOLATION,
        "product_type_attribute_pkey",
      );
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Format and enumeration checks
  // ---------------------------------------------------------------------------------------------

  describe("format checks", () => {
    const invalidSlugs = [
      "Upper-Case",
      "with space",
      "-leading-hyphen",
      "trailing-hyphen-",
      "double--hyphen",
      "under_score",
      "",
      "кирилиця",
      "a".repeat(161),
    ];

    it.each([
      ["product", "product_slug_check"],
      ["category", "category_slug_check"],
      ["brand", "brand_slug_check"],
    ] as const)("rejects an invalid %s slug", async (table, constraint) => {
      const productTypeId = await createProductType();
      for (const slug of invalidSlugs) {
        await expectViolation(
          () => {
            if (table === "product") return createProduct(productTypeId, slug);
            if (table === "category") return createCategory(slug);
            return createBrand(slug);
          },
          CHECK_VIOLATION,
          constraint,
        );
      }
    });

    it("accepts slugs at the boundaries (1 and 160 characters, digits, single hyphens)", async () => {
      await createBrand("a");
      await createBrand("a".repeat(160));
      await createBrand("2026-collection-1");
    });

    const invalidCodes = [
      "Upper",
      "1starts_with_digit",
      "_leading",
      "has-hyphen",
      "has space",
      "",
      "a".repeat(65),
    ];

    it.each([
      ["attribute", "attribute_code_check"],
      ["option", "option_code_check"],
      ["product_type", "product_type_code_check"],
      ["option_value", "option_value_code_check"],
      ["attribute_option", "attribute_option_code_check"],
    ] as const)("rejects an invalid %s code", async (table, constraint) => {
      const parentId =
        table === "option_value"
          ? await createOption("parent_option")
          : table === "attribute_option"
            ? await createAttribute("parent_attribute")
            : null;
      // Value codes (option values, attribute options) may start with a digit, e.g. shoe size "42".
      const isValueTable = table === "option_value" || table === "attribute_option";
      const codes = isValueTable
        ? invalidCodes.filter((code) => code !== "1starts_with_digit")
        : invalidCodes;
      for (const code of codes) {
        await expectViolation(
          () => {
            if (table === "attribute") return createAttribute(code);
            if (table === "option") return createOption(code);
            if (table === "product_type") return createProductType(code);
            if (table === "option_value") return createOptionValue(String(parentId), code);
            return insert("attribute_option", {
              attribute_id: String(parentId),
              code,
              label: i18n("label"),
            });
          },
          CHECK_VIOLATION,
          constraint,
        );
      }
    });

    it("accepts numeric value codes for option values and attribute options, but not for other codes", async () => {
      const optionId = await createOption("shoe_size");
      await createOptionValue(optionId, "42");
      await createOptionValue(optionId, "2xl");
      const attributeId = await createAttribute("size_label");
      for (const code of ["42", "2xl"]) {
        await insert("attribute_option", { attribute_id: attributeId, code, label: i18n("label") });
      }
      await expectViolation(() => createOption("42"), CHECK_VIOLATION, "option_code_check");
      await expectViolation(() => createAttribute("42"), CHECK_VIOLATION, "attribute_code_check");
      await expectViolation(
        () => createProductType("42"),
        CHECK_VIOLATION,
        "product_type_code_check",
      );
    });

    it("accepts codes at the boundaries (1 and 64 characters)", async () => {
      await createOption("a");
      await createOption(`a${"b".repeat(63)}`);
    });

    it("rejects an invalid sku", async () => {
      const productTypeId = await createProductType();
      const productId = await createProduct(productTypeId, "sku-format");
      for (const sku of [
        "lower-case",
        "-LEADING",
        ".LEADING",
        "HAS SPACE",
        "",
        "A".repeat(65),
        "SKU/1",
      ]) {
        await expectViolation(
          () => createVariant(productId, sku, { option_signature: sku }),
          CHECK_VIOLATION,
          "variant_sku_check",
        );
      }
      await createVariant(productId, "A", { option_signature: "1" });
      await createVariant(productId, "0A.b_C-d".toUpperCase(), { option_signature: "2" });
      await createVariant(productId, "A".repeat(64), { option_signature: "3" });
    });
  });

  describe("i18n text checks", () => {
    interface TextCase {
      table: string;
      column: string;
      constraint: string;
      base: () => Promise<Row>;
    }

    const requiredCases: TextCase[] = [
      {
        table: "attribute",
        column: "name",
        constraint: "attribute_name_check",
        base: async () => ({ code: "text_case", input_type: "text", is_localized: false }),
      },
      {
        table: "attribute_option",
        column: "label",
        constraint: "attribute_option_label_check",
        base: async () => ({
          attribute_id: await createAttribute("parent_attribute"),
          code: "choice",
        }),
      },
      {
        table: "option",
        column: "name",
        constraint: "option_name_check",
        base: async () => ({ code: "text_case" }),
      },
      {
        table: "option_value",
        column: "label",
        constraint: "option_value_label_check",
        base: async () => ({ option_id: await createOption("parent_option"), code: "value" }),
      },
      {
        table: "product_type",
        column: "name",
        constraint: "product_type_name_check",
        base: async () => ({ code: "text_case" }),
      },
      {
        table: "category",
        column: "name",
        constraint: "category_name_check",
        base: async () => ({ slug: "text-case" }),
      },
      {
        table: "brand",
        column: "name",
        constraint: "brand_name_check",
        base: async () => ({ slug: "text-case" }),
      },
      {
        table: "product",
        column: "title",
        constraint: "product_title_check",
        base: async () => ({
          product_type_id: await createProductType("parent_type"),
          slug: "text-case",
        }),
      },
    ];

    it.each(requiredCases)(
      "rejects $table.$column when it is not a JSON object or is empty",
      async ({ table, column, constraint, base }) => {
        const row = await base();
        // Valid shapes that are not an object, plus the empty object. The default locale is a service rule.
        for (const invalid of ["{}", "[]", '"text"', "1", "true", "null"]) {
          await expectViolation(
            () => insert(table, { ...row, [column]: invalid }),
            CHECK_VIOLATION,
            constraint,
          );
        }
        // Any non-empty object passes: the DB does not know the default locale.
        await insert(table, { ...row, [column]: JSON.stringify({ en: "only english" }) });
      },
    );

    const optionalCases: TextCase[] = [
      {
        table: "attribute",
        column: "description",
        constraint: "attribute_description_check",
        base: async () => ({
          code: "text_case",
          name: i18n("n"),
          input_type: "text",
          is_localized: false,
        }),
      },
      {
        table: "category",
        column: "description",
        constraint: "category_description_check",
        base: async () => ({ slug: "text-case", name: i18n("n") }),
      },
      {
        table: "brand",
        column: "description",
        constraint: "brand_description_check",
        base: async () => ({ slug: "text-case", name: i18n("n") }),
      },
      {
        table: "product",
        column: "description",
        constraint: "product_description_check",
        base: async () => ({
          product_type_id: await createProductType("parent_type"),
          slug: "text-case",
          title: i18n("t"),
        }),
      },
      {
        table: "variant",
        column: "title",
        constraint: "variant_title_check",
        base: async () => {
          const productTypeId = await createProductType("parent_type");
          return {
            product_id: await createProduct(productTypeId, "parent-product"),
            sku: "TEXT-CASE",
            option_signature: "",
          };
        },
      },
      {
        table: "media",
        column: "alt",
        constraint: "media_alt_check",
        base: async () => {
          const productTypeId = await createProductType("parent_type");
          return {
            product_id: await createProduct(productTypeId, "parent-product"),
            url: "https://example.test/a.jpg",
          };
        },
      },
    ];

    it.each(optionalCases)(
      "rejects $table.$column when present but not a JSON object, and allows NULL",
      async ({ table, column, constraint, base }) => {
        const row = await base();
        for (const invalid of ["[]", '"text"', "1", "null"]) {
          await expectViolation(
            () => insert(table, { ...row, [column]: invalid }),
            CHECK_VIOLATION,
            constraint,
          );
        }
        await insert(table, { ...row, [column]: null });
      },
    );

    it("rejects a JSON attributes value that is not an object on product and variant, and attribute.validation", async () => {
      const productTypeId = await createProductType();
      for (const invalid of ["[]", '"text"', "1", "null"]) {
        await expectViolation(
          () => createProduct(productTypeId, "bad-attributes", { attributes: invalid }),
          CHECK_VIOLATION,
          "product_attributes_check",
        );
      }
      const productId = await createProduct(productTypeId, "good-attributes");
      for (const invalid of ["[]", '"text"', "1", "null"]) {
        await expectViolation(
          () => createVariant(productId, "BAD-ATTRS", { attributes: invalid }),
          CHECK_VIOLATION,
          "variant_attributes_check",
        );
        await expectViolation(
          () => createAttribute("bad_validation", { validation: invalid }),
          CHECK_VIOLATION,
          "attribute_validation_check",
        );
      }
    });
  });

  describe("enumerations and flags", () => {
    it("rejects an invalid product status", async () => {
      const productTypeId = await createProductType();
      await expectViolation(
        () => createProduct(productTypeId, "bad-status", { status: "published" }),
        CHECK_VIOLATION,
        "product_status_check",
      );
      for (const status of ["draft", "archived"]) {
        await createProduct(productTypeId, `status-${status}`, { status });
      }
    });

    it("rejects an active product without published_at", async () => {
      const productTypeId = await createProductType();
      await expectViolation(
        () => createProduct(productTypeId, "active-unpublished", { status: "active" }),
        CHECK_VIOLATION,
        "product_published_at_check",
      );
      await createProduct(productTypeId, "active-published", {
        status: "active",
        published_at: "2026-10-15T10:00:00Z",
      });
      // A product may return to draft after publishing, so a draft with published_at is valid.
      await createProduct(productTypeId, "draft-after-publish", {
        status: "draft",
        published_at: "2026-10-15T10:00:00Z",
      });
    });

    it("rejects an invalid product_type_attribute level", async () => {
      const productTypeId = await createProductType();
      const attributeId = await createAttribute("level_attribute");
      await expectViolation(
        () =>
          insert("product_type_attribute", {
            product_type_id: productTypeId,
            attribute_id: attributeId,
            level: "category",
          }),
        CHECK_VIOLATION,
        "product_type_attribute_level_check",
      );
      for (const level of ["product", "variant"]) {
        const other = await createAttribute(`level_${level}`);
        await insert("product_type_attribute", {
          product_type_id: productTypeId,
          attribute_id: other,
          level,
        });
      }
    });

    it("rejects an invalid attribute input_type", async () => {
      await expectViolation(
        () => createAttribute("bad_input", { input_type: "richtext" }),
        CHECK_VIOLATION,
        "attribute_input_type_check",
      );
      for (const inputType of ["text", "number", "boolean", "select", "multiselect", "date"]) {
        await createAttribute(`type_${inputType}`, { input_type: inputType });
      }
    });

    it.each([
      "is_visible_on_storefront",
      "is_filterable",
      "is_searchable",
      "is_comparable",
      "is_sortable",
    ] as const)("rejects is_internal combined with %s", async (flag) => {
      // input_type number satisfies the sortable and filterable type rules, so only the internal rule can fail.
      await expectViolation(
        () =>
          createAttribute("internal_flag", {
            input_type: "number",
            is_internal: true,
            is_visible_on_storefront: flag === "is_visible_on_storefront",
            [flag]: true,
          }),
        CHECK_VIOLATION,
        "attribute_is_internal_check",
      );
    });

    it("rejects the other attribute flag and type combinations", async () => {
      await expectViolation(
        () => createAttribute("unit_on_text", { input_type: "text", unit: "mm" }),
        CHECK_VIOLATION,
        "attribute_unit_check",
      );
      await expectViolation(
        () => createAttribute("localized_number", { input_type: "number", is_localized: true }),
        CHECK_VIOLATION,
        "attribute_is_localized_check",
      );
      await expectViolation(
        () => createAttribute("sortable_text", { input_type: "text", is_sortable: true }),
        CHECK_VIOLATION,
        "attribute_is_sortable_check",
      );
      await expectViolation(
        () => createAttribute("filterable_text", { input_type: "text", is_filterable: true }),
        CHECK_VIOLATION,
        "attribute_is_filterable_check",
      );
    });

    it("rejects a category that is its own parent, on insert and on update", async () => {
      const id = "11111111-1111-4111-8111-111111111111";
      await expectViolation(
        () => insert("category", { id, parent_id: id, slug: "self-parent", name: i18n("n") }),
        CHECK_VIOLATION,
        "category_parent_id_check",
      );
      const categoryId = await createCategory("update-self");
      await expectViolation(
        () => client.query("update category set parent_id = id where id = $1", [categoryId]),
        CHECK_VIOLATION,
        "category_parent_id_check",
      );
    });

    it("rejects a self-referencing foreign key that points at a missing parent", async () => {
      await expectViolation(
        () => createCategory("orphan-category", "22222222-2222-4222-8222-222222222222"),
        FOREIGN_KEY_VIOLATION,
        "category_parent_id_fkey",
      );
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Foreign keys (composite ones guard the variant / option invariants)
  // ---------------------------------------------------------------------------------------------

  describe("foreign keys", () => {
    it("rejects a variant without an existing product", async () => {
      await expectViolation(
        () => createVariant("33333333-3333-4333-8333-333333333333", "NO-PRODUCT"),
        FOREIGN_KEY_VIOLATION,
        "variant_product_id_fkey",
      );
    });

    it("rejects a variant_option_value with a value the product did not choose", async () => {
      const { productId, colorId } = await createColorProduct("not-chosen");
      const green = await createOptionValue(colorId, "green");
      const variantId = await createVariant(productId, "NOT-CHOSEN", {
        option_signature: "color=green",
      });
      await expectViolation(
        () => assignValue(variantId, productId, colorId, green),
        FOREIGN_KEY_VIOLATION,
        "variant_option_value_product_option_value_fkey",
      );
    });

    it("rejects a variant_option_value whose variant belongs to another product", async () => {
      const first = await createColorProduct("variant-owner");
      const productTypeId = await createProductType("second_type");
      const secondProductId = await createProduct(productTypeId, "other-owner");
      await chooseOption(secondProductId, first.colorId);
      await chooseValue(secondProductId, first.colorId, first.red);
      const variantOfSecond = await createVariant(secondProductId, "OTHER-OWNER", {
        option_signature: "color=red",
      });
      // The first product chose red, so only the "variant belongs to this product" rule can fail.
      await expectViolation(
        () => assignValue(variantOfSecond, first.productId, first.colorId, first.red),
        FOREIGN_KEY_VIOLATION,
        "variant_option_value_variant_fkey",
      );
    });

    it("rejects a value chosen for the wrong option (product_option_value)", async () => {
      const { productId, colorId } = await createColorProduct("wrong-option");
      const sizeId = await createOption("size_wrong_option");
      const small = await createOptionValue(sizeId, "s");
      // The product chose the option "color", but the value belongs to the option "size".
      await expectViolation(
        () => chooseValue(productId, colorId, small),
        FOREIGN_KEY_VIOLATION,
        "product_option_value_option_value_fkey",
      );
    });

    it("rejects a value of an option the product did not choose", async () => {
      const { productId } = await createColorProduct("option-not-chosen");
      const sizeId = await createOption("size_not_chosen");
      const small = await createOptionValue(sizeId, "s");
      await expectViolation(
        () => chooseValue(productId, sizeId, small),
        FOREIGN_KEY_VIOLATION,
        "product_option_value_product_option_fkey",
      );
    });

    it("rejects two values of one option on one variant", async () => {
      const { productId, colorId, red, black } = await createColorProduct("two-values");
      const variantId = await createVariant(productId, "TWO-VALUES", {
        option_signature: "color=red",
      });
      await assignValue(variantId, productId, colorId, red);
      await expectViolation(
        () => assignValue(variantId, productId, colorId, black),
        UNIQUE_VIOLATION,
        "variant_option_value_pkey",
      );
    });

    it("rejects media with only one of option_id / option_value_id", async () => {
      const { productId, colorId, red } = await createColorProduct("media-pair");
      const media = (extra: Row) =>
        insert("media", { product_id: productId, url: "https://example.test/a.jpg", ...extra });
      await expectViolation(
        () => media({ option_id: colorId }),
        CHECK_VIOLATION,
        "media_option_pair_check",
      );
      await expectViolation(
        () => media({ option_value_id: red }),
        CHECK_VIOLATION,
        "media_option_pair_check",
      );
      await media({ option_id: colorId, option_value_id: red });
      await media({});
    });

    it("rejects media for a value the product did not choose", async () => {
      const { productId, colorId } = await createColorProduct("media-not-chosen");
      const green = await createOptionValue(colorId, "green");
      await expectViolation(
        () =>
          insert("media", {
            product_id: productId,
            option_id: colorId,
            option_value_id: green,
            url: "https://example.test/green.jpg",
          }),
        FOREIGN_KEY_VIOLATION,
        "media_product_option_value_fkey",
      );
    });

    it("rejects media for a missing product", async () => {
      await expectViolation(
        () =>
          insert("media", {
            product_id: "44444444-4444-4444-8444-444444444444",
            url: "https://example.test/a.jpg",
          }),
        FOREIGN_KEY_VIOLATION,
        "media_product_id_fkey",
      );
    });
  });

  // ---------------------------------------------------------------------------------------------
  // ON DELETE behaviour
  // ---------------------------------------------------------------------------------------------

  describe("ON DELETE RESTRICT", () => {
    const remove = (table: string, id: string) =>
      client.query(`delete from "${table}" where id = $1`, [id]);

    it("refuses to delete an option_value used by a product", async () => {
      const { red } = await createColorProduct("restrict-value");
      await expectViolation(
        () => remove("option_value", red),
        RESTRICT_VIOLATION,
        "product_option_value_option_value_fkey",
      );
    });

    it("refuses to delete a product_option_value used by a variant", async () => {
      const { productId, colorId, red } = await createColorProduct("restrict-variant-value");
      const variantId = await createVariant(productId, "RESTRICT-VARIANT", {
        option_signature: "color=red",
      });
      await assignValue(variantId, productId, colorId, red);
      await expectViolation(
        () =>
          client.query(
            "delete from product_option_value where product_id = $1 and option_value_id = $2",
            [productId, red],
          ),
        RESTRICT_VIOLATION,
        "variant_option_value_product_option_value_fkey",
      );
    });

    it("refuses to delete a product_option_value used by media", async () => {
      const { productId, colorId, red } = await createColorProduct("restrict-media-value");
      await insert("media", {
        product_id: productId,
        option_id: colorId,
        option_value_id: red,
        url: "https://example.test/red.jpg",
      });
      await expectViolation(
        () =>
          client.query(
            "delete from product_option_value where product_id = $1 and option_value_id = $2",
            [productId, red],
          ),
        RESTRICT_VIOLATION,
        "media_product_option_value_fkey",
      );
    });

    it("refuses to delete an attribute assigned to a product type", async () => {
      const productTypeId = await createProductType();
      const attributeId = await createAttribute("assigned_attribute");
      await insert("product_type_attribute", {
        product_type_id: productTypeId,
        attribute_id: attributeId,
        level: "product",
      });
      await expectViolation(
        () => remove("attribute", attributeId),
        RESTRICT_VIOLATION,
        "product_type_attribute_attribute_id_fkey",
      );
    });

    it("refuses to delete an option assigned to a product type or chosen by a product", async () => {
      const productTypeId = await createProductType();
      const optionId = await createOption("assigned_option");
      await insert("product_type_option", { product_type_id: productTypeId, option_id: optionId });
      await expectViolation(
        () => remove("option", optionId),
        RESTRICT_VIOLATION,
        "product_type_option_option_id_fkey",
      );
      await client.query("delete from product_type_option");

      const productId = await createProduct(productTypeId, "restrict-option");
      await chooseOption(productId, optionId);
      await expectViolation(
        () => remove("option", optionId),
        RESTRICT_VIOLATION,
        "product_option_option_id_fkey",
      );
    });

    it("refuses to delete a brand used by a product", async () => {
      const productTypeId = await createProductType();
      const brandId = await createBrand("used-brand");
      await createProduct(productTypeId, "branded", { brand_id: brandId });
      await expectViolation(
        () => remove("brand", brandId),
        RESTRICT_VIOLATION,
        "product_brand_id_fkey",
      );
    });

    it("refuses to delete a product type used by a product", async () => {
      const productTypeId = await createProductType();
      await createProduct(productTypeId, "typed");
      await expectViolation(
        () => remove("product_type", productTypeId),
        RESTRICT_VIOLATION,
        "product_product_type_id_fkey",
      );
    });

    it("refuses to delete a category with children", async () => {
      const parentId = await createCategory("parent-category");
      await createCategory("child-category", parentId);
      await expectViolation(
        () => remove("category", parentId),
        RESTRICT_VIOLATION,
        "category_parent_id_fkey",
      );
    });

    it("refuses to delete a category that still has products", async () => {
      const productTypeId = await createProductType();
      const productId = await createProduct(productTypeId, "categorised");
      const categoryId = await createCategory("used-category");
      await insert("product_category", { product_id: productId, category_id: categoryId });
      await expectViolation(
        () => remove("category", categoryId),
        RESTRICT_VIOLATION,
        "product_category_category_id_fkey",
      );
    });

    it("allows deleting a leaf category, an unused brand and an unused option value", async () => {
      const parentId = await createCategory("parent-category");
      const childId = await createCategory("child-category", parentId);
      await remove("category", childId);
      await remove("category", parentId);
      await remove("brand", await createBrand("unused-brand"));
      const { colorId } = await createColorProduct("unused-value");
      const spare = await createOptionValue(colorId, "spare");
      await remove("option_value", spare);
      expect(await count("option_value", `id = '${spare}'`)).toBe(0);
    });
  });

  describe("ON DELETE CASCADE", () => {
    it("deleting a product removes its variants, option rows, categories and media", async () => {
      const shirt = await createShirt();
      const categoryId = await createCategory("shirts");
      await insert("product_category", {
        product_id: shirt.productId,
        category_id: categoryId,
        is_primary: true,
      });
      const owned = (table: string) => count(table, `product_id = '${shirt.productId}'`);
      expect(await owned("variant")).toBe(6);
      expect(await owned("variant_option_value")).toBe(12);
      expect(await owned("product_option")).toBe(2);
      expect(await owned("product_option_value")).toBe(5);
      expect(await owned("product_category")).toBe(1);
      expect(await owned("media")).toBe(3);

      await client.query("delete from product where id = $1", [shirt.productId]);

      for (const table of [
        "variant",
        "variant_option_value",
        "product_option",
        "product_option_value",
        "product_category",
        "media",
      ]) {
        expect(await owned(table), table).toBe(0);
      }
      // Dictionaries are not owned by the product.
      expect(await count("option_value")).toBe(5);
      expect(await count("category", `id = '${categoryId}'`)).toBe(1);
    });

    it("deleting a variant removes its option value rows only", async () => {
      const shirt = await createShirt();
      const variantId = must(shirt.variantIds[3], "fourth variant");
      await client.query("delete from variant where id = $1", [variantId]);
      expect(await count("variant_option_value", `variant_id = '${variantId}'`)).toBe(0);
      expect(await count("variant_option_value")).toBe(10);
      expect(await count("product_option_value")).toBe(5);
    });

    it("deleting a product type removes its attribute and option assignments", async () => {
      const productTypeId = await createProductType();
      const attributeId = await createAttribute("cascade_attribute");
      const optionId = await createOption("cascade_option");
      await insert("product_type_attribute", {
        product_type_id: productTypeId,
        attribute_id: attributeId,
        level: "variant",
      });
      await insert("product_type_option", { product_type_id: productTypeId, option_id: optionId });
      await client.query("delete from product_type where id = $1", [productTypeId]);
      expect(await count("product_type_attribute")).toBe(0);
      expect(await count("product_type_option")).toBe(0);
      expect(await count("attribute", `id = '${attributeId}'`)).toBe(1);
      expect(await count("option", `id = '${optionId}'`)).toBe(1);
    });

    it("deleting an unassigned attribute or an unused option removes its choices and values", async () => {
      const attributeId = await createAttribute("cascade_select", { input_type: "select" });
      await insert("attribute_option", {
        attribute_id: attributeId,
        code: "cotton",
        label: i18n("c"),
      });
      await client.query("delete from attribute where id = $1", [attributeId]);
      expect(await count("attribute_option")).toBe(0);

      const optionId = await createOption("cascade_color");
      await createOptionValue(optionId, "red");
      await client.query("delete from option where id = $1", [optionId]);
      expect(await count("option_value")).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Names
  // ---------------------------------------------------------------------------------------------

  describe("names", () => {
    interface Declared {
      kind: string;
      name: string;
    }

    function declaredNames(): Declared[] {
      const names: Declared[] = [];
      const tables = Object.values(catalogSchema).filter((value) => is(value, PgTable));
      expect(tables).toHaveLength(16);
      for (const table of tables) {
        const config = getTableConfig(table);
        names.push({ kind: "table", name: getTableName(table) });
        for (const item of config.indexes) {
          names.push({
            kind: "index",
            name: must(item.config.name, `index name in ${config.name}`),
          });
        }
        for (const item of config.foreignKeys)
          names.push({ kind: "foreign key", name: item.getName() });
        for (const item of config.checks) names.push({ kind: "check", name: item.name });
        for (const item of config.uniqueConstraints) {
          names.push({ kind: "unique", name: must(item.name, `unique name in ${config.name}`) });
        }
        for (const item of config.primaryKeys)
          names.push({ kind: "primary key", name: item.getName() });
      }
      return names;
    }

    it("declares every constraint, index and table name with at most 63 characters, and the DB has them unchanged", async () => {
      const declared = declaredNames();
      expect(declared.length).toBeGreaterThan(100);

      // Postgres silently truncates longer identifiers to 63 characters, so check the declared names.
      const tooLong = declared.filter((item) => item.name.length > 63);
      expect(tooLong).toEqual([]);

      const result = await client.query<{ name: string }>(`
        select conname as name from pg_constraint c join pg_namespace n on n.oid = c.connamespace
          where n.nspname = 'public' and c.contype <> 'n'
        union
        select relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'i')
      `);
      const inDatabase = new Set(result.rows.map((row) => row.name));
      const missing = declared.filter((item) => !inDatabase.has(item.name));
      expect(missing).toEqual([]);
    });

    it("has no constraint on a catalog table that the schema did not name (single-column primary keys are <table>_pkey)", async () => {
      const declared = new Set(declaredNames().map((item) => item.name));
      const result = await client.query<{ name: string; table: string }>(`
        select c.conname as name, t.relname as "table"
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = c.connamespace
        where n.nspname = 'public' and c.contype <> 'n' and t.relname not in (
          'health_check', 'admin_user', 'admin_session',
          'price', 'location', 'inventory_level', 'stock_movement', 'reservation',
          'customer', 'customer_session', 'cart', 'cart_item', 'sales_order', 'order_item',
          'order_adjustment', 'order_status_change', 'order_item_reservation', 'domain_event',
          'media_upload', 'shipping_method', 'shipping_provider_setting', 'order_shipping', 'shipment',
          'shipment_status_change', 'customer_auth_token', 'email_message', 'payment', 'payment_event',
          'payment_refund', 'privacy_request', 'admin_audit_event',
          'search_sync_queue', 'search_index_state', 'search_synonym_group'
        )
      `);
      const unnamed = result.rows.filter(
        (row) => !declared.has(row.name) && row.name !== `${row.table}_pkey`,
      );
      expect(unnamed).toEqual([]);
    });

    it("has no index on a catalog table that the schema did not declare", async () => {
      const declared = new Set(declaredNames().map((item) => item.name));
      const result = await client.query<{ name: string; table: string }>(`
        select i.relname as name, t.relname as "table"
        from pg_index x
        join pg_class i on i.oid = x.indexrelid
        join pg_class t on t.oid = x.indrelid
        join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public' and t.relname not in (
          'health_check', 'admin_user', 'admin_session',
          'price', 'location', 'inventory_level', 'stock_movement', 'reservation',
          'customer', 'customer_session', 'cart', 'cart_item', 'sales_order', 'order_item',
          'order_adjustment', 'order_status_change', 'order_item_reservation', 'domain_event',
          'media_upload', 'shipping_method', 'shipping_provider_setting', 'order_shipping', 'shipment',
          'shipment_status_change', 'customer_auth_token', 'email_message', 'payment', 'payment_event',
          'payment_refund', 'privacy_request', 'admin_audit_event',
          'search_sync_queue', 'search_index_state', 'search_synonym_group'
        )
      `);
      // Indexes behind primary keys and unique constraints carry the constraint's name.
      const undeclared = result.rows.filter(
        (row) => !declared.has(row.name) && row.name !== `${row.table}_pkey`,
      );
      expect(undeclared).toEqual([]);
    });
  });
});
