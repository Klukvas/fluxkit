import type { SearchFacet, SearchResult } from "@fluxkit/api-client";
import { createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { formatMoney } from "../lib/money";
import type { SearchQuery } from "../lib/search-query";
import { summary } from "../lib/test-fixtures";
import en from "../messages/en.json";
import uk from "../messages/uk.json";
import { I18nProvider } from "./i18n-provider";
import { SearchResultsView, type SearchPageOutcome } from "./search-results";
import { leftoverText, sentinelTranslator, textAttributes } from "./test-helpers";

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
    expect(form).not.toContain("action=");
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

  it("starts the filter panel closed below the lg width, behind a toggle that says what it controls", () => {
    expect(html).toMatch(
      /<button type="button" aria-expanded="false" aria-controls="search-filters-panel"/,
    );
    expect(html).toContain('id="search-filters-panel" class="hidden lg:block"');
  });

  it("keeps the results in a region that is not busy until a change is pending", () => {
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain("§searchForm.updating");
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
  const html = render(ok({ items: [], total: 0 }), {
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
