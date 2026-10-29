import {
  buildSearchDocuments,
  deriveIndexSettings,
  parseSearchQuery,
  planTextQueries,
  stemToken,
} from "@fluxkit/core";
import type { SearchDocument, SearchProductFacts, TextQuery } from "@fluxkit/core";
import { afterAll, describe, expect, it } from "vitest";
import { requireEnv } from "../test/env.js";
import { buildCorpus } from "./search-corpus.js";

/**
 * Spike S1 (docs/plans/2026-10-29-search.md, "Spike S1 results"), the morphology part, reproduced against the real engine
 * with the real core rules: documents come from `buildSearchDocuments`, settings from `deriveIndexSettings`, the text
 * queries from `planTextQueries`. The thresholds sit a little below the numbers measured on 2026-10-29, so a change of the
 * stemmers, the document rules or the engine that makes search worse fails here. Tests marked KNOWN LIMITATION pin misses
 * that the ADR accepts.
 */
const baseUrl = requireEnv("MEILI_URL");
const masterKey = requireEnv("MEILI_MASTER_KEY");
const prefix = `spike_morph_${Date.now()}_`;
const createdIndexes: string[] = [];

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

async function engine(method: string, path: string, body?: unknown): Promise<Reply> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${masterKey}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function waitFor(reply: Reply): Promise<void> {
  const taskUid = reply.body["taskUid"];
  if (typeof taskUid !== "number") {
    throw new Error(`no task in ${JSON.stringify(reply.body)}`);
  }
  for (let attempt = 0; attempt < 1200; attempt++) {
    const task = (await engine("GET", `/tasks/${taskUid}`)).body;
    if (task["status"] === "succeeded") return;
    if (task["status"] === "failed" || task["status"] === "canceled") {
      throw new Error(
        `task ${taskUid} ${String(task["status"])}: ${JSON.stringify(task["error"])}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`task ${taskUid} did not finish`);
}

async function indexDocuments(
  name: string,
  locale: string,
  documents: readonly SearchDocument[],
): Promise<string> {
  const uid = `${prefix}${name}`;
  createdIndexes.push(uid);
  await waitFor(await engine("POST", "/indexes", { uid, primaryKey: "id" }));
  const { settings } = deriveIndexSettings({
    locale,
    currency: "UAH",
    options: [],
    attributes: [],
    synonymGroups: [],
  });
  await waitFor(await engine("PATCH", `/indexes/${uid}/settings`, settings));
  await waitFor(await engine("POST", `/indexes/${uid}/documents`, documents));
  return uid;
}

afterAll(async () => {
  for (const uid of createdIndexes) {
    await waitFor(await engine("DELETE", `/indexes/${uid}`));
  }
});

/** The product ids the shopper sees for a text, in order, using the given text queries of the plan. */
async function search(
  uid: string,
  locale: string,
  text: string,
  roles: readonly TextQuery["role"][],
): Promise<string[]> {
  const parsed = parseSearchQuery(text);
  if (!parsed.ok) throw new Error(parsed.reason);
  const queries = planTextQueries(parsed.query, locale, "results").filter((query) =>
    roles.includes(query.role),
  );
  if (queries.length === 0) return [];
  const reply = await engine("POST", "/multi-search", {
    federation: { limit: 100, distinct: "productId" },
    queries: queries.map((query) => ({
      indexUid: uid,
      q: query.q,
      ...(query.attributesToSearchOn && { attributesToSearchOn: query.attributesToSearchOn }),
      matchingStrategy: "all",
      attributesToRetrieve: ["productId"],
    })),
  });
  const hits = reply.body["hits"] as { productId: string }[] | undefined;
  if (hits === undefined) throw new Error(JSON.stringify(reply.body));
  return [...new Set(hits.map((hit) => hit.productId))];
}

function facts(
  id: string,
  title: string,
  brandName: string | null,
  variants: { id: string; sku: string; price: number }[],
  locale: "uk" | "en",
): SearchProductFacts {
  return {
    id,
    slug: id,
    status: "active",
    publishedAt: "2026-10-29T10:00:00.000Z",
    title: { [locale]: title },
    description: { [locale]: "Якісний товар з гарантією та швидкою доставкою" },
    brand:
      brandName === null
        ? null
        : { slug: brandName.toLowerCase().replace(/\s+/g, "-"), name: { [locale]: brandName } },
    categories: [],
    attributes: {},
    variants: variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      isActive: true,
      shopPrice: variant.price,
      availability: "in_stock",
      optionValues: [],
      attributes: {},
    })),
  };
}

interface Score {
  recall: number;
  precisionAt10: number;
  zero: number;
  n: number;
}

async function score(
  uid: string,
  queries: readonly { text: string; relevant: readonly string[] }[],
  roles: readonly TextQuery["role"][],
): Promise<Score> {
  const result: Score = { recall: 0, precisionAt10: 0, zero: 0, n: 0 };
  for (const query of queries) {
    const got = await search(uid, "uk", query.text, roles);
    const relevant = new Set(query.relevant);
    const top = got.slice(0, 10);
    result.n++;
    result.recall += got.filter((id) => relevant.has(id)).length / relevant.size;
    result.precisionAt10 +=
      top.length === 0 ? 0 : top.filter((id) => relevant.has(id)).length / top.length;
    result.zero += got.length === 0 ? 1 : 0;
  }
  return {
    recall: result.recall / result.n,
    precisionAt10: result.precisionAt10 / result.n,
    zero: result.zero,
    n: result.n,
  };
}

describe("morphology on the synthetic Ukrainian corpus (results page, complete words)", () => {
  const corpus = buildCorpus();
  // the 90 queries without the prefix queries, which belong to the suggest route
  const queries = corpus.queries.filter((query) => query.kind !== "prefix");
  let uid = "";

  it("indexes the corpus through the real document builder and settings", async () => {
    const documents = corpus.products.flatMap((product) =>
      buildSearchDocuments(
        facts(
          product.id,
          product.title,
          product.brandName,
          corpus.documents
            .filter((document) => document.productId === product.id)
            .map((document) => ({ id: document.id, sku: document.sku, price: document.price })),
          "uk",
        ),
        { locale: "uk", defaultLocale: "uk", attributes: [], options: [] },
      ),
    );
    expect(documents.length).toBe(corpus.documents.length);
    uid = await indexDocuments("corpus", "uk", documents);
  });

  it("baseline: typo tolerance on the original words finds about three quarters of the relevant products", async () => {
    const baseline = await score(uid, queries, ["original"]);
    expect(baseline.n).toBe(90);
    expect(baseline.recall).toBeGreaterThan(0.7);
    expect(baseline.recall).toBeLessThan(0.82);
    expect(baseline.zero).toBeGreaterThanOrEqual(15);
  });

  it("original words + Snowball stems lift recall above 90% without losing precision", async () => {
    const withStems = await score(uid, queries, ["original", "stems"]);
    expect(withStems.recall).toBeGreaterThan(0.92);
    expect(withStems.precisionAt10).toBeGreaterThan(0.92);
  });

  it("original words + stems + 5-letter prefixes (the chosen strategy) find at least 95% with P@10 above 93%", async () => {
    const chosen = await score(uid, queries, ["original", "stems", "prefixes"]);
    expect(chosen.recall).toBeGreaterThan(0.95);
    expect(chosen.precisionAt10).toBeGreaterThan(0.93);
    expect(chosen.zero).toBeLessThanOrEqual(5);
  });

  it("one-letter typos and brand names keep working with the chosen strategy", async () => {
    for (const kind of ["typo", "brand"] as const) {
      const ofKind = corpus.queries.filter((query) => query.kind === kind);
      const result = await score(uid, ofKind, ["original", "stems", "prefixes"]);
      expect(result.recall, kind).toBe(1);
    }
  });
});

describe("the failing list of ADR 0005 on its own six products", () => {
  const products: [string, string, string | null][] = [
    ["p1", "Футболка Basic", "Nordic"],
    ["p2", "Сорочка чоловіча класична", "Nordic"],
    ["p3", "Викрутка хрестова PH2", "Stanley"],
    ["p4", "Відвертка плоска SL5", "Bosch"],
    ["p5", "М'ясо яловичини охолоджене", "Ферма"],
    ["p6", "Рукавички зимові", "Nordic"],
    ["p7", "Книга кулінарна", null],
    ["p8", "Нога столова", null],
  ];
  let uid = "";

  it("indexes the products", async () => {
    const documents = products.flatMap(([id, title, brand]) =>
      buildSearchDocuments(
        facts(id, title, brand, [{ id: `${id}-v1`, sku: `SKU-${id}`, price: 1000 }], "uk"),
        { locale: "uk", defaultLocale: "uk", attributes: [], options: [] },
      ),
    );
    uid = await indexDocuments("adr0005", "uk", documents);
  });

  const all = ["original", "stems", "prefixes"] as const;

  it("finds what the old spike could not find", async () => {
    expect(await search(uid, "uk", "сорочці", all)).toEqual(["p2"]);
    expect(await search(uid, "uk", "книзі", all)).toEqual(["p7"]);
    expect(await search(uid, "uk", "ноги", all)).toEqual(["p8"]);
    expect(await search(uid, "uk", "зимовий", all)).toEqual(["p6"]);
    expect(await search(uid, "uk", "класичний чоловічий", all)).toEqual(["p2"]);
    // a related word: the 5-letter prefix joins "рукавиці" with "рукавички"
    expect(await search(uid, "uk", "рукавиці", all)).toEqual(["p6"]);
  });

  it("KNOWN LIMITATION: нозі (k to z alternation of a four-letter word) is not found; a synonym group covers it", async () => {
    expect(await search(uid, "uk", "нозі", all)).toEqual([]);
  });

  it("still finds everything the old spike found", async () => {
    expect(await search(uid, "uk", "футболки", all)).toEqual(["p1"]);
    expect(await search(uid, "uk", "сорочку", all)).toEqual(["p2"]);
    expect(await search(uid, "uk", "м'ясо", all)).toEqual(["p5"]);
    expect(await search(uid, "uk", "мʼясо", all)).toEqual(["p5"]);
    expect(await search(uid, "uk", "мясо", all)).toEqual(["p5"]);
    expect(await search(uid, "uk", "футбока", all)).toEqual(["p1"]);
    expect(await search(uid, "uk", "stanley", all)).toEqual(["p3"]);
  });

  it("alone, the Snowball stems miss сорочці, зимовий and рукавиці (the reason for the prefix queries)", async () => {
    const stemsOnly = ["original", "stems"] as const;
    expect(await search(uid, "uk", "сорочці", stemsOnly)).toEqual([]);
    expect(await search(uid, "uk", "зимовий", stemsOnly)).toEqual([]);
    expect(await search(uid, "uk", "рукавиці", stemsOnly)).toEqual([]);
    expect(stemToken("сорочка", "uk")).toBe("сор");
  });
});

describe("English plural and singular forms", () => {
  const nouns: [string, string][] = [
    ["shirt", "shirts"],
    ["jacket", "jackets"],
    ["sweater", "sweaters"],
    ["hat", "hats"],
    ["backpack", "backpacks"],
    ["belt", "belts"],
    ["dress", "dresses"],
    ["scarf", "scarves"],
    ["shoe", "shoes"],
    ["sock", "socks"],
    ["glove", "gloves"],
    ["hammer", "hammers"],
    ["drill", "drills"],
    ["wrench", "wrenches"],
    ["saw", "saws"],
    ["screwdriver", "screwdrivers"],
    ["knife", "knives"],
    ["ladder", "ladders"],
    ["battery", "batteries"],
    ["cable", "cables"],
    ["charger", "chargers"],
    ["headphone", "headphones"],
    ["speaker", "speakers"],
    ["mouse", "mice"],
    ["keyboard", "keyboards"],
    ["lamp", "lamps"],
    ["candle", "candles"],
    ["box", "boxes"],
    ["notebook", "notebooks"],
    ["pen", "pens"],
    ["pencil", "pencils"],
    ["book", "books"],
    ["bag", "bags"],
    ["cherry", "cherries"],
    ["tomato", "tomatoes"],
    ["cake", "cakes"],
    ["biscuit", "biscuits"],
    ["cheese", "cheeses"],
    ["watch", "watches"],
    ["bottle", "bottles"],
  ];
  const adjectives = [
    "classic",
    "winter",
    "summer",
    "wireless",
    "portable",
    "organic",
    "leather",
    "cotton",
    "compact",
    "professional",
    "waterproof",
    "magnetic",
    "ceramic",
    "folding",
    "premium",
  ];
  let seed = 7;
  const random = (): number => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) throw new Error("empty pick");
    return item;
  };
  const english: { id: string; title: string; noun: string }[] = [];
  const seen = new Set<string>();
  while (english.length < 160) {
    const noun = pick(nouns);
    const adjective = pick(adjectives);
    const title = `${adjective.charAt(0).toUpperCase()}${adjective.slice(1)} ${random() < 0.5 ? noun[0] : noun[1]}`;
    if (seen.has(title)) continue;
    seen.add(title);
    english.push({ id: `e${english.length}`, title, noun: noun[0] });
  }
  let uid = "";

  it("indexes 160 English titles that use singular or plural forms at random", async () => {
    const documents = english.flatMap((product) =>
      buildSearchDocuments(
        facts(
          product.id,
          product.title,
          null,
          [{ id: `${product.id}-v1`, sku: product.id, price: 1000 }],
          "en",
        ),
        { locale: "en", defaultLocale: "en", attributes: [], options: [] },
      ),
    );
    uid = await indexDocuments("english", "en", documents);
  });

  async function recall(
    roles: readonly TextQuery["role"][],
  ): Promise<{ plural: number; singular: number; missed: string[] }> {
    const totals = { plural: [0, 0], singular: [0, 0] };
    const missed: string[] = [];
    for (const noun of nouns) {
      const relevant = english
        .filter((product) => product.noun === noun[0])
        .map((product) => product.id);
      if (relevant.length === 0) continue;
      for (const [form, kind] of [
        [noun[0], "singular"],
        [noun[1], "plural"],
      ] as const) {
        const got = new Set(await search(uid, "en", form, roles));
        const found = relevant.filter((id) => got.has(id)).length / relevant.length;
        totals[kind][0] = (totals[kind][0] ?? 0) + found;
        totals[kind][1] = (totals[kind][1] ?? 0) + 1;
        if (found < 1) missed.push(form);
      }
    }
    const ratio = (pair: number[]): number => (pair[0] ?? 0) / (pair[1] ?? 1);
    return { plural: ratio(totals.plural), singular: ratio(totals.singular), missed };
  }

  it("baseline: short words get no typo tolerance, so plural forms of short nouns are missed", async () => {
    const baseline = await recall(["original"]);
    expect(baseline.plural).toBeLessThan(0.82);
    expect(baseline.missed).toEqual(expect.arrayContaining(["hats", "bags", "saws"]));
  });

  it("with English stems both directions are found, except the irregular forms (synonyms)", async () => {
    const withStems = await recall(["original", "stems"]);
    expect(withStems.plural).toBeGreaterThan(0.93);
    expect(withStems.singular).toBeGreaterThan(0.93);
    const irregular = new Set(["scarf", "scarves", "knife", "knives", "mouse", "mice"]);
    expect(withStems.missed.filter((form) => !irregular.has(form))).toEqual([]);
  });
});
