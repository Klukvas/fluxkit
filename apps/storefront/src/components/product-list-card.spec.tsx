import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { summary } from "../lib/test-fixtures";
import { ListViewToggle, withListView } from "./list-view-toggle";
import { ProductGrid, parseListView } from "./product-grid";
import { sentinelTranslator } from "./test-helpers";

const t = sentinelTranslator();

describe("list view (reshape experiment)", () => {
  const products = Array.from({ length: 3 }, (_, i) => summary(`p${i}`, { title: `§p${i}` }));
  const grid = (view: "grid" | "list") =>
    renderToStaticMarkup(
      <ProductGrid
        products={products}
        locale="uk"
        t={t}
        exponent={2}
        imageHosts={[]}
        headingLevel="h2"
        brandPathFor={(slug) => `/catalog?brand=${slug}`}
        label="§list"
        view={view}
      />,
    );

  it("draws one horizontal card per row in the list view, columns in the grid", () => {
    expect(grid("list")).toContain('class="flex flex-col gap-3"');
    expect(grid("grid")).toContain("lg:grid-cols-4");
    expect(grid("list").match(/<article/g)).toHaveLength(3);
    expect(grid("list")).toContain("§catalog.card.choose");
    expect(grid("grid")).not.toContain("§catalog.card.choose");
  });

  it("reads only view=list as the list", () => {
    expect(parseListView("list")).toBe("list");
    expect(parseListView(["list"])).toBe("grid");
    expect(parseListView(undefined)).toBe("grid");
  });

  it("links both views and marks the current one", () => {
    expect(withListView("/uk/catalog?sort=newest", "list")).toBe(
      "/uk/catalog?sort=newest&view=list",
    );
    const html = renderToStaticMarkup(<ListViewToggle t={t} view="list" href="/uk/catalog" />);
    expect(html).toContain('href="/uk/catalog"');
    expect(html).toMatch(/href="\/uk\/catalog\?view=list" aria-current="true"/);
  });
});
