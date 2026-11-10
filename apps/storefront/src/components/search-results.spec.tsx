import type { SearchFacet, SearchItem, SearchMatch, SearchResult } from "@fluxkit/api-client";
import { createTranslator } from "@fluxkit/ui";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { formatMoney } from "../lib/money";
import type { SearchQuery } from "../lib/search-query";
import { summary } from "../lib/test-fixtures";
import { messagesByLocale } from "../messages";
import { I18nProvider } from "./i18n-provider";
import { SearchResultsView, type SearchPageOutcome } from "./search-results";
import { leftoverText, sentinelTranslator, textAttributes } from "./test-helpers";

const { uk, en } = messagesByLocale;

// The results render the template's built-in cards here, whatever a fork registers in `cards/custom.ts` (plan L2,
// `test-support/template-defaults.ts`); the fork's own cards, the fork run (`vitest.brand-fork.config.ts`).
vi.mock("./cards/custom", () => import("../test-support/template-defaults"));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/uk/search",
  useSearchParams: () => new URLSearchParams(),
}));

const t = sentinelTranslator();
const sentinelMessages = Object.fromEntries(Object.keys(uk).map((key) => [key, `§${key}`]));
const emptyQuery: SearchQuery = { q: "", facets: [], price: null, sort: null, page: 1 };
const query: SearchQuery = { ...emptyQuery, q: "lamp" };
const money = (amount: number) => formatMoney({ amount, currency: "UAH" }, 2, "uk");

const brand: SearchFacet = {
  key: "brand",
  kind: "slug",
  level: "product",
  label: null,
  counted: true,
  values: [
    { code: "acme", label: "§Acme", count: 4, selected: false },
    { code: "zeta", label: "§Zeta", count: 2, selected: true },
  ],
  range: null,
};
const inStock: SearchFacet = {
  key: "inStock",
  kind: "boolean",
  level: "variant",
  label: null,
  counted: false,
  values: [{ code: "true", label: null, count: null, selected: false }],
  range: null,
};
const colour: SearchFacet = {
  key: "opt.shade",
  kind: "code",
  level: "variant",
  label: "§Shade",
  counted: false,
  values: [{ code: "warm", label: "§Warm", count: null, selected: false }],
  range: null,
};
const length: SearchFacet = {
  key: "attr.length",
  kind: "range",
  level: "product",
  label: "§Length",
  counted: false,
  values: [],
  range: { min: 1, max: 9 },
};

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    items: [summary("lamp", { title: "§lamp" }), summary("desk-lamp", { title: "§desk" })],
    total: 2,
    page: 1,
    pageCount: 1,
    limit: 24,
    sort: "relevance",
    relaxed: false,
    query: { normalized: "lamp" },
    facets: [brand, inStock, colour, length],
    price: { min: 1999, max: 250000 },
    ...overrides,
  };
}

function render(
  outcome: SearchPageOutcome,
  options: {
    query?: SearchQuery;
    locale?: "uk" | "en";
    translate?: typeof t;
    messages?: Record<string, string>;
  } = {},
): string {
  const locale = options.locale ?? "uk";
  return renderToStaticMarkup(
    <I18nProvider locale={locale} messages={options.messages ?? sentinelMessages}>
      <SearchResultsView
        locale={locale}
        t={options.translate ?? t}
        query={options.query ?? query}
        outcome={outcome}
        currency="UAH"
        exponent={2}
        imageHosts={[]}
      />
    </I18nProvider>,
  );
}

const ok = (overrides: Partial<SearchResult> = {}): SearchPageOutcome => ({
  kind: "results",
  result: result(overrides),
});

describe("cards from the item's match (PR 214 `match`, plan 2026-11-03)", () => {
  const match = (overrides: Partial<SearchMatch> = {}): SearchMatch => ({
    variantId: "v-red-l",
    variantCount: 1,
    price: { from: 2999, to: 2999, currency: "UAH" },
    availability: "in_stock",
    optionValues: [
      { optionCode: "color", valueCode: "red" },
      { optionCode: "size", valueCode: "l" },
    ],
    ...overrides,
  });
  // The product: from 19.99 to 99.99, in stock. Every assertion below must come from the match instead.
  const product = (slug: string, title: string): SearchItem =>
    summary(slug, { title, price: { from: 1999, to: 9999, currency: "UAH" } });
  const optionQuery: SearchQuery = { ...query, facets: ["opt.color:red", "opt.size:l"] };

  it("shows the matched variant's price, availability and a link that preselects it", () => {
    const html = render(ok({ items: [{ ...product("lamp", "§lamp"), match: match() }] }), {
      query: optionQuery,
    });
    expect(html).toContain(money(2999));
    expect(html).not.toContain("§catalog.price.from");
    expect(html).toContain("§availability.in_stock");
    expect(html).toContain('href="/uk/p/lamp?opt.color=red&amp;opt.size=l"');
    expect(html).not.toContain("§search.card.dependsOnOption");
    expect(html).not.toContain("§search.card.matchingOptions");
  });

  it("says 'from' and how many options match when the matched variants differ (several options)", () => {
    const several = match({ variantCount: 3, price: { from: 2999, to: 4999, currency: "UAH" } });
    const html = render(ok({ items: [{ ...product("lamp", "§lamp"), match: several }] }), {
      query: { ...query, facets: ["opt.color:red", "opt.color:blue"] },
    });
    expect(html).toContain("§catalog.price.from");
    expect(html).toContain("§search.card.matchingOptions:3");
    expect(html).toContain('href="/uk/p/lamp?opt.color=red&amp;opt.size=l"');
  });

  it("never claims 'In stock' for a low-stock representative (PR 213 review M1), whatever the product says", () => {
    const html = render(
      ok({
        items: [{ ...product("lamp", "§lamp"), match: match({ availability: "low_stock" }) }],
      }),
      { query: { ...query, facets: ["inStock:true"] } },
    );
    expect(html).toContain("§availability.low_stock");
    expect(html).not.toContain("§availability.in_stock");
  });

  it("shows out of stock under the availability filter's other side and a price range's matched price", () => {
    const out = render(
      ok({
        items: [{ ...product("lamp", "§lamp"), match: match({ availability: "out_of_stock" }) }],
      }),
      { query: { ...query, facets: ["inStock:false"] } },
    );
    expect(out).toContain("§availability.out_of_stock");
    expect(out).not.toContain("§availability.in_stock");
    const priced = render(
      ok({
        items: [
          {
            ...product("lamp", "§lamp"),
            match: match({ price: { from: 5000, to: 5000, currency: "UAH" } }),
          },
        ],
      }),
      { query: { ...query, price: { min: 4000, max: 6000 } } },
    );
    expect(priced).toContain(money(5000));
    expect(priced).not.toContain(money(1999));
  });

  it("falls back to the neutral note while the index catches up (match null): no badge, the pinned options in the link", () => {
    const html = render(
      ok({
        items: [
          { ...product("lamp", "§lamp"), match: null },
          { ...product("desk-lamp", "§desk"), match: match() },
        ],
      }),
      { query: optionQuery },
    );
    expect(html.match(/§search\.card\.dependsOnOption/g)).toHaveLength(1);
    expect(html.match(/§availability\./g)).toHaveLength(1);
    expect(html).toContain('href="/uk/p/lamp?opt.color=red&amp;opt.size=l"');
    expect(html).toContain('href="/uk/p/desk-lamp?opt.color=red&amp;opt.size=l"');
  });

  it("keeps the product's own price, stock and plain link when the item has no match", () => {
    const html = render(ok(), { query: { ...query, facets: ["brand:zeta"] } });
    expect(html.match(/§availability\.in_stock/g)).toHaveLength(2);
    expect(html).not.toContain("§search.card.");
    expect(html).toContain('href="/uk/p/lamp"');
  });

  // PR 215 review m4: next to the best availability, "3 matching options" alone reads as "all 3 in stock".
  it("says that the badge shows the best of several matching options, in both languages", () => {
    expect(en["search.card.matchingOptions.other"]).toMatch(/best/);
    for (const form of ["one", "few", "many", "other"]) {
      expect(uk[`search.card.matchingOptions.${form}` as keyof typeof uk]).toMatch(/найкращ/);
    }
  });

  it("has no stop-gap wording of PR 213 left in the messages", () => {
    for (const messages of [uk, en] as Record<string, string>[]) {
      expect(messages["search.card.priceDependsOnOption"]).toBeUndefined();
      expect(messages["search.card.stockDependsOnOption"]).toBeUndefined();
    }
  });
});

describe("results page markup", () => {
  const html = render(ok(), {
    query: { ...query, facets: ["brand:zeta"], price: { min: 1000, max: null } },
  });

  it("has one h1 with the words, then an h2 count inside a polite live region that can take the focus", () => {
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain("§search.heading.query");
    expect(html).toMatch(
      /<div role="status" aria-live="polite" aria-atomic="true"><h2 id="search-results-heading" tabindex="-1"[^>]*>§search\.count:2<\/h2><\/div>/,
    );
  });

  it("labels the filters and the results as landmarks, and the pages as a nav", () => {
    expect(html).toContain('<aside aria-label="§search.filters.title"');
    expect(html).toContain('<section aria-label="§search.list.label"');
    expect(html).toContain('aria-label="§breadcrumbs.label"');
  });

  it("makes the facet panel a plain GET form with the words in a hidden field: it works before the script loads", () => {
    const form = html.match(/<form [^>]*>/)?.[0] ?? "";
    expect(form).toContain('id="search-filters"');
    expect(form).toContain('method="get"');
    // The page's own path, without the `#search-filters-panel` fragment that opens the panel on a phone without a script.
    expect(form).toContain('action="/uk/search"');
    expect(html).toContain('<input type="hidden" name="q" value="lamp"/>');
    expect(html).toContain("§search.filters.apply");
    expect(html).toMatch(/<button type="submit"[^>]*>§search\.filters\.apply<\/button>/);
  });

  it("is a fieldset with a legend per facet, one checkbox per value named f with the API's parameter, counts only where the API gives one", () => {
    expect(html).toContain("<legend");
    expect(html).toContain('name="f" value="brand:acme"');
    expect(html).toContain('name="f" checked="" value="brand:zeta"');
    expect(html).toContain('name="f" value="inStock:true"');
    expect(html).toContain('name="f" value="opt.shade:warm"');
    expect(html).toContain("§Acme<span");
    expect(html).toContain("(4)");
    expect(html).toContain("(2)");
    // The variant-level facets have no count at all, not a zero or a guess.
    expect(html).toMatch(/§search\.facet\.inStock\.true<\/span><\/label>/);
    expect(html).toMatch(/§Warm<\/span><\/label>/);
    expect(html).toContain("§search.facet.brand");
    expect(html).toContain("§Shade");
  });

  it("gives the price and every number attribute two labelled boxes, the price holding the chosen minimum in major units", () => {
    expect(html).toContain('name="priceMin"');
    expect(html).toContain('name="priceMax"');
    expect(html).toContain('value="10"');
    expect(html).toContain('placeholder="2500"');
    expect(html).toContain('name="rmin.attr.length"');
    expect(html).toContain('name="rmax.attr.length"');
    expect(html).toContain('placeholder="1"');
    expect((html.match(/<label[^>]*>\s*<span>§search\.facet\.min<\/span>/g) ?? []).length).toBe(2);
  });

  it("puts the sort select in the form by its form attribute, with the choice in force selected", () => {
    expect(html).toMatch(/<select[^>]*form="search-filters"[^>]*name="sort"/);
    expect(html).toContain('<option value="relevance" selected="">§search.sort.relevance</option>');
    expect(html).toContain("§search.sort.price_asc");
  });

  it("lists the chosen filters with a link that removes each one and one that clears them all", () => {
    expect(html).toContain('aria-label="§search.filters.selected"');
    expect(html).toContain('href="/uk/search?q=lamp&amp;price=1000.."');
    expect(html).toContain('href="/uk/search?q=lamp&amp;f=brand%3Azeta"');
    expect(html).toContain('href="/uk/search?q=lamp"');
    expect(html).toContain("§search.filters.clear");
  });

  it("lists the products as headings of level 3 under the count, each once", () => {
    expect(html).toContain('<ul aria-label="§search.list.label"');
    expect(html).toContain("§lamp");
    expect(html.match(/<h3[ >]/g)).toHaveLength(2);
  });

  it("starts the filter panel closed below the lg width, behind a 'Filters (N)' link that opens it (a sheet with a script, in place by :target without one)", () => {
    expect(html).toMatch(
      /<a href="#search-filters-panel" id="search-filters-button" aria-controls="search-filters-panel" aria-haspopup="dialog" aria-expanded="false"/,
    );
    // Two chosen filters on this address (a brand and a price).
    expect(html).toContain(">§search.filters.withCount</a>");
    expect(html).toContain('id="search-filters-panel" class="fk-filter-panel"');
    expect(html).not.toContain('role="dialog"');
  });

  it("keeps the results in a region that is not busy until a change is pending", () => {
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain("§searchForm.updating");
  });
});

describe("selected-filter chips (review F6)", () => {
  it("are keyed by the chip's facet key and value, never by the label two facets can share", () => {
    const source = readFileSync(new URL("./search-results.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/<li key=\{chip\.key\}>/);
    expect(source).not.toMatch(/key=\{chip\.label\}/);
  });
});

describe("results page states", () => {
  it("says so when search found broader results", () => {
    expect(render(ok({ relaxed: true }))).toContain("§search.relaxed");
    expect(render(ok())).not.toContain("§search.relaxed");
  });

  it("shows nothing found with a way out: the catalog without filters, the filters' reset with them", () => {
    const plain = render(ok({ items: [], total: 0, facets: [] }));
    expect(plain).toContain("§search.empty.title");
    expect(plain).toContain("§search.empty.description");
    expect(plain).toContain('href="/uk/catalog"');
    expect(plain).not.toContain('<ul aria-label="§search.list.label"');
    const filtered = render(ok({ items: [], total: 0 }), {
      query: { ...query, facets: ["brand:zeta"] },
    });
    expect(filtered).toContain("§search.empty.filtered");
    expect(filtered).toContain('href="/uk/search?q=lamp"');
    expect(filtered).toContain("§search.empty.clear");
  });

  // Review D-14: nothing found for the words alone is not a filter page.
  it("drops the filter panel and the sort when nothing is found without filters, and offers the categories", () => {
    const categories = [
      { slug: "tools", name: "§tools" },
      { slug: "a b", name: "§spaced" },
    ];
    const plain = renderToStaticMarkup(
      <I18nProvider locale="uk" messages={sentinelMessages}>
        <SearchResultsView
          locale="uk"
          t={t}
          query={query}
          outcome={ok({ items: [], total: 0 })}
          currency="UAH"
          exponent={2}
          imageHosts={[]}
          categories={categories}
        />
      </I18nProvider>,
    );
    expect(plain).not.toContain('id="search-filters-panel"');
    expect(plain).not.toContain("§search.sort.label");
    expect(plain).toMatch(/§search\.count/);
    expect(plain).toContain("§search.empty.categories");
    expect(plain).toContain('href="/uk/c/tools"');
    expect(plain).toContain('href="/uk/c/a%20b"');
    // Without categories (an outage of the category read) the empty state stays, without the list.
    const without = render(ok({ items: [], total: 0 }));
    expect(without).toContain("§search.empty.title");
    expect(without).not.toContain("§search.empty.categories");
    // With a selected filter the panel stays: the shopper widens the search there.
    const filtered = render(ok({ items: [], total: 0 }), {
      query: { ...query, facets: ["brand:zeta"] },
    });
    expect(filtered).toContain('id="search-filters-panel"');
  });

  // PR 213 review m11: the "searches in <language>" sentence only when the words are in another script than the page's
  // (the case of a language switch on a results page), not on every empty result.
  it("names the page's search language only for words written in another script", () => {
    const empty = ok({ items: [], total: 0, facets: [] });
    expect(render(empty, { query: emptyQuery })).not.toContain("§search.empty.otherLanguage");
    expect(render(empty, { query: { ...query, q: "молоток" } })).not.toContain(
      "§search.empty.otherLanguage",
    );
    const english = render(empty, { locale: "en", query: { ...query, q: "молоток" } });
    expect(english).toContain("§search.empty.otherLanguage");
    expect(render(empty, { locale: "en", query: { ...query, q: "hammer 2" } })).not.toContain(
      "§search.empty.otherLanguage",
    );
    expect(render(empty, { query: { ...query, q: "hammer" } })).toContain(
      "§search.empty.otherLanguage",
    );
  });

  it("pages with real links, never past the API's limit, and says at the end that only the first 10 000 can be shown", () => {
    const html = render(ok({ page: 2, pageCount: 500, total: 10_000 }), {
      query: { ...query, page: 2 },
    });
    expect(html).toContain('aria-label="§search.pagination.label"');
    expect(html).toContain('href="/uk/search?q=lamp"');
    expect(html).toContain('href="/uk/search?q=lamp&amp;page=3"');
    expect(html).toContain('aria-label="§catalog.pagination.page"');
    // 417 is the last page the API reaches; 418 never appears.
    expect(html).toContain('href="/uk/search?q=lamp&amp;page=417"');
    expect(html).not.toContain("page=418");
    expect(html).toContain("§search.limit");
    expect(render(ok({ total: 9_999, pageCount: 417 }))).not.toContain("§search.limit");
  });

  it("explains an unavailable search with a retry and a way to the catalog, and the wait when the API gave one", () => {
    const html = render({ kind: "unavailable", retryAfterSeconds: 30 });
    expect(html).toContain("§search.unavailable.title");
    expect(html).toContain("§errors.search_unavailable");
    expect(html).toContain("§errors.retryAfter:30");
    expect(html).toContain('href="/uk/search?q=lamp"');
    expect(html).toContain('href="/uk/catalog"');
    expect(html).not.toContain("<aside");
    expect(render({ kind: "unavailable", retryAfterSeconds: null })).not.toContain(
      "errors.retryAfter",
    );
  });

  it("explains a rate limit with the wait", () => {
    const html = render({ kind: "rate_limited", retryAfterSeconds: 42 });
    expect(html).toContain("§search.rateLimited.title");
    expect(html).toContain("§errors.too_many_requests");
    expect(html).toContain("§errors.retryAfter:42");
  });

  it("explains filters the API refuses and offers to clear them", () => {
    const html = render(
      { kind: "invalid", reason: "filter" },
      { query: { ...query, facets: ["brand:gone"] } },
    );
    expect(html).toContain("§search.invalid.title");
    expect(html).toContain('href="/uk/search?q=lamp"');
  });

  it("names a range the API cannot read as a range, not as a missing filter (review F4)", () => {
    const html = render(
      { kind: "invalid", reason: "range" },
      { query: { ...query, facets: ["attr.length:0.0000001.."] } },
    );
    expect(html).toContain("§search.invalidRange.title");
    expect(html).toContain("§search.invalidRange.description");
    expect(html).not.toContain("§search.invalid.title");
    expect(html).toContain('href="/uk/search?q=lamp"');
  });

  it("browses without words under its own heading", () => {
    const html = render(ok(), { query: emptyQuery });
    expect(html).toContain("§search.heading.browse");
    expect(html).not.toContain('<option value="relevance"');
  });
});

describe("what the shopper typed", () => {
  const hostile = "<script>alert(1)</script><img src=x onerror=alert(1)>\"'&";
  const real = createTranslator(en, "en");
  // With a result, so the filter form (its hidden field) and the page links are rendered too.
  const html = render(ok(), {
    locale: "en",
    translate: real,
    messages: en,
    query: { ...query, q: hostile },
  });

  it("is escaped in the heading and the hidden field: no tag, no attribute, no entity of it reaches the page as markup", () => {
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toMatch(/<img[^>]*onerror/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&quot;");
    // The same text in the address of a link is percent-encoded, so it can never end the attribute.
    expect(html).toContain("q=%3Cscript%3E");
  });

  it("is shown as text in the heading", () => {
    expect(html).toMatch(/<h1[^>]*>Results for “&lt;script&gt;/);
  });
});

describe("no hardcoded words and both locales", () => {
  const states: [string, SearchPageOutcome, SearchQuery][] = [
    [
      "results",
      ok({ relaxed: true, total: 10_000, pageCount: 417 }),
      { ...query, facets: ["brand:zeta", "attr.length:2..5"], price: { min: 1, max: 9 } },
    ],
    ["empty", ok({ items: [], total: 0 }), query],
    ["unavailable", { kind: "unavailable", retryAfterSeconds: 30 }, query],
    ["rate limited", { kind: "rate_limited", retryAfterSeconds: 5 }, query],
    ["invalid", { kind: "invalid", reason: "filter" }, query],
    ["invalid range", { kind: "invalid", reason: "range" }, query],
  ];

  it.each(states)("%s: every word is a translated message", (_name, outcome, current) => {
    const html = render(outcome, { query: current });
    const rest = leftoverText(html)
      .replaceAll(money(1999), " ")
      .replace(/[×−&/…().,₴]/g, " ")
      .replace(/\b(lamp)\b/g, " ")
      .trim();
    // What is left is the data of the demo (titles and facet labels are sentinels too) and nothing else.
    expect(rest, `${_name}: ${rest}`).toBe("");
    for (const text of textAttributes(html)) {
      expect(text, `${_name}: attribute "${text}"`).toMatch(
        /^(§[A-Za-z0-9_.:-]+\s*)+$|^[0-9.,\s-]*$/,
      );
    }
  });

  it.each(["uk", "en"] as const)(
    "renders every state in %s with the real messages and no missing key",
    (locale) => {
      const messages = locale === "uk" ? uk : en;
      const real = createTranslator(messages, locale);
      for (const [, outcome, current] of states) {
        const html = render(outcome, { locale, translate: real, messages, query: current });
        // The demo data is sentinel text (§Acme); a translated message never is.
        expect(html).not.toMatch(/§(search|searchBox|searchForm|errors|catalog|breadcrumbs)\./);
        expect(html).not.toMatch(/\b(search|searchBox|searchForm)\.[a-z]+\.[a-zA-Z.]+/);
      }
    },
  );

  it("has a word for every sort, every fixed facet and the true/false of boolean values in both locales", () => {
    for (const messages of [uk, en] as Record<string, string>[]) {
      for (const key of [
        "search.sort.relevance",
        "search.sort.newest",
        "search.sort.price_asc",
        "search.sort.price_desc",
        "search.facet.brand",
        "search.facet.category",
        "search.facet.inStock",
        "search.facet.inStock.true",
        "search.facet.inStock.false",
        "search.facet.true",
        "search.facet.false",
      ]) {
        expect(messages[key], key).toBeTruthy();
      }
    }
  });
});

// Presentation URL parameters (plan 2026-11-08-design-changeability.md, L2/L5): the list/grid switch of the results.
describe("the list/grid view (?view=)", () => {
  const listQuery: SearchQuery = { ...query, facets: ["brand:zeta"], view: "list" };
  const many = ok({ page: 2, pageCount: 3, total: 50 });

  it("offers the switch in the results toolbar, grid current by default, and renders grid cards", () => {
    const html = render(many, { query: { ...query, page: 2 } });
    const group =
      /<div role="group" aria-label="§catalog\.view\.label"[^>]*>.*?<\/div>/.exec(html)?.[0] ?? "";
    expect(group).toMatch(
      /<a [^>]*href="\/uk\/search\?q=lamp&amp;page=2"[^>]*aria-current="true"[^>]*>§catalog\.view\.grid</,
    );
    expect(group).toMatch(
      /<a [^>]*href="\/uk\/search\?q=lamp&amp;page=2&amp;view=list"[^>]*>§catalog\.view\.list</,
    );
    // Reading order: the count, the view, the sort.
    expect(html.indexOf("search-results-heading")).toBeLessThan(
      html.indexOf("§catalog.view.label"),
    );
    expect(html.indexOf("§catalog.view.label")).toBeLessThan(html.indexOf("§search.sort.label"));
    expect(html).toContain('class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4"');
    expect(html).not.toContain('name="view"');
  });

  it("with view=list: list cards, the switch on list, and every filter, chip and page link keeps the view", () => {
    const html = render(many, { query: { ...listQuery, page: 2 } });
    expect(html).toMatch(/<a [^>]*aria-current="true"[^>]*>§catalog\.view\.list</);
    expect(html).toContain('<ul aria-label="§search.list.label" class="grid grid-cols-1 gap-4">');
    // The filter form sends the view along (a hidden field), so applying filters keeps it, with or without a script.
    expect(html).toContain('<input type="hidden" name="view" value="list"/>');
    const hrefs = [...html.matchAll(/href="(\/uk\/search[^"]*)"/g)].map((match) => match[1] ?? "");
    // Every link of the results keeps the view, but the switch's own "grid" link.
    expect(hrefs.filter((href) => !href.includes("view=list"))).toEqual([
      "/uk/search?q=lamp&amp;f=brand%3Azeta&amp;page=2",
    ]);
    expect(hrefs.length).toBeGreaterThan(4);
  });

  it("shows no switch when nothing is found", () => {
    expect(render(ok({ items: [], total: 0 }), { query: listQuery })).not.toContain(
      "§catalog.view.label",
    );
  });
});
