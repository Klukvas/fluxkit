import {
  buildSearchDocuments,
  deriveIndexSettings,
  parseSearchQuery,
  planTextQueries,
  stemToken,
} from "@fluxkit/core";
import type { SearchDocument, SearchProductFacts, TextQuery } from "@fluxkit/core";
import { demoSynonymGroups } from "@fluxkit/seeds";
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
  synonymGroups: readonly (readonly string[])[] = [],
): Promise<string> {
  const uid = `${prefix}${name}`;
  createdIndexes.push(uid);
  await waitFor(await engine("POST", "/indexes", { uid, primaryKey: "id" }));
  const { settings } = deriveIndexSettings({
    locale,
    currency: "UAH",
    options: [],
    attributes: [],
    synonymGroups,
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

/** One engine pass: the federation of the given text queries, top 100 products. */
async function pass(
  uid: string,
  queries: readonly TextQuery[],
  matchingStrategy: "all" | "last",
): Promise<string[]> {
  if (queries.length === 0) return [];
  const reply = await engine("POST", "/multi-search", {
    federation: { limit: 100, distinct: "productId" },
    queries: queries.map((query) => ({
      indexUid: uid,
      q: query.q,
      ...(query.attributesToSearchOn && { attributesToSearchOn: query.attributesToSearchOn }),
      matchingStrategy,
      attributesToRetrieve: ["productId"],
    })),
  });
  const hits = reply.body["hits"] as { productId: string }[] | undefined;
  if (hits === undefined) throw new Error(JSON.stringify(reply.body));
  return [...new Set(hits.map((hit) => hit.productId))];
}

/**
 * The products of a results page as the store answers it, with both passes (ADR 0037): the strict pass; when it finds
 * nothing, the relaxed pass (the last word prefix-matched, `matchingStrategy: last` for two or more words).
 * `before0037` replays the flow of ADR 0034: the second pass only for two or more words, without the prefix.
 */
async function storeSearch(
  uid: string,
  locale: string,
  text: string,
  flow: "adr0037" | "before0037" = "adr0037",
): Promise<string[]> {
  const parsed = parseSearchQuery(text);
  if (!parsed.ok) throw new Error(parsed.reason);
  const strict = await pass(uid, planTextQueries(parsed.query, locale, "results"), "all");
  const several = parsed.query.words.length >= 2;
  if (strict.length > 0) return strict;
  if (flow === "before0037") {
    return several ? pass(uid, planTextQueries(parsed.query, locale, "results"), "last") : strict;
  }
  return pass(uid, planTextQueries(parsed.query, locale, "relaxed"), several ? "last" : "all");
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
  roles: readonly TextQuery["role"][] | ((text: string) => Promise<string[]>),
): Promise<Score> {
  const result: Score = { recall: 0, precisionAt10: 0, zero: 0, n: 0 };
  for (const query of queries) {
    const got =
      typeof roles === "function"
        ? await roles(query.text)
        : await search(uid, "uk", query.text, roles);
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
  // the 90 queries of complete words: without the prefix queries (suggest) and the partial ones (ADR 0037, below)
  const queries = corpus.queries.filter(
    (query) => query.kind !== "prefix" && query.kind !== "partial",
  );
  // a cut last word on the results page: the 10 suggest prefixes and the 20 partial queries (alone or after a word)
  const partial = corpus.queries.filter(
    (query) => query.kind === "prefix" || query.kind === "partial",
  );
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
      const twoPasses = await score(uid, ofKind, (text) => storeSearch(uid, "uk", text));
      expect(twoPasses.recall, `${kind}, both passes`).toBe(1);
    }
  });

  it("ADR 0037: complete words answer exactly as before (the prefix pass runs only when the strict pass finds nothing)", async () => {
    expect(partial.length).toBe(30);
    for (const query of queries) {
      expect(await storeSearch(uid, "uk", query.text), query.text).toEqual(
        await storeSearch(uid, "uk", query.text, "before0037"),
      );
    }
    const both = await score(uid, queries, (text) => storeSearch(uid, "uk", text));
    // measured 2026-10-29: recall 98.9%, P@10 95.7%, 1 of 90 without results (the relaxed pass of ADR 0034 included)
    expect(both.recall).toBeGreaterThan(0.98);
    expect(both.precisionAt10).toBeGreaterThan(0.95);
    expect(both.zero).toBeLessThanOrEqual(1);
  });

  it("ADR 0037: a cut last word is found by the prefix pass (before: 11 of 30 found nothing)", async () => {
    const before = await score(uid, partial, (text) => storeSearch(uid, "uk", text, "before0037"));
    // measured 2026-10-29: recall 63.3%, P@10 51.5%, 11 of 30 without results
    expect(before.recall).toBeLessThan(0.7);
    expect(before.zero).toBeGreaterThanOrEqual(10);
    const after = await score(uid, partial, (text) => storeSearch(uid, "uk", text));
    // measured 2026-10-29: recall 100%, P@10 88.2%, 0 of 30 without results
    expect(after.recall).toBeGreaterThan(0.98);
    expect(after.precisionAt10).toBeGreaterThan(0.85);
    expect(after.zero).toBe(0);
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

  it("ADR 0037: a cut word (3 to 6 letters) is found by the prefix pass; whole words answer as before", async () => {
    const cuts: { text: string; relevant: string[] }[] = [];
    const whole: { text: string; relevant: string[] }[] = [];
    for (const [singular, plural] of nouns) {
      const relevant = english
        .filter((product) => product.noun === singular)
        .map((product) => product.id);
      if (relevant.length === 0) continue;
      whole.push({ text: singular, relevant }, { text: plural, relevant });
      for (const length of [3, 4, 5, 6]) {
        const cut = singular.slice(0, length);
        if (length >= singular.length || cuts.some((query) => query.text === cut)) continue;
        cuts.push({
          text: cut,
          relevant: english
            .filter((product) =>
              product.title
                .toLowerCase()
                .split(" ")
                .some((word) => word.startsWith(cut)),
            )
            .map((product) => product.id),
        });
      }
    }
    const scoreOf = async (
      queries: readonly { text: string; relevant: readonly string[] }[],
      flow: "adr0037" | "before0037",
    ): Promise<Score> => score(uid, queries, (text) => storeSearch(uid, "en", text, flow));
    // whole singular and plural forms: measured recall 96.3%, P@10 100% with and without ADR 0037 (prefix matching in
    // the strict pass, option b of ADR 0037, measured P@10 99.4%)
    const wholeScore = await scoreOf(whole, "adr0037");
    expect(wholeScore.recall).toBeGreaterThan(0.96);
    expect(wholeScore.precisionAt10).toBe(1);
    const before = await scoreOf(cuts, "before0037");
    const after = await scoreOf(cuts, "adr0037");
    // measured 2026-10-29 on 93 cuts: before recall 13.4%, P@10 18.3%, 76 without results; after recall 95.1%,
    // P@10 100%, none without results
    expect(cuts.length).toBe(93);
    expect(before.zero).toBeGreaterThanOrEqual(70);
    expect(after.recall).toBeGreaterThan(0.93);
    expect(after.precisionAt10).toBeGreaterThan(0.99);
    expect(after.zero).toBe(0);
    for (const query of whole) {
      expect(await storeSearch(uid, "en", query.text), query.text).toEqual(
        await storeSearch(uid, "en", query.text, "before0037"),
      );
    }
    const screwdrivers = english
      .filter((product) => product.noun === "screwdriver")
      .map((product) => product.id);
    expect(screwdrivers.length).toBeGreaterThan(0);
    expect(new Set(await storeSearch(uid, "en", "screw"))).toEqual(new Set(screwdrivers));
    expect(await storeSearch(uid, "en", "screw", "before0037")).toEqual([]);
  });

  it("with English stems both directions are found, except the irregular forms (synonyms)", async () => {
    const withStems = await recall(["original", "stems"]);
    expect(withStems.plural).toBeGreaterThan(0.93);
    expect(withStems.singular).toBeGreaterThan(0.93);
    const irregular = new Set(["scarf", "scarves", "knife", "knives", "mouse", "mice"]);
    expect(withStems.missed.filter((form) => !irregular.has(form))).toEqual([]);
  });
});

describe("the demo synonym groups of the seeds (ADR 0034 decisions 6 and 8, search plan step 11)", () => {
  const all = ["original", "stems", "prefixes"] as const;
  const groupsOf = (locale: string) =>
    demoSynonymGroups.filter((group) => group.locale === locale).map((group) => group.terms);
  const ukProducts: [string, string][] = [
    ["u1", "Демо підставка для ноги"],
    ["u2", "Демо викрутка хрестова"],
    ["u3", "Демо лляна сорочка"],
  ];
  const enProducts: [string, string][] = [
    ["e1", "Demo Wool Scarf"],
    ["e2", "Demo Kitchen Knife"],
    ["e3", "Demo Wireless Mouse"],
    ["e4", "Demo Linen Shirt for Men"],
  ];
  const documentsOf = (products: [string, string][], locale: "uk" | "en") =>
    products.flatMap(([id, title]) =>
      buildSearchDocuments(
        facts(id, title, null, [{ id: `${id}-v1`, sku: `SKU-${id}`, price: 1000 }], locale),
        { locale, defaultLocale: locale, attributes: [], options: [] },
      ),
    );
  const uids = { uk: "", ukPlain: "", en: "", enPlain: "" };

  it("indexes the same products with and without the demo groups", async () => {
    uids.uk = await indexDocuments("syn_uk", "uk", documentsOf(ukProducts, "uk"), groupsOf("uk"));
    uids.ukPlain = await indexDocuments("syn_uk_plain", "uk", documentsOf(ukProducts, "uk"));
    uids.en = await indexDocuments("syn_en", "en", documentsOf(enProducts, "en"), groupsOf("en"));
    uids.enPlain = await indexDocuments("syn_en_plain", "en", documentsOf(enProducts, "en"));
  });

  it("finds нозі (the stemmer's documented miss), відвертка and the Russian рубашка only through the groups", async () => {
    for (const [query, expected] of [
      ["нозі", ["u1"]],
      ["відвертка", ["u2"]],
      ["рубашка", ["u3"]],
    ] as const) {
      expect(await search(uids.uk, "uk", query, all), query).toEqual(expected);
      expect(await search(uids.ukPlain, "uk", query, all), `${query} without synonyms`).toEqual([]);
    }
  });

  it("finds the irregular English forms the stemmer misses only through the groups", async () => {
    for (const [query, expected] of [
      ["scarves", ["e1"]],
      ["knives", ["e2"]],
      ["mice", ["e3"]],
      ["man", ["e4"]],
    ] as const) {
      expect(await search(uids.en, "en", query, all), query).toEqual(expected);
      expect(await search(uids.enPlain, "en", query, all), `${query} without synonyms`).toEqual([]);
    }
  });
});
