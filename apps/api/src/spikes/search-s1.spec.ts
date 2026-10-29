import { afterAll, describe, expect, it } from "vitest";
import { requireEnv } from "../test/env.js";

/**
 * Spike S1 (docs/plans/2026-10-29-search.md, step 1), engine facts: how `distinct`, facets, federation, index swaps and
 * scoped keys behave on Meilisearch v1.55.0. The measured numbers and the decisions are in the plan (section "Spike S1
 * results") and in docs/adr/0033-catalog-search.md. Talks plain REST on purpose: this is the wire format the indexer and
 * the store routes will use. Tests marked KNOWN LIMITATION pin today's behavior: if an engine upgrade changes it, the
 * test fails and the ADR must be revisited.
 */
const baseUrl = requireEnv("MEILI_URL");
const masterKey = requireEnv("MEILI_MASTER_KEY");
const prefix = `spike_s1_${Date.now()}_`;
const createdIndexes = new Set<string>();
const createdKeys = new Set<string>();

interface Reply<T = unknown> {
  status: number;
  body: T;
}

async function engine<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
  key: string = masterKey,
): Promise<Reply<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  // deleting a key answers 204 without a body
  return { status: response.status, body: (text === "" ? {} : JSON.parse(text)) as T };
}

interface Task {
  status: string;
  error?: { code: string; message: string } | null;
}

async function waitFor(reply: Reply): Promise<Task> {
  const taskUid = (reply.body as { taskUid?: number }).taskUid;
  if (taskUid === undefined) throw new Error(`no task in ${JSON.stringify(reply.body)}`);
  for (let attempt = 0; attempt < 600; attempt++) {
    const task = (await engine<Task>("GET", `/tasks/${taskUid}`)).body;
    if (["succeeded", "failed", "canceled"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`task ${taskUid} did not finish`);
}

async function createIndex(name: string, settings: object, documents: object[]): Promise<string> {
  const uid = `${prefix}${name}`;
  createdIndexes.add(uid);
  await waitFor(await engine("POST", "/indexes", { uid, primaryKey: "id" }));
  expect((await waitFor(await engine("PATCH", `/indexes/${uid}/settings`, settings))).status).toBe(
    "succeeded",
  );
  expect((await waitFor(await engine("POST", `/indexes/${uid}/documents`, documents))).status).toBe(
    "succeeded",
  );
  return uid;
}

interface Hit {
  id: string;
  productId: string;
  price?: number;
}
interface SearchBody {
  hits: Hit[];
  totalHits?: number;
  totalPages?: number;
  estimatedTotalHits?: number;
  facetDistribution?: Record<string, Record<string, number>>;
  facetStats?: Record<string, { min: number; max: number }>;
  message?: string;
  code?: string;
}

const search = async (uid: string, body: object): Promise<SearchBody> =>
  (await engine<SearchBody>("POST", `/indexes/${uid}/search`, body)).body;

const multiSearch = async (body: object): Promise<SearchBody & { results?: SearchBody[] }> =>
  (await engine<SearchBody & { results?: SearchBody[] }>("POST", "/multi-search", body)).body;

const ids = (hits: Hit[]): string[] => hits.map((hit) => hit.id);

afterAll(async () => {
  for (const uid of createdIndexes) {
    const reply = await engine("DELETE", `/indexes/${uid}`);
    // 404: the index was renamed away by the swap test, nothing is left to delete
    if (reply.status !== 404) await waitFor(reply);
  }
  for (const key of createdKeys) expect((await engine("DELETE", `/keys/${key}`)).status).toBe(204);
});

// p1: three variants (M 1990, L 2490, S 1990 sold out), p2: M 3500 and L 2800, p3: one variant.
const variants = [
  {
    id: "v1",
    productId: "p1",
    title: "Футболка чорна",
    stems: ["футболк", "чорн"],
    brand: "nordic",
    size: "M",
    price: 1990,
    inStock: true,
  },
  {
    id: "v2",
    productId: "p1",
    title: "Футболка чорна",
    stems: ["футболк", "чорн"],
    brand: "nordic",
    size: "L",
    price: 2490,
    inStock: true,
  },
  {
    id: "v3",
    productId: "p1",
    title: "Футболка чорна",
    stems: ["футболк", "чорн"],
    brand: "nordic",
    size: "S",
    price: 1990,
    inStock: false,
  },
  {
    id: "v4",
    productId: "p2",
    title: "Футболка біла",
    stems: ["футболк", "біл"],
    brand: "nordic",
    size: "M",
    price: 3500,
    inStock: true,
  },
  {
    id: "v5",
    productId: "p2",
    title: "Футболка біла",
    stems: ["футболк", "біл"],
    brand: "nordic",
    size: "L",
    price: 2800,
    inStock: true,
  },
  {
    id: "v6",
    productId: "p3",
    title: "Рукавички зимові",
    stems: ["рукавичк", "зим"],
    brand: "other",
    size: "M",
    price: 600,
    inStock: true,
  },
];
const catalogSettings = {
  searchableAttributes: ["title", "stems"],
  filterableAttributes: ["brand", "size", "price", "inStock", "productId"],
  sortableAttributes: ["price"],
};

describe("Meilisearch spike S1: distinct, totals and facets", () => {
  let plain: string;
  let withIndexDistinct: string;

  it("sets up two indexes with the same documents", async () => {
    plain = await createIndex("plain", catalogSettings, variants);
    withIndexDistinct = await createIndex(
      "distinct",
      { ...catalogSettings, distinctAttribute: "productId" },
      variants,
    );
  });

  it("distinct can be chosen per request, without the index setting, and totals count products", async () => {
    const result = await search(plain, { q: "", distinct: "productId", page: 1, hitsPerPage: 2 });
    expect(result.totalHits).toBe(3);
    expect(result.totalPages).toBe(2);
    expect(ids(result.hits)).toEqual(["v1", "v4"]);
    const second = await search(plain, { q: "", distinct: "productId", page: 2, hitsPerPage: 2 });
    expect(ids(second.hits)).toEqual(["v6"]);
    const offsetLimit = await search(plain, { q: "", distinct: "productId", limit: 20 });
    expect(offsetLimit.estimatedTotalHits).toBe(3);
  });

  it("KNOWN LIMITATION: an index-level distinctAttribute cannot be switched off by a request (null is ignored)", async () => {
    const ignored = await search(withIndexDistinct, { q: "", distinct: null, hitsPerPage: 20 });
    expect(ids(ignored.hits)).toEqual(["v1", "v4", "v6"]);
    const empty = await search(withIndexDistinct, { q: "", distinct: "", hitsPerPage: 20 });
    expect(empty.code).toBe("invalid_search_distinct");
    // A request can only choose another attribute, so the plan keeps the index setting unset.
    const other = await search(withIndexDistinct, { q: "", distinct: "brand", hitsPerPage: 20 });
    expect(ids(other.hits)).toEqual(["v1", "v6"]);
  });

  it("filters apply to the same variant, then results are grouped by product", async () => {
    const result = await search(plain, {
      q: "",
      distinct: "productId",
      filter: 'size = "M" AND price < 3000',
      hitsPerPage: 20,
    });
    expect(ids(result.hits)).toEqual(["v1", "v6"]);
    expect(result.totalHits).toBe(2);
  });

  it("product-level facets are exact with distinct; variant-level values need a query without distinct", async () => {
    const withDistinct = await search(plain, {
      q: "",
      distinct: "productId",
      facets: ["brand", "size"],
      hitsPerPage: 20,
    });
    expect(withDistinct.facetDistribution?.["brand"]).toEqual({ nordic: 2, other: 1 });
    // KNOWN LIMITATION: only the representative variant of each product is counted, sizes L and S disappear.
    expect(withDistinct.facetDistribution?.["size"]).toEqual({ M: 3 });
    const withoutDistinct = await search(plain, { q: "", facets: ["size", "inStock"], limit: 0 });
    expect(withoutDistinct.facetDistribution?.["size"]).toEqual({ L: 2, M: 3, S: 1 });
    expect(withoutDistinct.facetDistribution?.["inStock"]).toEqual({ false: 1, true: 5 });
  });

  it("KNOWN LIMITATION: with distinct, facet counts are exact only with page/hitsPerPage; limit 0 or a small limit counts variants", async () => {
    const counts = async (extra: object): Promise<Record<string, number> | undefined> =>
      (await search(plain, { q: "", distinct: "productId", facets: ["brand"], ...extra }))
        .facetDistribution?.["brand"];
    expect(await counts({ page: 1, hitsPerPage: 0 })).toEqual({ nordic: 2, other: 1 });
    expect(await counts({ page: 1, hitsPerPage: 1 })).toEqual({ nordic: 2, other: 1 });
    expect(await counts({ limit: 20 })).toEqual({ nordic: 2, other: 1 });
    // distinct is applied lazily to the hits that are asked for: nothing asked, nothing grouped
    expect(await counts({ limit: 0 })).toEqual({ nordic: 5, other: 1 });
    expect(await counts({ limit: 1 })).toEqual({ nordic: 3, other: 1 });
  });

  it("facetStats gives the price range of the matching variants", async () => {
    const distinct = await search(plain, {
      q: "",
      distinct: "productId",
      facets: ["price"],
      limit: 0,
    });
    const all = await search(plain, { q: "", facets: ["price"], limit: 0 });
    expect(distinct.facetStats?.["price"]).toEqual({ min: 600, max: 3500 });
    expect(all.facetStats?.["price"]).toEqual({ min: 600, max: 3500 });
  });

  it("one multi-search carries the hits and the disjunctive facet queries", async () => {
    const result = await multiSearch({
      queries: [
        {
          indexUid: plain,
          q: "",
          distinct: "productId",
          page: 1,
          hitsPerPage: 20,
          filter: 'brand = "nordic"',
          facets: ["brand"],
        },
        // the brand facet without the brand filter, so the other brands stay visible while one is selected
        {
          indexUid: plain,
          q: "",
          distinct: "productId",
          page: 1,
          hitsPerPage: 0,
          facets: ["brand"],
        },
        { indexUid: plain, q: "", limit: 0, filter: 'brand = "nordic"', facets: ["size"] },
      ],
    });
    const [hits, brandWithoutItsOwnFilter, sizes] = result.results ?? [];
    expect(hits?.totalHits).toBe(2);
    expect(hits?.facetDistribution?.["brand"]).toEqual({ nordic: 2 });
    expect(brandWithoutItsOwnFilter?.facetDistribution?.["brand"]).toEqual({ nordic: 2, other: 1 });
    expect(sizes?.facetDistribution?.["size"]).toEqual({ L: 2, M: 2, S: 1 });
  });

  it("federation merges several queries with distinct, product facets, exhaustive totals and the same-variant filter", async () => {
    const original = { indexUid: plain, q: "футболка " };
    const stems = { indexUid: plain, q: "футболк ", attributesToSearchOn: ["stems"] };
    const merged = await multiSearch({
      federation: {
        page: 1,
        hitsPerPage: 10,
        distinct: "productId",
        facetsByIndex: { [plain]: ["brand"] },
        mergeFacets: {},
      },
      queries: [original, stems],
    });
    expect(ids(merged.hits)).toEqual(["v1", "v4"]);
    expect(merged.totalHits).toBe(2);
    expect(merged.facetDistribution?.["brand"]).toEqual({ nordic: 2 });
    const filter = 'size = "M" AND price < 3000';
    const filtered = await multiSearch({
      federation: { limit: 20, distinct: "productId" },
      queries: [
        { ...original, filter },
        { ...stems, filter },
      ],
    });
    expect(ids(filtered.hits)).toEqual(["v1"]);
    const sorted = await multiSearch({
      federation: { limit: 20, distinct: "productId" },
      queries: [
        { ...original, sort: ["price:asc"] },
        { ...stems, sort: ["price:asc"] },
      ],
    });
    // the representative of each product is its cheapest matching variant
    expect(sorted.hits.map((hit) => [hit.id, hit.price])).toEqual([
      ["v1", 1990],
      ["v5", 2800],
    ]);
    // variant-level facets of a federation without distinct count every variant once, although both queries match it
    const variantFacets = await multiSearch({
      federation: { limit: 0, facetsByIndex: { [plain]: ["size"] }, mergeFacets: {} },
      queries: [original, stems],
    });
    expect(variantFacets.facetDistribution?.["size"]).toEqual({ L: 2, M: 2, S: 1 });
  });
});

describe("Meilisearch spike S1: prefix matching of the last word", () => {
  it("a trailing space or quotes switch prefix matching off for the last word (complete words on the results page)", async () => {
    const uid = await createIndex(
      "prefix",
      { searchableAttributes: ["title"], filterableAttributes: ["productId"] },
      [
        { id: "1", productId: "p1", title: "Вода мінеральна" },
        { id: "2", productId: "p2", title: "Роутер водонепроникний" },
      ],
    );
    expect(ids((await search(uid, { q: "вод" })).hits)).toEqual(["1", "2"]);
    expect(ids((await search(uid, { q: "вод " })).hits)).toEqual([]);
    expect(ids((await search(uid, { q: '"вод"' })).hits)).toEqual([]);
    expect(ids((await search(uid, { q: "вода " })).hits)).toEqual(["1"]);
  });
});

describe("Meilisearch spike S1: index swap and scoped keys", () => {
  const documents = (tag: string, count: number): object[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `d${index}`,
      title: `Футболка ${tag} ${index}`,
      tag,
    }));
  const settings = { searchableAttributes: ["title"], filterableAttributes: ["tag"] };

  it("swap-indexes is atomic and searches during repeated swaps never fail or come back empty", async () => {
    const live = await createIndex("swap_live", settings, documents("a", 800));
    const build = await createIndex("swap_build", settings, documents("b", 1000));
    let stop = false;
    const seen = { ok: 0, failed: 0, empty: 0, totals: new Set<number>() };
    const searcher = async (): Promise<void> => {
      while (!stop) {
        const reply = await engine<SearchBody>("POST", `/indexes/${live}/search`, {
          q: "футболка",
          limit: 1,
        });
        if (reply.status !== 200) seen.failed++;
        else {
          seen.ok++;
          if (reply.body.hits.length === 0) seen.empty++;
          seen.totals.add(reply.body.estimatedTotalHits ?? -1);
        }
      }
    };
    const searchers = Array.from({ length: 4 }, searcher);
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (let round = 0; round < 4; round++) {
      const swap = await waitFor(
        await engine("POST", "/swap-indexes", [{ indexes: [live, build] }]),
      );
      expect(swap.status).toBe("succeeded");
    }
    stop = true;
    await Promise.all(searchers);
    expect(seen.ok).toBeGreaterThan(0);
    expect(seen.failed).toBe(0);
    expect(seen.empty).toBe(0);
    // after an even number of swaps the live index holds its own documents again; only the two document sets were ever seen
    expect([...seen.totals].every((total) => total === 800 || total === 1000)).toBe(true);
  });

  it("a swap with a second uid that does not exist needs rename: true (a rename), and fails otherwise", async () => {
    const source = await createIndex("rename_source", settings, documents("c", 5));
    const target = `${prefix}rename_target`;
    createdIndexes.add(target);
    const withoutRename = await waitFor(
      await engine("POST", "/swap-indexes", [{ indexes: [source, target] }]),
    );
    expect(withoutRename.status).toBe("failed");
    expect(withoutRename.error?.message).toContain("not found");
    const renamed = await waitFor(
      await engine("POST", "/swap-indexes", [{ indexes: [source, target], rename: true }]),
    );
    expect(renamed.status).toBe("succeeded");
    expect((await engine("GET", `/indexes/${source}`)).status).toBe(404);
    expect((await search(target, { q: "", limit: 1 })).estimatedTotalHits).toBe(5);
  });

  it("a key limited to an index prefix can work on that prefix only and cannot read keys or other indexes", async () => {
    const scope = `${prefix}scoped_`;
    const created = await engine<{ key: string; uid: string; indexes: string[] }>("POST", "/keys", {
      name: "spike s1 scoped",
      description: "created by spike S1, deleted at the end",
      actions: [
        "search",
        "documents.add",
        "documents.delete",
        "indexes.create",
        "indexes.delete",
        "indexes.swap",
        "settings.update",
        "settings.get",
        "tasks.get",
        "stats.get",
      ],
      indexes: [`${scope}*`],
      expiresAt: null,
    });
    expect(created.status).toBe(201);
    createdKeys.add(created.body.uid);
    const key = created.body.key;
    const own = `${scope}a`;
    createdIndexes.add(own);
    expect((await engine("POST", "/indexes", { uid: own, primaryKey: "id" }, key)).status).toBe(
      202,
    );
    const outside = `${prefix}outside`;
    createdIndexes.add(outside);
    await waitFor(await engine("POST", "/indexes", { uid: outside, primaryKey: "id" }));
    expect(
      (await engine("POST", "/indexes", { uid: `${prefix}outside_created`, primaryKey: "id" }, key))
        .status,
    ).toBe(403);
    expect((await engine("POST", `/indexes/${outside}/search`, { q: "" }, key)).status).toBe(403);
    expect((await engine("POST", "/swap-indexes", [{ indexes: [own, outside] }], key)).status).toBe(
      403,
    );
    expect((await engine("GET", "/keys", undefined, key)).status).toBe(403);
    // KNOWN LIMITATION: listing indexes needs indexes.get, which this action list leaves out on purpose
    expect((await engine("GET", "/indexes", undefined, key)).status).toBe(403);
  });
});
