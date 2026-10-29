import { Logger } from "@nestjs/common";
import {
  deriveFacetSpecs,
  engineSort,
  parseSearchQuery,
  parseSearchSort,
  parseSelectionParams,
  planSearchQueries,
  planTextQueries,
  resolveTextWithFallback,
  SearchFilterError,
  SEARCH_LIMITS,
  searchLiveIndexUid,
  selectedGroupKeys,
  validatePageRequest,
  type FacetSpec,
  type I18nText,
  type NormalizedSearchQuery,
  type PlannedQuery,
  type SearchSelection,
  type SearchSort,
  type TextQuery,
} from "@fluxkit/core";
import { inArray } from "drizzle-orm";
import type { StoreService } from "../../catalog/store/store.service.js";
import { validationFailed, ProblemException } from "../../common/problem.js";
import type { SearchPort } from "../../common/search-port.js";
import { withTransaction } from "../../common/transaction.js";
import type { Database } from "../../database/database.module.js";
import { brand } from "../../database/schema/index.js";
import { SearchEngineError, type SearchEngine } from "../engine/index.js";
import { readSearchDefinitions, type SearchDefinitions } from "../indexer/index.js";
import type { SearchConfig } from "../search-config.js";
import type {
  StoreSearchFacet,
  StoreSearchQuery,
  StoreSearchResponse,
  StoreSuggestQuery,
  StoreSuggestResponse,
} from "./store-search.schemas.js";

/** How long the definitions behind facets and labels are kept per process: a label change shows within this time. */
export const DEFINITIONS_TTL_MS = 30_000;

interface EngineSearchResult {
  hits?: { productId?: unknown }[];
  totalHits?: number;
  totalPages?: number;
  facetDistribution?: Record<string, Record<string, number>>;
  facetStats?: Record<string, { min: number; max: number }>;
}

type Strategy = "all" | "last";

/** The engine could not answer in time (or has no live index yet): the store answers 503, the storefront falls back. */
export function searchUnavailable(): ProblemException {
  return new ProblemException({
    code: "search_unavailable",
    detail: "Search is temporarily unavailable. Browse the catalog instead.",
    headers: { "Retry-After": "30" },
  });
}

/**
 * `GET /store/search` and `/store/search/suggest` (ADR 0034 decisions 3, 4 and 10). The request is validated by core
 * (query text, facet selection, page, sort); the engine filter is built by core `buildSearchFilter` only; every engine
 * call has the 2 s search timeout. Items are hydrated from Postgres by product id, so a stale index never shows a stale
 * price, a draft or a deleted product (dropped ids are marked for sync). Query text is never logged.
 */
export class StoreSearchService {
  private readonly logger = new Logger("StoreSearch");

  private cached: { at: number; definitions: SearchDefinitions; specs: FacetSpec[] } | undefined;

  constructor(
    private readonly database: Database,
    private readonly engine: SearchEngine,
    private readonly config: Extract<SearchConfig, { enabled: true }>,
    private readonly store: StoreService,
    private readonly port: SearchPort,
  ) {}

  async search(query: StoreSearchQuery): Promise<StoreSearchResponse> {
    const locale = this.store.resolveLocale(query.locale);
    const parsed = parseSearchQuery(query.q ?? "");
    if (!parsed.ok) {
      throw validationFailed([{ path: "q", code: parsed.reason }]);
    }
    const text = parsed.query;
    const sort = parseSearchSort(query.sort, text.words.length > 0);
    if (sort === null) {
      throw validationFailed([{ path: "sort", code: "invalid_value" }]);
    }
    const page = validatePageRequest(
      query.page === undefined ? 1 : Number(query.page),
      query.limit === undefined ? SEARCH_LIMITS.defaultPageSize : Number(query.limit),
    );
    if (!page.ok) {
      throw validationFailed([
        { path: page.reason === "invalid_page_size" ? "limit" : "page", code: page.reason },
      ]);
    }
    const { definitions, specs } = await this.definitions();
    const f = query.f === undefined ? [] : Array.isArray(query.f) ? query.f : [query.f];
    const selected = parseSelectionParams(
      { f, ...(query.price === undefined ? {} : { price: query.price }) },
      specs,
    );
    if (!selected.ok) {
      throw validationFailed([
        { path: selected.error.param === "price" ? "price" : "f", code: selected.error.reason },
      ]);
    }
    const selection = selected.selection;
    const plan = planOrRefuse(() =>
      planSearchQueries({
        selection,
        specs,
        page: page.page,
        pageSize: page.pageSize,
      }),
    );
    const uid = searchLiveIndexUid(this.config.indexPrefix, locale.locale);
    const textQueries = planTextQueries(text, locale.locale, "results");

    let results = await this.run(uid, textQueries, plan.queries, sort, "all", text);
    let relaxed = false;
    const hits = results.find((entry) => entry.planned.purpose === "hits")?.result;
    if ((hits?.totalHits ?? 0) === 0 && text.words.length >= 2) {
      results = await this.run(uid, textQueries, plan.queries, sort, "last", text);
      relaxed = true;
    }
    const main = results.find((entry) => entry.planned.purpose === "hits")?.result ?? {};
    const productIds = uniqueProductIds(main);
    const hydrated = await this.store.listItemsByIds(productIds, locale.locale);
    if (hydrated.missing.length > 0) {
      // The index is behind: the product is no longer for sale. Mark it so the next sync removes its documents.
      await withTransaction(this.database, (tx) =>
        this.port.productsChanged(tx, hydrated.missing, "stale_hit"),
      );
    }
    const facets = await this.facets(results, specs, selection, definitions, locale);
    const priceStats = results.find((entry) => entry.planned.purpose === "price_range")?.result
      .facetStats?.["price"];
    return {
      items: hydrated.items,
      total: main.totalHits ?? 0,
      page: page.page,
      pageCount: main.totalPages ?? 0,
      limit: page.pageSize,
      sort,
      relaxed: relaxed && (main.totalHits ?? 0) > 0,
      query: { normalized: text.text },
      facets,
      price:
        priceStats === undefined
          ? null
          : { min: Math.round(priceStats.min), max: Math.round(priceStats.max) },
    };
  }

  async suggest(query: StoreSuggestQuery): Promise<StoreSuggestResponse> {
    const locale = this.store.resolveLocale(query.locale);
    const parsed = parseSearchQuery(query.q);
    if (!parsed.ok) {
      throw validationFailed([{ path: "q", code: parsed.reason }]);
    }
    if ([...parsed.query.text].length < SEARCH_LIMITS.minSuggestLength) {
      throw validationFailed([{ path: "q", code: "too_short" }]);
    }
    const [suggestion] = planTextQueries(parsed.query, locale.locale, "suggest");
    if (suggestion === undefined) {
      return { items: [] };
    }
    const uid = searchLiveIndexUid(this.config.indexPrefix, locale.locale);
    const answer = await this.call<{ results?: EngineSearchResult[] }>(
      {
        queries: [
          {
            indexUid: uid,
            q: suggestion.q,
            attributesToSearchOn: suggestion.attributesToSearchOn,
            distinct: "productId",
            limit: SEARCH_LIMITS.maxSuggestions,
            attributesToRetrieve: ["productId"],
          },
        ],
      },
      parsed.query,
    );
    const productIds = uniqueProductIds(answer.results?.[0] ?? {});
    // Titles and slugs come from Postgres too: a product that stopped being for sale is never suggested.
    const hydrated = await this.store.listItemsByIds(productIds, locale.locale);
    return { items: hydrated.items.map((item) => ({ slug: item.slug, title: item.title })) };
  }

  private async definitions(): Promise<{ definitions: SearchDefinitions; specs: FacetSpec[] }> {
    const now = Date.now();
    if (this.cached === undefined || now - this.cached.at > DEFINITIONS_TTL_MS) {
      const definitions = await readSearchDefinitions(this.database);
      this.cached = {
        at: now,
        definitions,
        specs: deriveFacetSpecs({
          options: definitions.typeOptionCodes,
          attributes: definitions.allAssignments,
        }),
      };
    }
    return this.cached;
  }

  /** Every planned query as a federation of the text queries, in parallel, each within the search timeout. */
  private async run(
    uid: string,
    textQueries: readonly TextQuery[],
    planned: readonly PlannedQuery[],
    sort: SearchSort,
    strategy: Strategy,
    text: NormalizedSearchQuery,
  ): Promise<{ planned: PlannedQuery; result: EngineSearchResult }[]> {
    const texts: readonly TextQuery[] =
      textQueries.length > 0 ? textQueries : [{ role: "original", q: "" }];
    const rules = engineSort(sort);
    return Promise.all(
      planned.map(async (entry) => {
        const body = {
          federation: {
            ...(entry.distinct ? { distinct: "productId" } : {}),
            ...(entry.pagination.kind === "page"
              ? { page: entry.pagination.page, hitsPerPage: entry.pagination.hitsPerPage }
              : { limit: 0 }),
            ...(entry.facets.length > 0
              ? { facetsByIndex: { [uid]: [...entry.facets] }, mergeFacets: {} }
              : {}),
          },
          queries: texts.map((textQuery) => ({
            indexUid: uid,
            q: textQuery.q,
            ...(textQuery.attributesToSearchOn === undefined
              ? {}
              : { attributesToSearchOn: [...textQuery.attributesToSearchOn] }),
            ...(entry.filter === null ? {} : { filter: entry.filter }),
            ...(entry.purpose === "hits" && rules !== undefined ? { sort: rules } : {}),
            matchingStrategy: strategy,
            attributesToRetrieve: ["productId"],
          })),
        };
        return { planned: entry, result: await this.call<EngineSearchResult>(body, text) };
      }),
    );
  }

  private async call<T>(body: object, text: NormalizedSearchQuery): Promise<T> {
    const started = Date.now();
    try {
      return await this.engine.multiSearch<T>(body, this.config.tuning.searchTimeoutMs);
    } catch (error) {
      if (error instanceof SearchEngineError) {
        // Never the query text: its length and the code only.
        this.logger.warn(
          `Search failed: ${error.code}${error.engineCode === undefined ? "" : ` [${error.engineCode}]`} after ${String(Date.now() - started)} ms (query of ${String(text.words.length)} words)`,
        );
        throw searchUnavailable();
      }
      throw error;
    }
  }

  private async facets(
    results: readonly { planned: PlannedQuery; result: EngineSearchResult }[],
    specs: readonly FacetSpec[],
    selection: SearchSelection,
    definitions: SearchDefinitions,
    locale: { locale: string; defaultLocale: string },
  ): Promise<StoreSearchFacet[]> {
    const text = (value: I18nText | null | undefined): string | null =>
      resolveTextWithFallback(value, locale.locale, locale.defaultLocale) ?? null;
    const resultFor = (purpose: string, key?: string): EngineSearchResult | undefined =>
      results.find(
        (entry) =>
          entry.planned.purpose === purpose &&
          (key === undefined || entry.planned.facetKey === key),
      )?.result;
    const selectedKeys = new Set(selectedGroupKeys(selection));
    const selectedValues = selectedValuesOf(selection);

    const brandSlugs = new Set<string>();
    const sources = new Map<string, EngineSearchResult | undefined>();
    for (const spec of specs) {
      const source =
        resultFor("disjunctive", spec.key) ??
        resultFor(spec.level === "product" ? "hits" : "variant_facets");
      sources.set(spec.key, source);
      if (spec.key === "brand") {
        for (const slug of Object.keys(source?.facetDistribution?.[spec.field] ?? {})) {
          brandSlugs.add(slug);
        }
      }
    }
    const brandNames = new Map<string, I18nText>();
    if (brandSlugs.size > 0) {
      const rows = await this.database
        .select({ slug: brand.slug, name: brand.name })
        .from(brand)
        .where(inArray(brand.slug, [...brandSlugs]));
      for (const row of rows) {
        brandNames.set(row.slug, row.name);
      }
    }

    const facets: StoreSearchFacet[] = [];
    for (const spec of specs) {
      if (facets.length >= SEARCH_LIMITS.maxFacets) {
        break;
      }
      const source = sources.get(spec.key);
      const distribution = source?.facetDistribution?.[spec.field] ?? {};
      const counted = spec.level === "product";
      const chosen = selectedValues.get(spec.key) ?? new Set<string>();
      const value = (code: string, label: string | null) => ({
        code,
        label,
        count: counted ? (distribution[code] ?? 0) : null,
        selected: chosen.has(code),
      });
      let values: StoreSearchFacet["values"] = [];
      let label: string | null = null;
      let range: StoreSearchFacet["range"] = null;
      if (spec.kind === "range") {
        const stats = source?.facetStats?.[spec.field];
        range = stats === undefined ? null : { min: stats.min, max: stats.max };
      } else if (spec.kind === "boolean") {
        values = ["true", "false"]
          .filter((code) => code in distribution || chosen.has(code))
          .map((code) => value(code, null));
      } else if (spec.key === "brand") {
        values = Object.keys(distribution)
          .flatMap((slug) => {
            const name = text(brandNames.get(slug));
            return name === null ? [] : [value(slug, name)];
          })
          .sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
      } else if (spec.key === "category") {
        values = Object.keys(distribution)
          .flatMap((id) => {
            const category = definitions.categories.get(id);
            return category === undefined ? [] : [value(id, text(category.name))];
          })
          .sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
      } else if (spec.key.startsWith("opt.")) {
        const option = definitions.options.find((entry) => `opt.${entry.code}` === spec.key);
        label = text(option?.label);
        values = (option?.values ?? [])
          .filter((entry) => entry.code in distribution || chosen.has(entry.code))
          .map((entry) => value(entry.code, text(entry.label)));
      }
      if (spec.key.startsWith("attr.")) {
        const code = spec.key.slice(5);
        label = text(definitions.attributeNames.get(code));
      }
      if (spec.key.startsWith("attr.") && spec.kind === "code") {
        const code = spec.key.slice(5);
        const assignment = definitions.allAssignments.find(
          (entry) => entry.definition.code === code,
        );
        values = (assignment?.definition.options ?? [])
          .filter((entry) => entry.code in distribution || chosen.has(entry.code))
          .map((entry) => value(entry.code, text(entry.label)));
      }
      const hasSomething = values.length > 0 || range !== null || selectedKeys.has(spec.key);
      if (hasSomething) {
        facets.push({
          key: spec.key,
          kind: spec.kind,
          level: spec.level,
          label,
          counted,
          values,
          range,
        });
      }
    }
    return facets;
  }
}

/**
 * Defence in depth (docs/api/search.md): `parseSelectionParams` accepts only what `buildSearchFilter` can write, but if
 * the two ever disagree again the shopper gets `400`, not `500` (review F2).
 */
function planOrRefuse<T>(plan: () => T): T {
  try {
    return plan();
  } catch (error) {
    if (error instanceof SearchFilterError) {
      throw validationFailed([{ path: "f", code: error.reason }]);
    }
    throw error;
  }
}

function uniqueProductIds(result: EngineSearchResult): string[] {
  const ids: string[] = [];
  for (const hit of result.hits ?? []) {
    if (typeof hit.productId === "string" && !ids.includes(hit.productId)) {
      ids.push(hit.productId);
    }
  }
  return ids;
}

function selectedValuesOf(selection: SearchSelection): Map<string, Set<string>> {
  const values = new Map<string, Set<string>>();
  if (selection.brands !== undefined) values.set("brand", new Set(selection.brands));
  if (selection.categories !== undefined) values.set("category", new Set(selection.categories));
  if (selection.inStock !== undefined) values.set("inStock", new Set([String(selection.inStock)]));
  for (const [code, list] of Object.entries(selection.options ?? {})) {
    values.set(`opt.${code}`, new Set(list));
  }
  for (const [code, chosen] of Object.entries(selection.attributes ?? {})) {
    if (chosen.kind === "values") values.set(`attr.${code}`, new Set(chosen.values));
    if (chosen.kind === "boolean") values.set(`attr.${code}`, new Set([String(chosen.value)]));
  }
  return values;
}
