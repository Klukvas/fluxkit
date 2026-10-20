import type { AdminProductSummary, Paginated } from "@fluxkit/api-client";
import { createTranslator, type Translator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import {
  leftoverText,
  messagesForArea,
  renderInRouter,
  sentinelTranslator,
  textAttributes,
} from "../../test-helpers";
import type { ListState } from "../catalog-dictionaries/list-screen";
import { MESSAGE_FILES } from "./index";
import { readProductListQuery } from "./product-list-query";
import { ProductListView } from "./product-list-view";

const noop = () => undefined;

function product(overrides: Partial<AdminProductSummary> = {}): AdminProductSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    productTypeId: "22222222-2222-4222-8222-222222222222",
    brandId: "33333333-3333-4333-8333-333333333333",
    slug: "first-product",
    title: { uk: "Перший", en: "First" },
    description: null,
    status: "draft",
    attributes: {},
    publishedAt: null,
    createdAt: "2026-10-19T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

const page = (
  items: AdminProductSummary[],
  total = items.length,
): Paginated<AdminProductSummary> => ({
  items,
  total,
  limit: 50,
  offset: 0,
});

function render(
  state: ListState<AdminProductSummary>,
  options: {
    canCreate?: boolean;
    search?: string;
    t?: Translator;
    brandNames?: Map<string, string>;
  } = {},
) {
  return renderInRouter(
    <ProductListView
      t={options.t ?? sentinelTranslator()}
      uiLocale="en"
      defaultLocale="uk"
      query={readProductListQuery(new URLSearchParams(options.search ?? ""))}
      state={state}
      onRetry={noop}
      brandNames={options.brandNames ?? new Map([["33333333-3333-4333-8333-333333333333", "Acme"]])}
      canCreate={options.canCreate ?? true}
      searchText=""
      onSearchChange={noop}
      onSearchSubmit={noop}
      onStatusChange={noop}
      brandFilter={null}
      categoryFilter={null}
      hrefForOffset={(offset) => `/products?offset=${offset}`}
    />,
    "/products",
  );
}

function expectTranslated(html: string, data: string[] = []) {
  let text = html;
  for (const value of data) text = text.split(value).join(" ");
  expect(leftoverText(text)).toBe("");
  for (const value of textAttributes(html)) {
    if (data.some((entry) => value.includes(entry))) continue;
    expect(value.startsWith("§"), value).toBe(true);
  }
}

describe("product list screen", () => {
  it("shows skeleton rows while loading, one h1, the filters and the create link", () => {
    const html = render({ status: "loading" });
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain('method="post"');
    expect(html).toContain('href="/admin-ui/products/new"');
    expect(html).toContain('name="q"');
    expect(html).toContain('maxLength="160"');
    expectTranslated(html);
  });

  it("shows the rows: title in the UI language with fallback, slug, status as text, brand name, updated", () => {
    const html = render({
      status: "ready",
      data: page([
        product(),
        product({
          id: "44444444-4444-4444-8444-444444444444",
          slug: "second",
          title: { uk: "Другий" },
          status: "active",
          brandId: null,
        }),
        product({
          id: "55555555-5555-4555-8555-555555555555",
          slug: "third",
          title: {},
          status: "archived",
          brandId: "66666666-6666-4666-8666-666666666666",
        }),
      ]),
    });
    expect(html).toContain('href="/admin-ui/products/11111111-1111-4111-8111-111111111111"');
    expect(html).toContain(">First<");
    expect(html).toContain(">Другий<");
    expect(html).toContain(">third<");
    expect(html).toContain("§products.status.draft");
    expect(html).toContain("§products.status.active");
    expect(html).toContain("§products.status.archived");
    expect(html).toContain("Acme");
    expect(html).toContain("§products.list.noBrand");
    expect(html).toContain("66666666");
    expect(html).toContain('scope="row"');
    expect(html).toContain("§dict.list.range");
  });

  it("offers Create in the empty state only to an admin who may create", () => {
    const writer = render({ status: "ready", data: page([]) });
    expect(writer).toContain("§products.list.emptyTitle");
    expect(writer.match(/products\/new/g)?.length).toBe(2);
    const viewer = render({ status: "ready", data: page([]) }, { canCreate: false });
    expect(viewer).toContain("§products.list.emptyTitle");
    expect(viewer).not.toContain("products/new");
    expectTranslated(viewer);
  });

  it("says when filters match nothing, with a way to clear them", () => {
    const html = render({ status: "ready", data: page([]) }, { search: "status=archived" });
    expect(html).toContain("§products.list.noMatchTitle");
    expect(html).toContain("§products.list.clearFilters");
    expect(html).not.toContain("§products.list.emptyTitle");
  });

  it("shows a failure with a retry, and forbidden as not allowed", () => {
    const failed = render({ status: "error", failure: { kind: "network" } });
    expect(failed).toContain("§errors.network");
    expect(failed).toContain("§action.retry");
    const forbidden = render({ status: "forbidden" });
    expect(forbidden).toContain("§error.forbiddenData");
    expect(forbidden).not.toContain("<table");
  });

  it("renders every state with the real uk and en messages the area loads", async () => {
    for (const locale of ["uk", "en"] as const) {
      const t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
      for (const canCreate of [true, false]) {
        expect(render({ status: "loading" }, { t, canCreate })).toContain("<table");
        expect(render({ status: "ready", data: page([product()]) }, { t, canCreate })).toContain(
          "first-product",
        );
        expect(render({ status: "ready", data: page([]) }, { t, canCreate })).toContain("<h2");
        expect(
          render({ status: "ready", data: page([]) }, { t, canCreate, search: "q=abc" }),
        ).toContain("<h2");
        expect(render({ status: "error", failure: { kind: "timeout" } }, { t })).toContain(
          "<button",
        );
      }
    }
  });
});
