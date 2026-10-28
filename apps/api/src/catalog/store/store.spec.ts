import { randomUUID } from "node:crypto";
import { MAX_AMOUNT } from "@fluxkit/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Page } from "../../common/pagination.js";
import type { ProblemBody } from "../../common/problem.filter.js";
import { PG_POOL } from "../../database/database.module.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { http } from "../../test/http.js";
import { defaultLocationId, insertLocation } from "../../test/inventory-fixtures.js";
import { ensureMigrated } from "../../test/migrate.js";
import type {
  StoreCategoryNode,
  StoreProductDetail,
  StoreProductListItem,
} from "./store.schemas.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Values that must never reach a response. They are stored in JSONB on purpose.
const SECRET_INTERNAL = "SECRET-INTERNAL-VALUE";
const SECRET_HIDDEN = "SECRET-HIDDEN-VALUE";
const SECRET_UNKNOWN = "SECRET-UNKNOWN-KEY-VALUE";
const SECRET_UNASSIGNED = "SECRET-UNASSIGNED-VALUE";
const SECRET_WRONG_LEVEL = "SECRET-WRONG-LEVEL-VALUE";
const SECRET_VARIANT_INTERNAL = "SECRET-VARIANT-INTERNAL-VALUE";
const SECRET_VARIANT_HIDDEN = "SECRET-VARIANT-HIDDEN-VALUE";
const ALL_SECRETS = [
  SECRET_INTERNAL,
  SECRET_HIDDEN,
  SECRET_UNKNOWN,
  SECRET_UNASSIGNED,
  SECRET_WRONG_LEVEL,
  SECRET_VARIANT_INTERNAL,
  SECRET_VARIANT_HIDDEN,
];

const DAY_MS = 24 * 60 * 60 * 1000;

describe("store API (public, real app, real Postgres)", () => {
  const runId = randomUUID().slice(0, 8);
  const upper = runId.toUpperCase();
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const now = Date.now();
  const ids: Record<string, string> = {};
  let running: RunningApp;

  const slug = (name: string): string => `${name}-${runId}`;

  async function insert(statement: string, params: unknown[]): Promise<string> {
    const result = await pool.query<{ id: string }>(statement, params);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("fixture insert returned no row");
    }
    return row.id;
  }

  function createAttribute(
    key: string,
    values: {
      inputType: string;
      isLocalized?: boolean;
      unit?: string;
      isFilterable?: boolean;
      isInternal?: boolean;
      isVisible?: boolean;
    },
  ): Promise<string> {
    return insert(
      `insert into attribute (code, name, input_type, is_localized, unit, is_filterable, is_internal, is_visible_on_storefront)
       values ($1, $2::jsonb, $3, $4, $5, $6, $7, $8) returning id`,
      [
        `${key}_${runId}`,
        JSON.stringify({ uk: `Назва ${key}`, en: `Name ${key}` }),
        values.inputType,
        values.isLocalized ?? false,
        values.unit ?? null,
        values.isFilterable ?? false,
        values.isInternal ?? false,
        values.isVisible ?? true,
      ],
    );
  }

  const attributeCode = (key: string): string => `${key}_${runId}`;

  function createCategory(
    key: string,
    parent: string | null,
    options: { position?: number; isActive?: boolean; description?: object } = {},
  ): Promise<string> {
    return insert(
      `insert into category (parent_id, slug, name, description, position, is_active)
       values ($1, $2, $3::jsonb, $4::jsonb, $5, $6) returning id`,
      [
        parent === null ? null : ids[parent],
        slug(key),
        JSON.stringify({ uk: `Категорія ${key}`, en: `Category ${key}` }),
        options.description === undefined ? null : JSON.stringify(options.description),
        options.position ?? 0,
        options.isActive ?? true,
      ],
    );
  }

  function createProduct(
    key: string,
    values: {
      status?: string;
      brand?: string;
      title?: object;
      description?: object;
      attributes?: object;
      publishedDaysAgo?: number;
    } = {},
  ): Promise<string> {
    return insert(
      `insert into product (product_type_id, brand_id, slug, title, description, status, attributes, published_at)
       values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8) returning id`,
      [
        ids["type"],
        values.brand === undefined ? null : ids[values.brand],
        slug(key),
        JSON.stringify(values.title ?? { uk: `Товар ${key}`, en: `Product ${key}` }),
        values.description === undefined ? null : JSON.stringify(values.description),
        values.status ?? "active",
        JSON.stringify(values.attributes ?? {}),
        new Date(now - (values.publishedDaysAgo ?? 0) * DAY_MS),
      ],
    );
  }

  async function assignCategory(
    productKey: string,
    categoryKey: string,
    isPrimary: boolean,
    position = 0,
  ): Promise<void> {
    await pool.query(
      "insert into product_category (product_id, category_id, is_primary, position) values ($1, $2, $3, $4)",
      [ids[productKey], ids[categoryKey], isPrimary, position],
    );
  }

  interface VariantPrice {
    amount: number;
    compareAt?: number;
    currency?: string;
  }

  interface VariantStock {
    onHand: number;
    reserved?: number;
    /** Key in `ids` of a location; the default location when missing. */
    location?: string;
  }

  /**
   * Fixture variants are priced in the shop currency and untracked (always in stock) unless a spec says otherwise, so
   * the catalog specs stay about the catalog. `prices: []` makes a priceless variant.
   */
  async function createVariant(
    productKey: string,
    sku: string,
    values: {
      signature: string;
      isDefault?: boolean;
      isActive?: boolean;
      position: number;
      attributes?: object;
      optionValues?: [string, string][];
      prices?: VariantPrice[];
      trackInventory?: boolean;
      allowBackorder?: boolean;
      stock?: VariantStock[];
    },
  ): Promise<string> {
    const variantId = await insert(
      `insert into variant (product_id, sku, option_signature, is_default, is_active, attributes, position,
                            track_inventory, allow_backorder)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9) returning id`,
      [
        ids[productKey],
        `${upper}-${sku}`,
        values.signature,
        values.isDefault ?? false,
        values.isActive ?? true,
        JSON.stringify(values.attributes ?? {}),
        values.position,
        values.trackInventory ?? false,
        values.allowBackorder ?? false,
      ],
    );
    ids[`variant:${sku}`] = variantId;
    for (const [optionKey, valueKey] of values.optionValues ?? []) {
      await pool.query(
        `insert into variant_option_value (variant_id, product_id, option_id, option_value_id)
         values ($1, $2, $3, $4)`,
        [variantId, ids[productKey], ids[optionKey], ids[valueKey]],
      );
    }
    for (const price of values.prices ?? [{ amount: 1000 }]) {
      await pool.query(
        "insert into price (variant_id, currency, amount, compare_at_amount) values ($1, $2, $3, $4)",
        [variantId, price.currency ?? "UAH", price.amount, price.compareAt ?? null],
      );
    }
    for (const level of values.stock ?? []) {
      await pool.query(
        "insert into inventory_level (variant_id, location_id, on_hand, reserved) values ($1, $2, $3, $4)",
        [
          variantId,
          level.location === undefined ? await defaultLocationId(pool) : ids[level.location],
          level.onHand,
          level.reserved ?? 0,
        ],
      );
    }
    return variantId;
  }

  async function chooseOption(
    productKey: string,
    optionKey: string,
    position: number,
    valueKeys: string[],
  ): Promise<void> {
    await pool.query(
      "insert into product_option (product_id, option_id, position) values ($1, $2, $3)",
      [ids[productKey], ids[optionKey], position],
    );
    let valuePosition = 0;
    for (const valueKey of valueKeys) {
      await pool.query(
        `insert into product_option_value (product_id, option_id, option_value_id, position)
         values ($1, $2, $3, $4)`,
        [ids[productKey], ids[optionKey], ids[valueKey], valuePosition],
      );
      valuePosition += 1;
    }
  }

  async function addMedia(
    productKey: string,
    url: string,
    position: number,
    values: { alt?: object; optionKey?: string; valueKey?: string } = {},
  ): Promise<void> {
    await pool.query(
      `insert into media (product_id, option_id, option_value_id, url, alt, position)
       values ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        ids[productKey],
        values.optionKey === undefined ? null : ids[values.optionKey],
        values.valueKey === undefined ? null : ids[values.valueKey],
        url,
        values.alt === undefined ? null : JSON.stringify(values.alt),
        position,
      ],
    );
  }

  async function get<T>(path: string) {
    return http<T>(running.baseUrl, "GET", path);
  }

  async function getOk<T>(path: string): Promise<T> {
    const result = await get<T>(path);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return result.body;
  }

  function problem(result: { body: unknown }): ProblemBody {
    return result.body as ProblemBody;
  }

  function findNode(nodes: StoreCategoryNode[], wanted: string): StoreCategoryNode | undefined {
    for (const node of nodes) {
      const found = node.slug === wanted ? node : findNode(node.children, wanted);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  const slugsOf = (page: Page<StoreProductListItem>): string[] =>
    page.items.map((item) => item.slug);

  beforeAll(async () => {
    await ensureMigrated();
    // The real default authenticator denies every admin request: the store must work without any auth.
    running = await startApp({ adminAuthenticator: "production-default" });

    // Dictionaries.
    ids["attrMaterial"] = await createAttribute("material", { inputType: "select" });
    await pool.query(
      `insert into attribute_option (attribute_id, code, label, position) values
         ($1, 'cotton', $2::jsonb, 0), ($1, 'linen', $3::jsonb, 1)`,
      [
        ids["attrMaterial"],
        JSON.stringify({ uk: "Бавовна", en: "Cotton" }),
        JSON.stringify({ uk: "Льон" }),
      ],
    );
    ids["attrCare"] = await createAttribute("care", { inputType: "text", isLocalized: true });
    ids["attrInternalNote"] = await createAttribute("internalnote", {
      inputType: "text",
      isInternal: true,
      isVisible: false,
    });
    ids["attrHiddenNote"] = await createAttribute("hiddennote", {
      inputType: "text",
      isVisible: false,
    });
    ids["attrUnassigned"] = await createAttribute("unassigned", {
      inputType: "text",
      isInternal: true,
      isVisible: false,
    });
    ids["attrWeight"] = await createAttribute("weight", {
      inputType: "number",
      unit: "g",
      isFilterable: true,
    });
    ids["attrVariantInternal"] = await createAttribute("varinternal", {
      inputType: "text",
      isInternal: true,
      isVisible: false,
    });
    ids["attrVariantHidden"] = await createAttribute("varhidden", {
      inputType: "text",
      isVisible: false,
    });

    ids["type"] = await insert(
      "insert into product_type (code, name) values ($1, $2::jsonb) returning id",
      [`type_${runId}`, JSON.stringify({ uk: "Тип", en: "Type" })],
    );
    const assignments: [string, string, number][] = [
      ["attrMaterial", "product", 0],
      ["attrCare", "product", 1],
      ["attrInternalNote", "product", 2],
      ["attrHiddenNote", "product", 3],
      ["attrWeight", "variant", 4],
      ["attrVariantInternal", "variant", 5],
      ["attrVariantHidden", "variant", 6],
    ];
    for (const [key, level, position] of assignments) {
      await pool.query(
        `insert into product_type_attribute (product_type_id, attribute_id, level, position)
         values ($1, $2, $3, $4)`,
        [ids["type"], ids[key], level, position],
      );
    }

    ids["optColor"] = await insert(
      "insert into option (code, name) values ($1, $2::jsonb) returning id",
      [`color_${runId}`, JSON.stringify({ uk: "Колір", en: "Color" })],
    );
    ids["optSize"] = await insert(
      "insert into option (code, name) values ($1, $2::jsonb) returning id",
      [`size_${runId}`, JSON.stringify({ uk: "Розмір" })],
    );
    const optionValues: [string, string, string, object][] = [
      ["valRed", "optColor", "red", { uk: "Червоний", en: "Red" }],
      ["valBlue", "optColor", "blue", { uk: "Синій", en: "Blue" }],
      ["valS", "optSize", "s", { uk: "S" }],
      ["valM", "optSize", "m", { uk: "M" }],
      ["valL", "optSize", "l", { uk: "L" }],
    ];
    let valuePosition = 0;
    for (const [key, optionKey, code, label] of optionValues) {
      ids[key] = await insert(
        `insert into option_value (option_id, code, label, position)
         values ($1, $2, $3::jsonb, $4) returning id`,
        [ids[optionKey], code, JSON.stringify(label), valuePosition],
      );
      valuePosition += 1;
    }

    ids["brandA"] = await insert(
      "insert into brand (slug, name) values ($1, $2::jsonb) returning id",
      [slug("brand-a"), JSON.stringify({ uk: "Бренд А", en: "Brand A" })],
    );
    ids["brandB"] = await insert(
      "insert into brand (slug, name) values ($1, $2::jsonb) returning id",
      [slug("brand-b"), JSON.stringify({ uk: "Бренд Б" })],
    );

    // Categories: root > alpha > grand; root > eta, zeta (same position, slug decides); root > inactive > underInactive;
    // inactiveRoot > underInactiveRoot.
    ids["root"] = await createCategory("root", null, { position: 9000 });
    ids["alpha"] = await createCategory("alpha", "root", {
      position: 0,
      description: { uk: "Опис альфа" },
    });
    ids["grand"] = await createCategory("grand", "alpha");
    ids["zeta"] = await createCategory("zeta", "root", { position: 1 });
    ids["eta"] = await createCategory("eta", "root", { position: 1 });
    ids["inactive"] = await createCategory("inactive", "root", { position: 2, isActive: false });
    ids["underInactive"] = await createCategory("under-inactive", "inactive");
    ids["inactiveRoot"] = await createCategory("inactive-root", null, {
      position: 9001,
      isActive: false,
    });
    ids["underInactiveRoot"] = await createCategory("under-inactive-root", "inactiveRoot");

    // P1: options color x size, one inactive variant, hostile JSONB, media, several categories.
    ids["p1"] = await createProduct("p1", {
      brand: "brandA",
      description: { uk: "Опис товару" },
      publishedDaysAgo: 1,
      attributes: {
        [attributeCode("material")]: "cotton",
        [attributeCode("care")]: { uk: "Прати при 30", en: "Wash at 30" },
        [attributeCode("internalnote")]: SECRET_INTERNAL,
        [attributeCode("hiddennote")]: SECRET_HIDDEN,
        [attributeCode("unassigned")]: SECRET_UNASSIGNED,
        [attributeCode("weight")]: 5,
        [attributeCode("varinternal")]: SECRET_WRONG_LEVEL,
        mystery_key: SECRET_UNKNOWN,
      },
    });
    await chooseOption("p1", "optColor", 0, ["valRed", "valBlue"]);
    await chooseOption("p1", "optSize", 1, ["valS", "valM", "valL"]);
    const variantAttributes = (weight: number): object => ({
      [attributeCode("weight")]: weight,
      [attributeCode("varinternal")]: SECRET_VARIANT_INTERNAL,
      [attributeCode("varhidden")]: SECRET_VARIANT_HIDDEN,
      [attributeCode("material")]: "cotton",
      variant_mystery: SECRET_UNKNOWN,
    });
    await createVariant("p1", "RED-M", {
      signature: `color_${runId}=red;size_${runId}=m`,
      position: 1,
      prices: [{ amount: 1500, compareAt: 1800 }],
      attributes: variantAttributes(181),
      optionValues: [
        ["optColor", "valRed"],
        ["optSize", "valM"],
      ],
    });
    await createVariant("p1", "RED-S", {
      signature: `color_${runId}=red;size_${runId}=s`,
      isDefault: true,
      position: 0,
      prices: [{ amount: 1200 }],
      attributes: variantAttributes(180),
      optionValues: [
        ["optColor", "valRed"],
        ["optSize", "valS"],
      ],
    });
    await createVariant("p1", "BLUE-S", {
      signature: `color_${runId}=blue;size_${runId}=s`,
      position: 2,
      prices: [{ amount: 1000 }],
      attributes: variantAttributes(182),
      optionValues: [
        ["optColor", "valBlue"],
        ["optSize", "valS"],
      ],
    });
    await createVariant("p1", "BLUE-L-INACTIVE", {
      signature: `color_${runId}=blue;size_${runId}=l`,
      isActive: false,
      position: 3,
      attributes: variantAttributes(183),
      optionValues: [
        ["optColor", "valBlue"],
        ["optSize", "valL"],
      ],
    });
    await addMedia("p1", "https://img.test/p1-red.jpg", 0, {
      optionKey: "optColor",
      valueKey: "valRed",
    });
    await addMedia("p1", "https://img.test/p1-gallery-1.jpg", 1, { alt: { uk: "Галерея" } });
    await addMedia("p1", "https://img.test/p1-gallery-2.jpg", 2);
    await assignCategory("p1", "grand", true);
    await assignCategory("p1", "inactive", false, 1);
    await assignCategory("p1", "underInactive", false, 2);

    // P2: simple product (one default variant, no options), title only in the default locale, no media.
    ids["p2"] = await createProduct("p2", {
      brand: "brandA",
      title: { uk: "Простий товар" },
      publishedDaysAgo: 2,
    });
    await createVariant("p2", "SIMPLE", { signature: "", isDefault: true, position: 0 });
    await assignCategory("p2", "eta", true);

    ids["p3Draft"] = await createProduct("p3-draft", {
      status: "draft",
      brand: "brandA",
      publishedDaysAgo: 0,
    });
    ids["p4Archived"] = await createProduct("p4-archived", {
      status: "archived",
      brand: "brandA",
      publishedDaysAgo: 0,
    });
    for (const key of ["p3Draft", "p4Archived"]) {
      await createVariant(key, `DRAFT-${key.toUpperCase()}`, {
        signature: "",
        isDefault: true,
        position: 0,
      });
      await assignCategory(key, "alpha", true);
    }

    // P5: only in a category under an inactive parent; brand B.
    ids["p5"] = await createProduct("p5", { brand: "brandB", publishedDaysAgo: 4 });
    await createVariant("p5", "P5", { signature: "", isDefault: true, position: 0 });
    await assignCategory("p5", "underInactive", true);

    ids["p6"] = await createProduct("p6", { brand: "brandA", publishedDaysAgo: 3 });
    await createVariant("p6", "P6", { signature: "", isDefault: true, position: 0 });
    await assignCategory("p6", "zeta", true);

    // P8 (ADR 0007): colour red (default variant) and blue (both blue variants inactive), sizes s and m.
    ids["p8"] = await createProduct("p8-hidden-value", { publishedDaysAgo: 10 });
    await chooseOption("p8", "optColor", 0, ["valRed", "valBlue"]);
    await chooseOption("p8", "optSize", 1, ["valS", "valM"]);
    await createVariant("p8", "H-RED-S", {
      signature: `color_${runId}=red;size_${runId}=s`,
      isDefault: true,
      position: 0,
      optionValues: [
        ["optColor", "valRed"],
        ["optSize", "valS"],
      ],
    });
    await createVariant("p8", "H-RED-M", {
      signature: `color_${runId}=red;size_${runId}=m`,
      position: 1,
      optionValues: [
        ["optColor", "valRed"],
        ["optSize", "valM"],
      ],
    });
    await createVariant("p8", "H-BLUE-S", {
      signature: `color_${runId}=blue;size_${runId}=s`,
      isActive: false,
      position: 2,
      optionValues: [
        ["optColor", "valBlue"],
        ["optSize", "valS"],
      ],
    });
    await createVariant("p8", "H-BLUE-M", {
      signature: `color_${runId}=blue;size_${runId}=m`,
      isActive: false,
      position: 3,
      optionValues: [
        ["optColor", "valBlue"],
        ["optSize", "valM"],
      ],
    });
    await addMedia("p8", "https://img.test/p8-red.jpg", 0, {
      optionKey: "optColor",
      valueKey: "valRed",
    });
    await addMedia("p8", "https://img.test/p8-blue.jpg", 1, {
      optionKey: "optColor",
      valueKey: "valBlue",
    });
    await addMedia("p8", "https://img.test/p8-gallery.jpg", 2);

    // P9 (ADR 0007): the colour option exists only on an inactive variant, so the whole option disappears.
    ids["p9"] = await createProduct("p9-hidden-option", { publishedDaysAgo: 11 });
    await chooseOption("p9", "optColor", 0, ["valRed"]);
    await chooseOption("p9", "optSize", 1, ["valS"]);
    await createVariant("p9", "O-S", {
      signature: `size_${runId}=s`,
      isDefault: true,
      position: 0,
      optionValues: [["optSize", "valS"]],
    });
    await createVariant("p9", "O-RED-S", {
      signature: `color_${runId}=red;size_${runId}=s`,
      isActive: false,
      position: 1,
      optionValues: [
        ["optColor", "valRed"],
        ["optSize", "valS"],
      ],
    });
    await addMedia("p9", "https://img.test/p9-red.jpg", 0, {
      optionKey: "optColor",
      valueKey: "valRed",
    });

    // P7: every image has an option pair, so the list image is the first image.
    ids["p7"] = await createProduct("p7-colour", { brand: "brandB", publishedDaysAgo: 9 });
    await chooseOption("p7", "optColor", 0, ["valRed"]);
    await createVariant("p7", "P7-RED", {
      signature: `color_${runId}=red`,
      isDefault: true,
      position: 0,
      optionValues: [["optColor", "valRed"]],
    });
    await addMedia("p7", "https://img.test/p7-red.jpg", 0, {
      optionKey: "optColor",
      valueKey: "valRed",
    });
  });

  afterAll(async () => {
    await running.app.close();
    // Products first (cascade to variants, option rows, media, category links), then what they referenced.
    await pool.query("delete from product where product_type_id = $1", [ids["type"]]);
    await pool.query("delete from product_type where id = $1", [ids["type"]]);
    await pool.query("delete from attribute where code like $1", [`%\\_${runId}`]);
    await pool.query("delete from option where code like $1", [`%\\_${runId}`]);
    await pool.query("delete from brand where slug like $1", [`%-${runId}`]);
    await pool.query("delete from location where code = $1", [`l${runId}`]);
    for (const key of [
      "underInactiveRoot",
      "inactiveRoot",
      "underInactive",
      "inactive",
      "grand",
      "zeta",
      "eta",
      "alpha",
      "root",
    ]) {
      await pool.query("delete from category where id = $1", [ids[key]]);
    }
    await pool.end();
  });

  describe("no authentication", () => {
    it("serves /store without credentials while /admin is denied by the production default", async () => {
      expect((await get("/store/categories")).status).toBe(200);
      expect((await get("/store/products")).status).toBe(200);
      expect((await get(`/store/products/${slug("p1")}`)).status).toBe(200);
      expect((await get("/admin/brands")).status).toBe(401);
    });

    it("is read-only: there are no write routes", async () => {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
        for (const path of ["/store/products", "/store/config"]) {
          const result = await http(running.baseUrl, method, path, { body: {} });
          expect(result.status, `${method} ${path}`).toBe(404);
        }
      }
    });
  });

  describe("GET /store/categories", () => {
    it("returns the active tree, ordered by position then slug, without inactive categories or their subtrees", async () => {
      const { items } = await getOk<{ items: StoreCategoryNode[] }>("/store/categories?locale=uk");
      const root = findNode(items, slug("root"));
      expect(root).toEqual({
        id: ids["root"],
        slug: slug("root"),
        name: "Категорія root",
        description: null,
        children: [
          {
            id: ids["alpha"],
            slug: slug("alpha"),
            name: "Категорія alpha",
            description: "Опис альфа",
            children: [
              {
                id: ids["grand"],
                slug: slug("grand"),
                name: "Категорія grand",
                description: null,
                children: [],
              },
            ],
          },
          expect.objectContaining({ slug: slug("eta") }),
          expect.objectContaining({ slug: slug("zeta") }),
        ],
      });
      // Inactive categories and everything below them are gone, wherever they sit.
      for (const hidden of ["inactive", "under-inactive", "inactive-root", "under-inactive-root"]) {
        expect(findNode(items, slug(hidden)), hidden).toBeUndefined();
      }
    });

    it("resolves texts per field: requested locale, falling back to the default locale", async () => {
      const { items } = await getOk<{ items: StoreCategoryNode[] }>("/store/categories?locale=en");
      const alpha = findNode(items, slug("alpha"));
      expect(alpha?.name).toBe("Category alpha");
      // The description exists only in uk: the en request falls back for this field only.
      expect(alpha?.description).toBe("Опис альфа");
    });

    it("answers 400 for an unknown locale", async () => {
      const result = await get("/store/categories?locale=de");
      expect(result.status).toBe(400);
      expect(result.headers.get("content-type")).toContain("application/problem+json");
      expect(problem(result).code).toBe("validation_failed");
      expect(problem(result).errors?.[0]?.path).toBe("locale");
    });
  });

  describe("GET /store/products", () => {
    it("lists only active products, newest first, with brand, image and publishedAt", async () => {
      const page = await getOk<Page<StoreProductListItem>>(
        `/store/products?brand=${slug("brand-a")}&locale=uk`,
      );
      expect(slugsOf(page)).toEqual([slug("p1"), slug("p2"), slug("p6")]);
      expect(page).toMatchObject({ total: 3, limit: 24, offset: 0 });
      const [first, second] = page.items;
      expect(first).toEqual({
        id: ids["p1"],
        slug: slug("p1"),
        title: "Товар p1",
        brand: { slug: slug("brand-a"), name: "Бренд А" },
        // The first gallery image wins over the colour image that has a lower position.
        image: { url: "https://img.test/p1-gallery-1.jpg", alt: "Галерея" },
        publishedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        price: { from: 1000, to: 1500, currency: "UAH" },
        availability: "in_stock",
      });
      expect(second?.image).toBeNull();
      expect(Object.keys(first ?? {}).sort()).toEqual(
        ["availability", "brand", "id", "image", "price", "publishedAt", "slug", "title"].sort(),
      );
    });

    it("falls back to the first image when every image has an option pair", async () => {
      const page = await getOk<Page<StoreProductListItem>>(
        `/store/products?brand=${slug("brand-b")}`,
      );
      expect(page.items.find((item) => item.id === ids["p7"])?.image).toEqual({
        url: "https://img.test/p7-red.jpg",
        alt: null,
      });
    });

    it("resolves texts per field in en: own value, else the default locale", async () => {
      const page = await getOk<Page<StoreProductListItem>>(
        `/store/products?brand=${slug("brand-a")}&locale=en`,
      );
      const byslug = new Map(page.items.map((item) => [item.slug, item]));
      expect(byslug.get(slug("p1"))?.title).toBe("Product p1");
      expect(byslug.get(slug("p1"))?.brand?.name).toBe("Brand A");
      // p2 has a uk title only.
      expect(byslug.get(slug("p2"))?.title).toBe("Простий товар");
    });

    it("never lists draft or archived products", async () => {
      const page = await getOk<Page<StoreProductListItem>>(
        `/store/products?category=${slug("alpha")}`,
      );
      expect(slugsOf(page)).toEqual([slug("p1")]);
      const byBrand = await getOk<Page<StoreProductListItem>>(
        `/store/products?brand=${slug("brand-a")}&limit=100`,
      );
      expect(slugsOf(byBrand)).not.toContain(slug("p3-draft"));
      expect(slugsOf(byBrand)).not.toContain(slug("p4-archived"));
    });

    it("filters by category including all active descendants", async () => {
      const byRoot = await getOk<Page<StoreProductListItem>>(
        `/store/products?category=${slug("root")}`,
      );
      // p1 sits in grand (below alpha), p2 in eta, p6 in zeta; p5 only in a category under an inactive parent.
      expect(slugsOf(byRoot)).toEqual([slug("p1"), slug("p2"), slug("p6")]);
      expect(byRoot.total).toBe(3);

      const byGrand = await getOk<Page<StoreProductListItem>>(
        `/store/products?category=${slug("grand")}`,
      );
      expect(slugsOf(byGrand)).toEqual([slug("p1")]);
      const byEta = await getOk<Page<StoreProductListItem>>(
        `/store/products?category=${slug("eta")}`,
      );
      expect(slugsOf(byEta)).toEqual([slug("p2")]);
    });

    it("gives an empty list, not an error, for an unknown, inactive or hidden category", async () => {
      for (const category of [
        slug("does-not-exist"),
        slug("inactive"),
        // Active itself, but its parent is inactive.
        slug("under-inactive"),
        slug("under-inactive-root"),
      ]) {
        const page = await getOk<Page<StoreProductListItem>>(
          `/store/products?category=${category}`,
        );
        expect(page, category).toEqual({ items: [], total: 0, limit: 24, offset: 0 });
      }
    });

    it("filters by brand and gives an empty list for an unknown brand", async () => {
      const page = await getOk<Page<StoreProductListItem>>(
        `/store/products?brand=${slug("brand-b")}`,
      );
      expect(slugsOf(page)).toEqual([slug("p5"), slug("p7-colour")]);
      const unknown = await getOk<Page<StoreProductListItem>>(
        `/store/products?brand=${slug("no-such-brand")}`,
      );
      expect(unknown.total).toBe(0);
      const both = await getOk<Page<StoreProductListItem>>(
        `/store/products?brand=${slug("brand-b")}&category=${slug("root")}`,
      );
      expect(both.items).toEqual([]);
    });

    it("paginates with limit and offset in a stable order", async () => {
      const filter = `brand=${slug("brand-a")}`;
      const pageOne = await getOk<Page<StoreProductListItem>>(
        `/store/products?${filter}&limit=2&offset=0`,
      );
      const pageTwo = await getOk<Page<StoreProductListItem>>(
        `/store/products?${filter}&limit=2&offset=2`,
      );
      expect(slugsOf(pageOne)).toEqual([slug("p1"), slug("p2")]);
      expect(slugsOf(pageTwo)).toEqual([slug("p6")]);
      expect(pageOne).toMatchObject({ total: 3, limit: 2, offset: 0 });
      expect(pageTwo).toMatchObject({ total: 3, limit: 2, offset: 2 });
      const beyond = await getOk<Page<StoreProductListItem>>(`/store/products?${filter}&offset=50`);
      expect(beyond).toMatchObject({ items: [], total: 3 });
    });

    it.each([
      ["limit=0"],
      ["limit=101"],
      ["limit=-1"],
      ["limit=abc"],
      ["offset=10001"],
      ["offset=-1"],
      ["offset=1.5"],
      ["unknown=1"],
    ])("answers 400 validation_failed for ?%s", async (query) => {
      const result = await get(`/store/products?${query}`);
      expect(result.status).toBe(400);
      expect(result.headers.get("content-type")).toContain("application/problem+json");
      expect(problem(result).code).toBe("validation_failed");
    });

    it.each([["brand"], ["category"]])(
      "answers 400 validation_failed for NUL and malformed text in ?%s without touching the database",
      async (name) => {
        const poolOfApp = running.app.get<pg.Pool>(PG_POOL, { strict: false });
        for (const raw of ["%00", "x%00y", "Upper", "a%20b", "-a", "a--b", "%FF"]) {
          const spy = vi.spyOn(poolOfApp, "query");
          try {
            const result = await get(`/store/products?${name}=${raw}`);
            expect(result.status, `${name}=${raw}`).toBe(400);
            expect(problem(result).code).toBe("validation_failed");
            expect(problem(result).errors?.[0]?.path).toBe(name);
            expect(spy, `${name}=${raw}`).not.toHaveBeenCalled();
          } finally {
            spy.mockRestore();
          }
        }
      },
    );

    it("keeps well-formed unknown slugs an empty list", async () => {
      for (const name of ["brand", "category"]) {
        const page = await getOk<Page<StoreProductListItem>>(
          `/store/products?${name}=${slug("unknown-thing")}`,
        );
        expect(page.items, name).toEqual([]);
      }
    });

    it("orders by published_at then id, newest first, id breaking ties", async () => {
      ids["brandC"] = await insert(
        "insert into brand (slug, name) values ($1, $2::jsonb) returning id",
        [slug("brand-c"), JSON.stringify({ uk: "Бренд Ц" })],
      );
      const insertTied = async (key: string, publishedAt: Date): Promise<string> => {
        const productId = await insert(
          `insert into product (product_type_id, brand_id, slug, title, status, published_at)
           values ($1, $2, $3, $4::jsonb, 'active', $5) returning id`,
          [ids["type"], ids["brandC"], slug(key), JSON.stringify({ uk: key }), publishedAt],
        );
        ids[key] = productId;
        await createVariant(key, key.toUpperCase(), {
          signature: "",
          isDefault: true,
          position: 0,
        });
        return productId;
      };
      const sameMoment = new Date(now - 20 * DAY_MS);
      const tied = [
        await insertTied("t1", sameMoment),
        await insertTied("t2", sameMoment),
        await insertTied("t3", sameMoment),
      ];
      await insertTied("newer", new Date(now - 19 * DAY_MS));
      const page = await getOk<Page<StoreProductListItem>>(
        `/store/products?brand=${slug("brand-c")}`,
      );
      expect(page.items.map((item) => item.slug)[0]).toBe(slug("newer"));
      expect(page.items.slice(1).map((item) => item.id)).toEqual([...tied].sort().reverse());
    });

    it("sorts through the status/published_at index (no Sort node in the plan)", async () => {
      const poolOfApp = running.app.get<pg.Pool>(PG_POOL, { strict: false });
      const spy = vi.spyOn(poolOfApp, "query");
      let statement: { text: string; values: unknown[] } | undefined;
      try {
        await getOk<Page<StoreProductListItem>>("/store/products?limit=5");
        for (const call of spy.mock.calls) {
          const first = call[0] as unknown;
          if (typeof first === "object" && first !== null && "text" in first) {
            const candidate = first as { text: string; values?: unknown[] };
            if (/order by/i.test(candidate.text) && /limit/i.test(candidate.text)) {
              statement = {
                text: candidate.text,
                values: (call[1] as unknown[] | undefined) ?? candidate.values ?? [],
              };
            }
          }
        }
      } finally {
        spy.mockRestore();
      }
      if (statement === undefined) {
        throw new Error("the list statement was not captured");
      }
      const client = await pool.connect();
      try {
        await client.query("begin");
        // Make the planner's choice depend on the index order, not on the size of the fixture.
        await client.query("set local enable_seqscan = off");
        await client.query("set local enable_bitmapscan = off");
        const plan = await client.query<{ "QUERY PLAN": string }>(
          `explain ${statement.text}`,
          statement.values,
        );
        const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
        expect(text).toContain("product_status_published_at_id_idx");
        expect(text).not.toMatch(/\bSort\b/);
      } finally {
        await client.query("rollback");
        client.release();
      }
    });

    it("accepts the documented bounds", async () => {
      expect((await get("/store/products?limit=100&offset=10000")).status).toBe(200);
      expect((await get("/store/products?limit=1&offset=0")).status).toBe(200);
    });

    it("answers 400 for an unknown locale", async () => {
      const result = await get("/store/products?locale=xx");
      expect(result.status).toBe(400);
      expect(problem(result).errors?.[0]?.path).toBe("locale");
    });
  });

  describe("GET /store/products/:slug", () => {
    it("returns the full product in uk", async () => {
      const product = await getOk<StoreProductDetail>(`/store/products/${slug("p1")}?locale=uk`);
      expect(product).toEqual({
        id: ids["p1"],
        slug: slug("p1"),
        title: "Товар p1",
        description: "Опис товару",
        brand: { slug: slug("brand-a"), name: "Бренд А" },
        publishedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        // Primary first; the inactive category and the one under it are not shown.
        categories: [{ id: ids["grand"], slug: slug("grand"), name: "Категорія grand" }],
        attributes: {
          [attributeCode("material")]: { code: "cotton", label: "Бавовна" },
          [attributeCode("care")]: "Прати при 30",
        },
        attributeDefinitions: [
          {
            code: attributeCode("material"),
            name: "Назва material",
            inputType: "select",
            isLocalized: false,
            unit: null,
            isFilterable: false,
            isComparable: false,
            isSortable: false,
            options: [
              { code: "cotton", label: "Бавовна" },
              { code: "linen", label: "Льон" },
            ],
          },
          {
            code: attributeCode("care"),
            name: "Назва care",
            inputType: "text",
            isLocalized: true,
            unit: null,
            isFilterable: false,
            isComparable: false,
            isSortable: false,
            options: [],
          },
        ],
        options: [
          {
            id: ids["optColor"],
            code: `color_${runId}`,
            name: "Колір",
            values: [
              { id: ids["valRed"], code: "red", name: "Червоний" },
              { id: ids["valBlue"], code: "blue", name: "Синій" },
            ],
          },
          {
            id: ids["optSize"],
            code: `size_${runId}`,
            name: "Розмір",
            // Only values of active variants, in the product's order (l is chosen but only used by an inactive variant: ADR 0007).
            values: [
              { id: ids["valS"], code: "s", name: "S" },
              { id: ids["valM"], code: "m", name: "M" },
            ],
          },
        ],
        variants: [
          {
            id: expect.stringMatching(UUID),
            sku: `${upper}-RED-S`,
            optionValues: [
              { optionCode: `color_${runId}`, valueCode: "red" },
              { optionCode: `size_${runId}`, valueCode: "s" },
            ],
            attributes: { [attributeCode("weight")]: { value: 180, unit: "g" } },
            price: { amount: 1200, currency: "UAH", compareAtAmount: null },
            availability: "in_stock",
          },
          {
            id: expect.stringMatching(UUID),
            sku: `${upper}-RED-M`,
            optionValues: [
              { optionCode: `color_${runId}`, valueCode: "red" },
              { optionCode: `size_${runId}`, valueCode: "m" },
            ],
            attributes: { [attributeCode("weight")]: { value: 181, unit: "g" } },
            price: { amount: 1500, currency: "UAH", compareAtAmount: 1800 },
            availability: "in_stock",
          },
          {
            id: expect.stringMatching(UUID),
            sku: `${upper}-BLUE-S`,
            optionValues: [
              { optionCode: `color_${runId}`, valueCode: "blue" },
              { optionCode: `size_${runId}`, valueCode: "s" },
            ],
            attributes: { [attributeCode("weight")]: { value: 182, unit: "g" } },
            price: { amount: 1000, currency: "UAH", compareAtAmount: null },
            availability: "in_stock",
          },
        ],
        media: [
          { url: "https://img.test/p1-red.jpg", alt: null, optionValueId: ids["valRed"] },
          { url: "https://img.test/p1-gallery-1.jpg", alt: "Галерея", optionValueId: null },
          { url: "https://img.test/p1-gallery-2.jpg", alt: null, optionValueId: null },
        ],
        price: { from: 1000, to: 1500, currency: "UAH" },
        availability: "in_stock",
      });
    });

    it("resolves texts per field in en and falls back to uk only where en is missing", async () => {
      const product = await getOk<StoreProductDetail>(`/store/products/${slug("p1")}?locale=en`);
      expect(product.title).toBe("Product p1");
      // Only uk exists for the description, the option "Розмір" and the size labels.
      expect(product.description).toBe("Опис товару");
      expect(product.brand?.name).toBe("Brand A");
      expect(product.attributes[attributeCode("material")]).toEqual({
        code: "cotton",
        label: "Cotton",
      });
      expect(product.attributes[attributeCode("care")]).toBe("Wash at 30");
      expect(product.attributeDefinitions[0]?.name).toBe("Name material");
      expect(product.attributeDefinitions[0]?.options).toEqual([
        { code: "cotton", label: "Cotton" },
        { code: "linen", label: "Льон" },
      ]);
      expect(product.options.map((option) => option.name)).toEqual(["Color", "Розмір"]);
      expect(product.options[0]?.values.map((value) => value.name)).toEqual(["Red", "Blue"]);
      expect(product.categories[0]?.name).toBe("Category grand");
    });

    it("uses the default locale when ?locale is missing", async () => {
      const product = await getOk<StoreProductDetail>(`/store/products/${slug("p1")}`);
      expect(product.title).toBe("Товар p1");
    });

    it("returns a simple product with one variant and no options", async () => {
      const product = await getOk<StoreProductDetail>(`/store/products/${slug("p2")}`);
      expect(product).toMatchObject({
        title: "Простий товар",
        description: null,
        options: [],
        media: [],
        attributes: {},
        categories: [{ slug: slug("eta") }],
      });
      expect(product.variants).toEqual([
        {
          id: expect.stringMatching(UUID),
          sku: `${upper}-SIMPLE`,
          optionValues: [],
          attributes: {},
          price: { amount: 1000, currency: "UAH", compareAtAmount: null },
          availability: "in_stock",
        },
      ]);
    });

    it("answers 404 not_found for draft, archived and unknown slugs", async () => {
      for (const missing of [slug("p3-draft"), slug("p4-archived"), slug("nope")]) {
        const result = await get(`/store/products/${missing}`);
        expect(result.status, missing).toBe(404);
        expect(result.headers.get("content-type")).toContain("application/problem+json");
        expect(problem(result).code).toBe("not_found");
      }
    });

    it("hides a category under an inactive parent from the product", async () => {
      const product = await getOk<StoreProductDetail>(`/store/products/${slug("p5")}`);
      expect(product.categories).toEqual([]);
    });

    it("answers 400 for an unknown locale and for unknown query parameters", async () => {
      expect((await get(`/store/products/${slug("p1")}?locale=zz`)).status).toBe(400);
      expect((await get(`/store/products/${slug("p1")}?limit=5`)).status).toBe(400);
    });

    it("hides option values and images that only deactivated variants use (ADR 0007)", async () => {
      const product = await getOk<StoreProductDetail>(`/store/products/${slug("p8-hidden-value")}`);
      expect(product.options).toEqual([
        {
          id: ids["optColor"],
          code: `color_${runId}`,
          name: "Колір",
          values: [{ id: ids["valRed"], code: "red", name: "Червоний" }],
        },
        {
          id: ids["optSize"],
          code: `size_${runId}`,
          name: "Розмір",
          values: [
            { id: ids["valS"], code: "s", name: "S" },
            { id: ids["valM"], code: "m", name: "M" },
          ],
        },
      ]);
      expect(product.variants.map((entry) => entry.sku)).toEqual([
        `${upper}-H-RED-S`,
        `${upper}-H-RED-M`,
      ]);
      expect(product.media).toEqual([
        { url: "https://img.test/p8-red.jpg", alt: null, optionValueId: ids["valRed"] },
        { url: "https://img.test/p8-gallery.jpg", alt: null, optionValueId: null },
      ]);
    });

    it("omits an option none of whose values is used by an active variant (ADR 0007)", async () => {
      const product = await getOk<StoreProductDetail>(
        `/store/products/${slug("p9-hidden-option")}`,
      );
      expect(product.options.map((entry) => entry.code)).toEqual([`size_${runId}`]);
      expect(product.media).toEqual([]);
      expect(product.variants.map((entry) => entry.sku)).toEqual([`${upper}-O-S`]);
    });

    it("keeps a value used by the default variant even when its other variants are inactive (ADR 0007)", async () => {
      // In p8, size s is used by the active default variant and by an inactive one.
      const product = await getOk<StoreProductDetail>(`/store/products/${slug("p8-hidden-value")}`);
      expect(product.options[1]?.values.map((value) => value.code)).toContain("s");
      const p9 = await getOk<StoreProductDetail>(`/store/products/${slug("p9-hidden-option")}`);
      expect(p9.options[0]?.values.map((value) => value.code)).toEqual(["s"]);
    });

    it.each([["%00"], ["nul%00"], ["p1%00x"], ["Upper"], ["a%20b"], ["a%2Fb"], ["-"]])(
      "answers 404 for the malformed slug %s without touching the database",
      async (raw) => {
        const poolOfApp = running.app.get<pg.Pool>(PG_POOL, { strict: false });
        const spy = vi.spyOn(poolOfApp, "query");
        try {
          const result = await get(`/store/products/${raw}`);
          expect(result.status).toBe(404);
          expect(problem(result).code).toBe("not_found");
          expect(spy).not.toHaveBeenCalled();
        } finally {
          spy.mockRestore();
        }
      },
    );

    it("never shows an inactive variant", async () => {
      const product = await getOk<StoreProductDetail>(`/store/products/${slug("p1")}`);
      expect(product.variants.map((variant) => variant.sku)).not.toContain(
        `${upper}-BLUE-L-INACTIVE`,
      );
      expect(product.variants).toHaveLength(3);
    });
  });

  describe("attribute leak tests (ADR 0006 section 10)", () => {
    it("never returns internal or storefront-hidden attributes, in values or definitions, even when stored", async () => {
      for (const locale of ["uk", "en"]) {
        const product = await getOk<StoreProductDetail>(
          `/store/products/${slug("p1")}?locale=${locale}`,
        );
        // Product level: exactly the two public attributes.
        expect(Object.keys(product.attributes).sort()).toEqual(
          [attributeCode("care"), attributeCode("material")].sort(),
        );
        expect(product.attributeDefinitions.map((definition) => definition.code)).toEqual([
          attributeCode("material"),
          attributeCode("care"),
        ]);
        // Variant level: only the weight; internal, hidden, wrong-level and unknown keys are dropped.
        for (const variant of product.variants) {
          expect(Object.keys(variant.attributes)).toEqual([attributeCode("weight")]);
        }
      }
    });

    it("keeps every stored secret out of the whole response body", async () => {
      const bodies = [
        await get(`/store/products/${slug("p1")}?locale=uk`),
        await get(`/store/products/${slug("p1")}?locale=en`),
        await get(`/store/products?brand=${slug("brand-a")}`),
        await get("/store/categories"),
      ].map((result) => JSON.stringify(result.body));
      for (const body of bodies) {
        for (const secret of ALL_SECRETS) {
          expect(body).not.toContain(secret);
        }
        expect(body).not.toContain(attributeCode("internalnote"));
        expect(body).not.toContain(attributeCode("hiddennote"));
        expect(body).not.toContain(attributeCode("unassigned"));
        expect(body).not.toContain(attributeCode("varinternal"));
        expect(body).not.toContain(attributeCode("varhidden"));
        expect(body).not.toContain("mystery");
      }
    });

    it("does not expose internal flags, validation or non-contract fields", async () => {
      const product = await getOk<StoreProductDetail>(`/store/products/${slug("p1")}`);
      const text = JSON.stringify(product);
      for (const forbidden of [
        "isInternal",
        "isSearchable",
        "isVisibleOnStorefront",
        "validation",
        "optionSignature",
        "option_signature",
        "isDefault",
        "barcode",
        "position",
        "status",
        "createdAt",
        "updatedAt",
      ]) {
        expect(text, forbidden).not.toContain(`"${forbidden}"`);
      }
      expect(Object.keys(product).sort()).toEqual(
        [
          "attributeDefinitions",
          "attributes",
          "availability",
          "brand",
          "categories",
          "description",
          "id",
          "media",
          "options",
          "price",
          "publishedAt",
          "slug",
          "title",
          "variants",
        ].sort(),
      );
    });

    it("does not show an attribute that was public but became hidden or internal", async () => {
      // Flip the flags on the live row: the response must follow the definition, not the stored value.
      await pool.query("update attribute set is_visible_on_storefront = false where code = $1", [
        attributeCode("care"),
      ]);
      try {
        const product = await getOk<StoreProductDetail>(`/store/products/${slug("p1")}`);
        expect(product.attributes).not.toHaveProperty(attributeCode("care"));
        expect(product.attributeDefinitions.map((definition) => definition.code)).toEqual([
          attributeCode("material"),
        ]);
      } finally {
        await pool.query("update attribute set is_visible_on_storefront = true where code = $1", [
          attributeCode("care"),
        ]);
      }
    });
  });

  describe("prices and availability", () => {
    const THRESHOLD = 5;
    // Distinct numbers that must never appear in a response (stock and non-shop prices).
    const SECRET_ON_HAND = 7341;
    const SECRET_RESERVED = 2113;
    const SECRET_USD_AMOUNT = 90817;
    const SECRET_USD_COMPARE_AT = 90999;
    let secondLocation = "";
    let otherApp: RunningApp | undefined;

    const idOf = (key: string): string => {
      const value = ids[key];
      if (value === undefined) {
        throw new Error(`fixture "${key}" was not created`);
      }
      return value;
    };
    const detail = (key: string): Promise<StoreProductDetail> =>
      getOk<StoreProductDetail>(`/store/products/${slug(key)}`);
    const variantsBySku = (product: StoreProductDetail) =>
      new Map(product.variants.map((entry) => [entry.sku.replace(`${upper}-`, ""), entry]));
    const brandPage = (brand: string): Promise<Page<StoreProductListItem>> =>
      getOk<Page<StoreProductListItem>>(`/store/products?brand=${slug(brand)}&limit=100`);

    beforeAll(async () => {
      ids["brandP"] = await insert(
        "insert into brand (slug, name) values ($1, $2::jsonb) returning id",
        [slug("brand-p"), JSON.stringify({ uk: "Бренд П" })],
      );
      secondLocation = `l${runId}`;
      ids["location2"] = await insertLocation(pool, secondLocation);

      // price-mix: sellable variants A, B, E; hidden: priceless C, USD-only D, inactive F.
      ids["priceMix"] = await createProduct("price-mix", { brand: "brandP", publishedDaysAgo: 30 });
      await createVariant("priceMix", "MIX-A", {
        signature: "a",
        isDefault: true,
        position: 0,
        prices: [{ amount: 1500 }],
      });
      await createVariant("priceMix", "MIX-B", {
        signature: "b",
        position: 1,
        prices: [{ amount: 2000, compareAt: 2500 }],
      });
      await createVariant("priceMix", "MIX-C-PRICELESS", {
        signature: "c",
        position: 2,
        prices: [],
      });
      await createVariant("priceMix", "MIX-D-USD-ONLY", {
        signature: "d",
        position: 3,
        prices: [{ currency: "USD", amount: SECRET_USD_AMOUNT, compareAt: SECRET_USD_COMPARE_AT }],
      });
      await createVariant("priceMix", "MIX-E", {
        signature: "e",
        position: 4,
        prices: [
          { currency: "USD", amount: SECRET_USD_AMOUNT },
          { currency: "UAH", amount: 3000 },
        ],
      });
      await createVariant("priceMix", "MIX-F-INACTIVE", {
        signature: "f",
        isActive: false,
        position: 5,
        prices: [{ amount: 1 }],
      });

      // No sellable variant at all: priceless, USD-only and inactive-but-priced.
      ids["noSellable"] = await createProduct("no-sellable", {
        brand: "brandP",
        publishedDaysAgo: 31,
      });
      await createVariant("noSellable", "NS-PRICELESS", {
        signature: "a",
        isDefault: true,
        position: 0,
        prices: [],
      });
      await createVariant("noSellable", "NS-USD", {
        signature: "b",
        position: 1,
        prices: [{ currency: "USD", amount: SECRET_USD_AMOUNT }],
      });
      await createVariant("noSellable", "NS-INACTIVE", {
        signature: "c",
        isActive: false,
        position: 2,
      });

      // Amounts at the limit stay exact in JSON.
      ids["maxPrice"] = await createProduct("max-price", { brand: "brandP", publishedDaysAgo: 32 });
      await createVariant("maxPrice", "MAX", {
        signature: "",
        isDefault: true,
        position: 0,
        prices: [{ amount: MAX_AMOUNT - 1, compareAt: MAX_AMOUNT }],
      });

      // ADR 0007 with prices: blue is carried only by a priceless variant, so it is not offered.
      ids["pricedOptions"] = await createProduct("priced-options", {
        brand: "brandP",
        publishedDaysAgo: 33,
      });
      await chooseOption("pricedOptions", "optColor", 0, ["valRed", "valBlue"]);
      await chooseOption("pricedOptions", "optSize", 1, ["valS", "valM"]);
      await createVariant("pricedOptions", "PO-RED-S", {
        signature: `color_${runId}=red;size_${runId}=s`,
        isDefault: true,
        position: 0,
        optionValues: [
          ["optColor", "valRed"],
          ["optSize", "valS"],
        ],
      });
      await createVariant("pricedOptions", "PO-BLUE-M", {
        signature: `color_${runId}=blue;size_${runId}=m`,
        position: 1,
        prices: [],
        optionValues: [
          ["optColor", "valBlue"],
          ["optSize", "valM"],
        ],
      });
      await addMedia("pricedOptions", "https://img.test/po-red.jpg", 0, {
        optionKey: "optColor",
        valueKey: "valRed",
      });
      await addMedia("pricedOptions", "https://img.test/po-blue.jpg", 1, {
        optionKey: "optColor",
        valueKey: "valBlue",
      });

      // Availability of one variant each (threshold 5).
      ids["stock"] = await createProduct("stock", { brand: "brandP", publishedDaysAgo: 34 });
      const tracked = { trackInventory: true } as const;
      const stockVariants: [
        string,
        Omit<Parameters<typeof createVariant>[2], "signature" | "position">,
      ][] = [
        ["ST-100", { ...tracked, stock: [{ onHand: 100 }] }],
        ["ST-6", { ...tracked, stock: [{ onHand: THRESHOLD + 1 }] }],
        ["ST-5", { ...tracked, stock: [{ onHand: THRESHOLD }] }],
        ["ST-1", { ...tracked, stock: [{ onHand: 1 }] }],
        ["ST-0", { ...tracked, stock: [{ onHand: 0 }] }],
        ["ST-NOLEVEL", { ...tracked }],
        ["ST-RESERVED-LOW", { ...tracked, stock: [{ onHand: 10, reserved: 7 }] }],
        ["ST-RESERVED-ALL", { ...tracked, stock: [{ onHand: 10, reserved: 10 }] }],
        [
          "ST-TWO-LOCATIONS",
          { ...tracked, stock: [{ onHand: 3 }, { onHand: 3, location: "location2" }] },
        ],
        ["ST-UNTRACKED-EMPTY", { trackInventory: false, stock: [{ onHand: 0 }] }],
        ["ST-UNTRACKED-NOLEVEL", { trackInventory: false }],
        ["ST-BACKORDER", { ...tracked, allowBackorder: true, stock: [{ onHand: 0 }] }],
        [
          "ST-SECRET",
          {
            ...tracked,
            stock: [{ onHand: SECRET_ON_HAND, reserved: SECRET_RESERVED }],
          },
        ],
      ];
      let position = 0;
      for (const [sku, values] of stockVariants) {
        await createVariant("stock", sku, { signature: sku.toLowerCase(), position, ...values });
        position += 1;
      }

      // Product-level availability: best of the sellable variants.
      const rule = async (
        key: string,
        variants: Omit<Parameters<typeof createVariant>[2], "signature" | "position">[],
        days: number,
      ): Promise<void> => {
        ids[key] = await createProduct(key, { brand: "brandP", publishedDaysAgo: days });
        let index = 0;
        for (const values of variants) {
          await createVariant(key, `${key}-${index}`.toUpperCase(), {
            signature: `v${index}`,
            position: index,
            ...values,
          });
          index += 1;
        }
      };
      const outOfStock = { trackInventory: true, stock: [{ onHand: 0 }] };
      const low = { trackInventory: true, stock: [{ onHand: 2 }] };
      const inStock = { trackInventory: true, stock: [{ onHand: 50 }] };
      await rule("rule-all-out", [outOfStock, outOfStock], 35);
      await rule("rule-out-low", [outOfStock, low], 36);
      await rule("rule-low-in", [low, inStock, outOfStock], 37);
      // The only in-stock variant is priceless, so it does not count: the product is out of stock.
      await rule("rule-hidden-in", [outOfStock, { ...inStock, prices: [] }], 38);
    });

    afterAll(async () => {
      await otherApp?.app.close();
    });

    describe("variants without a shop-currency price", () => {
      it("returns only active variants priced in the shop currency, in order", async () => {
        const product = await detail("price-mix");
        expect(product.variants.map((entry) => entry.sku)).toEqual([
          `${upper}-MIX-A`,
          `${upper}-MIX-B`,
          `${upper}-MIX-E`,
        ]);
      });

      it("shows price amounts as integers in minor units with the compare-at price or null", async () => {
        const variants = variantsBySku(await detail("price-mix"));
        expect(variants.get("MIX-A")?.price).toEqual({
          amount: 1500,
          currency: "UAH",
          compareAtAmount: null,
        });
        expect(variants.get("MIX-B")?.price).toEqual({
          amount: 2000,
          currency: "UAH",
          compareAtAmount: 2500,
        });
        // The USD price of E is ignored, never converted or mixed in.
        expect(variants.get("MIX-E")?.price).toEqual({
          amount: 3000,
          currency: "UAH",
          compareAtAmount: null,
        });
      });

      it("takes from and to over the sellable variants only (list and detail agree)", async () => {
        const product = await detail("price-mix");
        expect(product.price).toEqual({ from: 1500, to: 3000, currency: "UAH" });
        const listed = (await brandPage("brand-p")).items.find(
          (item) => item.id === ids["priceMix"],
        );
        expect(listed?.price).toEqual({ from: 1500, to: 3000, currency: "UAH" });
      });

      it("does not list a product without a sellable variant and answers 404 for its detail", async () => {
        const page = await brandPage("brand-p");
        expect(page.items.map((item) => item.id)).not.toContain(ids["noSellable"]);
        const result = await get(`/store/products/${slug("no-sellable")}`);
        expect(result.status).toBe(404);
        expect(problem(result).code).toBe("not_found");
      });

      it("keeps total and pagination consistent with the products that are shown", async () => {
        const all = await brandPage("brand-p");
        expect(all.total).toBe(all.items.length);
        const first = await getOk<Page<StoreProductListItem>>(
          `/store/products?brand=${slug("brand-p")}&limit=2&offset=0`,
        );
        const second = await getOk<Page<StoreProductListItem>>(
          `/store/products?brand=${slug("brand-p")}&limit=2&offset=2`,
        );
        expect(first.total).toBe(all.total);
        expect([...first.items, ...second.items].map((item) => item.id)).toEqual(
          all.items.slice(0, 4).map((item) => item.id),
        );
      });

      it("a product becomes visible when its priceless variant gets a shop price, and hidden when it loses it", async () => {
        const target = ids["variant:NS-PRICELESS"];
        await pool.query(
          "insert into price (variant_id, currency, amount) values ($1, 'UAH', 4200)",
          [target],
        );
        try {
          const product = await detail("no-sellable");
          expect(product.variants.map((entry) => entry.sku)).toEqual([`${upper}-NS-PRICELESS`]);
          expect(product.price).toEqual({ from: 4200, to: 4200, currency: "UAH" });
          expect((await brandPage("brand-p")).items.map((item) => item.id)).toContain(
            ids["noSellable"],
          );
        } finally {
          await pool.query("delete from price where variant_id = $1 and currency = 'UAH'", [
            target,
          ]);
        }
        expect((await get(`/store/products/${slug("no-sellable")}`)).status).toBe(404);
      });

      it("does not offer option values or images carried only by priceless variants (ADR 0007)", async () => {
        const product = await detail("priced-options");
        expect(product.variants.map((entry) => entry.sku)).toEqual([`${upper}-PO-RED-S`]);
        expect(
          product.options.map((entry) => [entry.code, entry.values.map((value) => value.code)]),
        ).toEqual([
          [`color_${runId}`, ["red"]],
          [`size_${runId}`, ["s"]],
        ]);
        expect(product.media.map((entry) => entry.url)).toEqual(["https://img.test/po-red.jpg"]);
      });

      it("keeps amounts near the limit exact in the JSON text", async () => {
        const result = await get(`/store/products/${slug("max-price")}`);
        const text = JSON.stringify(result.body);
        expect(text).toContain(`"amount":${MAX_AMOUNT - 1}`);
        expect(text).toContain(`"compareAtAmount":${MAX_AMOUNT}`);
        const product = result.body as StoreProductDetail;
        expect(product.price).toEqual({
          from: MAX_AMOUNT - 1,
          to: MAX_AMOUNT - 1,
          currency: "UAH",
        });
        expect(Number.isSafeInteger(product.variants[0]?.price.compareAtAmount)).toBe(true);
      });
    });

    describe("availability", () => {
      const expectations: [string, string][] = [
        ["ST-100", "in_stock"],
        ["ST-6", "in_stock"],
        ["ST-5", "low_stock"],
        ["ST-1", "low_stock"],
        ["ST-0", "out_of_stock"],
        ["ST-NOLEVEL", "out_of_stock"],
        ["ST-RESERVED-LOW", "low_stock"],
        ["ST-RESERVED-ALL", "out_of_stock"],
        ["ST-TWO-LOCATIONS", "in_stock"],
        ["ST-UNTRACKED-EMPTY", "in_stock"],
        ["ST-UNTRACKED-NOLEVEL", "in_stock"],
        ["ST-BACKORDER", "in_stock"],
        ["ST-SECRET", "in_stock"],
      ];

      it.each(expectations)("variant %s is %s", async (sku, expected) => {
        const variants = variantsBySku(await detail("stock"));
        expect(variants.get(sku)?.availability).toBe(expected);
      });

      it("gives a product the best availability among its sellable variants (in_stock > low_stock > out_of_stock)", async () => {
        const page = await brandPage("brand-p");
        const byId = new Map(page.items.map((item) => [item.id, item]));
        const detailOf = async (key: string) => (await detail(key)).availability;
        expect(byId.get(idOf("rule-all-out"))?.availability).toBe("out_of_stock");
        expect(byId.get(idOf("rule-out-low"))?.availability).toBe("low_stock");
        expect(byId.get(idOf("rule-low-in"))?.availability).toBe("in_stock");
        expect(byId.get(idOf("rule-hidden-in"))?.availability).toBe("out_of_stock");
        expect(await detailOf("rule-all-out")).toBe("out_of_stock");
        expect(await detailOf("rule-out-low")).toBe("low_stock");
        expect(await detailOf("rule-low-in")).toBe("in_stock");
        expect(await detailOf("rule-hidden-in")).toBe("out_of_stock");
        // The stock product has an in-stock variant.
        expect(byId.get(idOf("stock"))?.availability).toBe("in_stock");
      });

      it("still lists a product whose sellable variants are all out of stock", async () => {
        const page = await brandPage("brand-p");
        expect(page.items.map((item) => item.id)).toContain(ids["rule-all-out"]);
      });

      it("reflects a change of stock at once", async () => {
        const target = ids["variant:ST-0"];
        await pool.query("update inventory_level set on_hand = 50 where variant_id = $1", [target]);
        try {
          expect(variantsBySku(await detail("stock")).get("ST-0")?.availability).toBe("in_stock");
        } finally {
          await pool.query("update inventory_level set on_hand = 0 where variant_id = $1", [
            target,
          ]);
        }
      });
    });

    describe("configuration: threshold, shop currency, GET /store/config", () => {
      it("returns exactly the documented settings", async () => {
        const config = await getOk<Record<string, unknown>>("/store/config");
        expect(config).toEqual({
          currency: "UAH",
          currencyExponent: 2,
          pricesIncludeTax: true,
          defaultLocale: "uk",
          locales: ["uk", "en"],
          emailDelivery: false,
          onlinePayment: false,
        });
      });

      it("follows the configured shop currency (exponent from core) and tax flag", async () => {
        const jpy = await startApp({ shopCurrency: "JPY", pricesIncludeTax: false });
        try {
          const result = await http(jpy.baseUrl, "GET", "/store/config");
          expect(result.status).toBe(200);
          expect(result.body).toEqual({
            currency: "JPY",
            currencyExponent: 0,
            pricesIncludeTax: false,
            defaultLocale: "uk",
            locales: ["uk", "en"],
            emailDelivery: false,
            onlinePayment: false,
          });
        } finally {
          await jpy.app.close();
        }
      });

      it("uses the configured low stock threshold", async () => {
        otherApp = await startApp({ lowStockThreshold: 1 });
        const result = await http<StoreProductDetail>(
          otherApp.baseUrl,
          "GET",
          `/store/products/${slug("stock")}`,
        );
        const variants = variantsBySku(result.body);
        // Threshold 1: one unit is low, five units are no longer low.
        expect(variants.get("ST-1")?.availability).toBe("low_stock");
        expect(variants.get("ST-5")?.availability).toBe("in_stock");
        expect(variants.get("ST-RESERVED-LOW")?.availability).toBe("in_stock");
      });

      it("prices and hides variants by the configured shop currency", async () => {
        const usd = await startApp({ shopCurrency: "USD" });
        try {
          const product = await http<StoreProductDetail>(
            usd.baseUrl,
            "GET",
            `/store/products/${slug("price-mix")}`,
          );
          expect(product.status).toBe(200);
          expect(product.body.variants.map((entry) => entry.sku)).toEqual([
            `${upper}-MIX-D-USD-ONLY`,
            `${upper}-MIX-E`,
          ]);
          expect(product.body.variants[0]?.price).toEqual({
            amount: SECRET_USD_AMOUNT,
            currency: "USD",
            compareAtAmount: SECRET_USD_COMPARE_AT,
          });
          // The UAH-only products are gone in a USD shop.
          const hidden = await http(usd.baseUrl, "GET", `/store/products/${slug("max-price")}`);
          expect(hidden.status).toBe(404);
        } finally {
          await usd.app.close();
        }
      });
    });

    describe("leaks", () => {
      const FORBIDDEN_KEYS = [
        "onHand",
        "on_hand",
        "reserved",
        "available",
        "quantity",
        "stock",
        "location",
        "locationId",
        "location_id",
        "locations",
        "movement",
        "movements",
        "reservation",
        "reservations",
        "inventory",
        "inventoryLevel",
        "trackInventory",
        "track_inventory",
        "allowBackorder",
        "allow_backorder",
        "priceId",
        "prices",
        "createdAt",
        "updatedAt",
        "created_at",
        "updated_at",
        "lowStockThreshold",
        "threshold",
      ];

      /** Every JSON number in the body: a substring search would match digits inside ids and timestamps. */
      function collectNumbers(value: unknown, into: Set<number> = new Set()): Set<number> {
        if (typeof value === "number") {
          into.add(value);
        } else if (Array.isArray(value)) {
          for (const entry of value) {
            collectNumbers(entry, into);
          }
        } else if (typeof value === "object" && value !== null) {
          for (const entry of Object.values(value)) {
            collectNumbers(entry, into);
          }
        }
        return into;
      }

      function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
        if (Array.isArray(value)) {
          for (const entry of value) {
            collectKeys(entry, into);
          }
        } else if (typeof value === "object" && value !== null) {
          for (const [key, entry] of Object.entries(value)) {
            into.add(key);
            collectKeys(entry, into);
          }
        }
        return into;
      }

      it("never exposes quantities, locations, flags, price ids, timestamps or other currencies on any store route", async () => {
        const responses = [
          await get("/store/categories"),
          await get("/store/config"),
          await get(`/store/products?brand=${slug("brand-p")}&limit=100`),
          await get("/store/products?limit=100"),
          await get(`/store/products/${slug("stock")}`),
          await get(`/store/products/${slug("price-mix")}`),
          await get(`/store/products/${slug("priced-options")}`),
          await get(`/store/products/${slug("max-price")}`),
          await get(`/store/products/${slug("p1")}`),
        ];
        for (const response of responses) {
          expect(response.status).toBe(200);
          const text = JSON.stringify(response.body);
          const keys = collectKeys(response.body);
          for (const forbidden of FORBIDDEN_KEYS) {
            expect(keys.has(forbidden), `key ${forbidden}`).toBe(false);
          }
          const numbers = collectNumbers(response.body);
          for (const secret of [
            SECRET_ON_HAND,
            SECRET_RESERVED,
            SECRET_USD_AMOUNT,
            SECRET_USD_COMPARE_AT,
          ]) {
            expect(numbers.has(secret), `number ${secret}`).toBe(false);
          }
          for (const secret of [secondLocation, "USD"]) {
            expect(text, `value ${secret}`).not.toContain(secret);
          }
        }
      });

      it("limits each shape to the documented keys", async () => {
        const product = await detail("price-mix");
        expect(Object.keys(product.price).sort()).toEqual(["currency", "from", "to"]);
        for (const entry of product.variants) {
          expect(Object.keys(entry).sort()).toEqual(
            ["attributes", "availability", "id", "optionValues", "price", "sku"].sort(),
          );
          expect(Object.keys(entry.price).sort()).toEqual([
            "amount",
            "compareAtAmount",
            "currency",
          ]);
        }
        const page = await brandPage("brand-p");
        expect(page.items.length).toBeGreaterThan(0);
        for (const entry of page.items) {
          expect(Object.keys(entry.price).sort()).toEqual(["currency", "from", "to"]);
          for (const value of [entry.price.from, entry.price.to]) {
            expect(Number.isSafeInteger(value)).toBe(true);
          }
        }
      });

      it("keeps the is_internal attribute regression green next to the new fields", async () => {
        const text = JSON.stringify(await detail("p1"));
        expect(text).not.toContain(SECRET_INTERNAL);
        expect(text).not.toContain(attributeCode("internalnote"));
      });
    });
  });

  describe("query count (no N+1)", () => {
    async function countStatements(path: string): Promise<number> {
      const poolOfApp = running.app.get<pg.Pool>(PG_POOL, { strict: false });
      const spy = vi.spyOn(poolOfApp, "query");
      try {
        const result = await get(path);
        expect(result.status, path).toBe(200);
        return spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    }

    it("issues the same number of statements for a small and a large product", async () => {
      const small = await countStatements(`/store/products/${slug("p2")}`);
      // A product with 12 variants, 12 images and 2 options.
      ids["pBig"] = await createProduct("p-big", { publishedDaysAgo: 8 });
      await chooseOption("pBig", "optColor", 0, ["valRed", "valBlue"]);
      await chooseOption("pBig", "optSize", 1, ["valS", "valM", "valL"]);
      let position = 0;
      for (const colour of ["Red", "Blue"]) {
        for (const size of ["S", "M", "L"]) {
          await createVariant("pBig", `BIG-${colour}-${size}`.toUpperCase(), {
            signature: `color_${runId}=${colour.toLowerCase()};size_${runId}=${size.toLowerCase()}`,
            isDefault: position === 0,
            position,
            attributes: { [attributeCode("weight")]: 100 + position },
            prices: [{ amount: 1000 + position }, { amount: 50 + position, currency: "USD" }],
            trackInventory: true,
            stock: [{ onHand: 10 + position }, { onHand: 1, location: "location2" }],
            optionValues: [
              ["optColor", `val${colour}`],
              ["optSize", `val${size}`],
            ],
          });
          position += 1;
        }
      }
      for (let index = 0; index < 12; index += 1) {
        await addMedia("pBig", `https://img.test/big-${index}.jpg`, index);
      }
      await assignCategory("pBig", "eta", true);
      await assignCategory("pBig", "zeta", false);
      const large = await countStatements(`/store/products/${slug("p-big")}`);
      expect(small).toBeGreaterThan(0);
      expect(large).toBe(small);
      // A fixed budget: nothing may be issued per variant, option, image or category.
      expect(large).toBeLessThanOrEqual(10);
    });

    it("issues the same number of statements for a page of one and a page of many products", async () => {
      const one = await countStatements(`/store/products?brand=${slug("brand-a")}&limit=1`);
      const many = await countStatements(`/store/products?brand=${slug("brand-a")}&limit=100`);
      expect(one).toBeGreaterThan(0);
      expect(many).toBe(one);
      // Products with several priced variants and stock levels in two locations.
      const priced = await countStatements(`/store/products?brand=${slug("brand-p")}&limit=100`);
      const pricedOne = await countStatements(`/store/products?brand=${slug("brand-p")}&limit=1`);
      expect(priced).toBe(pricedOne);
      const withCategory = await countStatements(`/store/products?category=${slug("root")}`);
      const withCategoryOne = await countStatements(
        `/store/products?category=${slug("root")}&limit=1`,
      );
      expect(withCategory).toBe(withCategoryOne);
    });

    it("reads the category tree with one statement", async () => {
      expect(await countStatements("/store/categories")).toBe(1);
    });
  });
});
