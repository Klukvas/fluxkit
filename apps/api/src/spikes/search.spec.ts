import { Meilisearch, type Index } from "meilisearch";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireEnv } from "../test/env.js";

/**
 * Spike (plan step 6): how Meilisearch behaves for Ukrainian catalog search, variant-level filters and facets.
 * Findings are summarized in docs/adr/0005-search-notes.md. Tests marked KNOWN LIMITATION assert today's behavior
 * on purpose: if an engine upgrade changes it, the test fails and the notes must be revisited.
 */
const variants = [
  {
    id: "v1",
    productId: "p1",
    title: "Футболка Basic",
    description: "Базова футболка з бавовни",
    brand: "Nordic",
    size: "M",
    color: "білий",
    price: 1990,
    inStock: true,
  },
  {
    id: "v2",
    productId: "p1",
    title: "Футболка Basic",
    description: "Базова футболка з бавовни",
    brand: "Nordic",
    size: "L",
    color: "чорний",
    price: 2490,
    inStock: true,
  },
  {
    id: "v3",
    productId: "p1",
    title: "Футболка Basic",
    description: "Базова футболка з бавовни",
    brand: "Nordic",
    size: "S",
    color: "білий",
    price: 1990,
    inStock: false,
  },
  {
    id: "v4",
    productId: "p2",
    title: "Сорочка чоловіча класична",
    description: "Класична сорочка з довгим рукавом",
    brand: "Nordic",
    size: "M",
    color: "блакитний",
    price: 3500,
    inStock: true,
  },
  {
    id: "v5",
    productId: "p2",
    title: "Сорочка чоловіча класична",
    description: "Класична сорочка з довгим рукавом",
    brand: "Nordic",
    size: "L",
    color: "білий",
    price: 2800,
    inStock: true,
  },
  {
    id: "v6",
    productId: "p3",
    title: "Викрутка хрестова PH2",
    description: "Хрестова викрутка для гвинтів",
    brand: "Stanley",
    length: 100,
    price: 250,
    inStock: true,
  },
  {
    id: "v7",
    productId: "p4",
    title: "Відвертка плоска SL5",
    description: "Плоска відвертка зі зміцненим жалом",
    brand: "Bosch",
    length: 150,
    price: 310,
    inStock: true,
  },
  {
    id: "v8",
    productId: "p5",
    title: "М'ясо яловичини охолоджене",
    description: "Мʼясо найвищої якості",
    brand: "Ферма",
    price: 420,
    inStock: true,
  },
  {
    id: "v9",
    productId: "p6",
    title: "Рукавички зимові",
    description: "Теплі зимові рукавички",
    brand: "Nordic",
    size: "M",
    price: 600,
    inStock: true,
  },
];

const client = new Meilisearch({
  host: requireEnv("MEILI_URL"),
  apiKey: requireEnv("MEILI_MASTER_KEY"),
});
const suffix = `${Date.now()}`;
const created: string[] = [];

async function createIndex(
  name: string,
  settings: Record<string, unknown>,
  documents: object[],
): Promise<Index> {
  const uid = `spike_${name}_${suffix}`;
  created.push(uid);
  await client.tasks.waitForTask((await client.createIndex(uid, { primaryKey: "id" })).taskUid);
  const index = client.index(uid);
  await client.tasks.waitForTask((await index.updateSettings(settings)).taskUid);
  await client.tasks.waitForTask((await index.addDocuments(documents)).taskUid);
  return index;
}

const catalogSettings = {
  searchableAttributes: ["title", "description", "brand"],
  filterableAttributes: ["brand", "size", "color", "price", "inStock", "length", "productId"],
  sortableAttributes: ["price"],
  distinctAttribute: "productId",
};

describe("Meilisearch spike", () => {
  let catalog: Index;

  beforeAll(async () => {
    catalog = await createIndex("catalog", catalogSettings, variants);
  });

  afterAll(async () => {
    for (const uid of created) {
      await client.tasks.waitForTask((await client.deleteIndex(uid)).taskUid);
    }
  });

  async function productIds(query: string, options: object = {}): Promise<string[]> {
    const result = await catalog.search(query, options);
    return result.hits.map((hit) => hit.productId as string);
  }

  describe("Ukrainian text", () => {
    it("tolerates typos, prefixes and apostrophe variants", async () => {
      expect(await productIds("футбока")).toEqual(["p1"]);
      expect(await productIds("відветка")).toEqual(["p4"]);
      expect(await productIds("футб")).toEqual(["p1"]);
      for (const query of ["м'ясо", "мʼясо", "мясо"]) {
        expect(await productIds(query)).toEqual(["p5"]);
      }
    });

    it("matches close inflections through typo tolerance (plural, accusative)", async () => {
      expect(await productIds("футболки")).toEqual(["p1"]);
      expect(await productIds("футболку")).toEqual(["p1"]);
      expect(await productIds("сорочку")).toEqual(["p2"]);
    });

    it("KNOWN LIMITATION: no Ukrainian lemmatization - inflections with changed stems or adjective endings find nothing", async () => {
      expect(await productIds("сорочці")).toEqual([]);
      expect(await productIds("зимовий")).toEqual([]);
      expect(await productIds("класичний чоловічий")).toEqual([]);
    });

    it("KNOWN LIMITATION: Russian queries and викрутка/відвертка variants need synonyms", async () => {
      expect(await productIds("рубашка")).toEqual([]);
      expect(await productIds("викрутка")).toEqual(["p3"]);
      await client.tasks.waitForTask(
        (
          await catalog.updateSettings({
            synonyms: { викрутка: ["відвертка"], відвертка: ["викрутка"] },
          })
        ).taskUid,
      );
      expect((await productIds("викрутка")).sort()).toEqual(["p3", "p4"]);
      await client.tasks.waitForTask((await catalog.resetSynonyms()).taskUid);
    });
  });

  describe("variant-level filters", () => {
    it("one document per variant + distinct productId: filters apply to the SAME variant", async () => {
      // p2 has M@3500 and L@2800. 'size = M AND price < 3000' must NOT match p2.
      expect(await productIds("", { filter: 'size = "M" AND price < 3000' })).toEqual(["p1", "p6"]);
      expect(await productIds("", { filter: 'size = "S" AND inStock = true' })).toEqual([]);
    });

    it("a nested variants array in a product document matches across different variants (WRONG - do not use)", async () => {
      const nested = await createIndex(
        "nested",
        { filterableAttributes: ["variants.size", "variants.price"] },
        [
          {
            id: "p2",
            variants: [
              { size: "M", price: 3500 },
              { size: "L", price: 2800 },
            ],
          },
        ],
      );
      const result = await nested.search("", {
        filter: 'variants.size = "M" AND variants.price < 3000',
      });
      expect(result.hits.map((hit) => hit.id)).toEqual(["p2"]);
    });

    it("range filters and sorting work", async () => {
      expect(await productIds("", { filter: "length 120 TO 200" })).toEqual(["p4"]);
      const sorted = await catalog.search("", { sort: ["price:asc"] });
      expect(sorted.hits.map((hit) => hit.price)).toEqual(
        [250, 310, 420, 600, 1990, 2800].slice(0, sorted.hits.length),
      );
    });
  });

  describe("facets", () => {
    it("KNOWN LIMITATION: with distinct, variant-level facet values are undercounted (only the representative variant is counted)", async () => {
      const result = await catalog.search("", {
        facets: ["size", "color"],
        filter: 'brand = "Nordic"',
      });
      // Real data: Nordic has sizes S, M, L and colors білий, чорний, блакитний. Only representative variants are counted.
      expect(result.facetDistribution?.["size"]).toEqual({ M: 3 });
      expect(Object.keys(result.facetDistribution?.["color"] ?? {})).not.toContain("чорний");
    });

    it("KNOWN LIMITATION: without distinct, facet counts are per variant, not per product", async () => {
      await client.tasks.waitForTask(
        (await catalog.updateSettings({ distinctAttribute: null })).taskUid,
      );
      try {
        const result = await catalog.search("", { facets: ["size"], filter: 'brand = "Nordic"' });
        expect(result.facetDistribution?.["size"]).toEqual({ L: 2, M: 3, S: 1 });
        // Products with brand Nordic: p1, p2, p6 (3 products), but sizes sum to 6 variants.
      } finally {
        await client.tasks.waitForTask(
          (await catalog.updateSettings({ distinctAttribute: "productId" })).taskUid,
        );
      }
    });

    it("product-level attributes (brand) are counted per product when copied onto every variant document and distinct is on", async () => {
      const result = await catalog.search("", { facets: ["brand"] });
      expect(result.facetDistribution?.["brand"]).toEqual({
        Bosch: 1,
        Nordic: 3,
        Stanley: 1,
        Ферма: 1,
      });
    });
  });
});
