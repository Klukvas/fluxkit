import { describe, expect, it } from "vitest";
import { DataTable, type DataTableColumn } from "./data-table";
import { DescriptionList } from "./description-list";
import { LiveRegion } from "./live-region";
import { StatusBadge } from "./status-badge";
import { first, render, tags, text } from "./test-helpers";

interface Row {
  id: string;
  name: string;
  sku: string;
}

const rows: Row[] = [
  { id: "1", name: "Mug", sku: "MUG-1" },
  { id: "2", name: "Cup", sku: "CUP-1" },
];

const columns: DataTableColumn<Row>[] = [
  { id: "name", header: "Name", cell: (row) => row.name },
  { id: "sku", header: "SKU", cell: (row) => row.sku, align: "end" },
];

interface Options {
  rows?: Row[];
  loading?: boolean;
  captionHidden?: boolean;
  actions?: boolean;
  rowHeaderColumnId?: string;
  loadingRowCount?: number;
  loadingLabel?: string;
}

const table = (options: Options = {}): string =>
  render(
    <DataTable
      caption="Products"
      columns={columns}
      rows={options.rows ?? rows}
      rowKey={(row) => row.id}
      emptyMessage="No products yet"
      {...(options.loading !== undefined ? { loading: options.loading } : {})}
      {...(options.captionHidden !== undefined ? { captionHidden: options.captionHidden } : {})}
      {...(options.rowHeaderColumnId ? { rowHeaderColumnId: options.rowHeaderColumnId } : {})}
      {...(options.loadingRowCount ? { loadingRowCount: options.loadingRowCount } : {})}
      {...(options.loadingLabel ? { loadingLabel: options.loadingLabel } : {})}
      {...(options.actions
        ? {
            actions: {
              header: "Actions",
              render: (row: Row) => <button type="button">Edit {row.name}</button>,
            },
          }
        : {})}
    />,
  );

describe("DataTable", () => {
  it("starts with a caption and gives every column header scope=col", () => {
    const markup = table();
    expect(markup).toMatch(/<table[^>]*><caption[^>]*>Products<\/caption>/);
    const headers = tags(markup, "th").filter((th) => th.attributes.scope === "col");
    expect(headers).toHaveLength(2);
    expect(text(markup).startsWith("Products Name SKU")).toBe(true);
  });

  it("can hide the caption visually and keeps it in the markup", () => {
    expect(first(table({ captionHidden: true }), "caption").attributes.class).toContain("sr-only");
    expect(first(table(), "caption").attributes.class).not.toContain("sr-only");
  });

  it("renders one row header (th scope=row) per row from the first column, other cells are td", () => {
    const markup = table();
    const rowHeaders = tags(markup, "th").filter((th) => th.attributes.scope === "row");
    expect(rowHeaders).toHaveLength(2);
    expect(markup).toMatch(/<th[^>]*scope="row"[^>]*>Mug<\/th><td[^>]*>MUG-1<\/td>/);
    expect(markup).toMatch(/<th[^>]*scope="row"[^>]*>Cup<\/th>/);
    expect(tags(markup, "td")).toHaveLength(2);
  });

  it("can take the row header from another column", () => {
    const markup = table({ rowHeaderColumnId: "sku" });
    expect(markup).toMatch(/<td[^>]*>Mug<\/td><th[^>]*scope="row"[^>]*>MUG-1<\/th>/);
  });

  it("throws for a row header column that does not exist", () => {
    expect(() => table({ rowHeaderColumnId: "nope" })).toThrow(/nope/);
  });

  it("aligns end columns with a logical utility", () => {
    expect(tags(table(), "td")[0]?.attributes.class).toContain("text-end");
  });

  it("adds an actions column: a column header and one cell per row", () => {
    const markup = table({ actions: true });
    expect(tags(markup, "th").filter((th) => th.attributes.scope === "col")).toHaveLength(3);
    expect(text(markup)).toContain("Edit Mug");
    expect(text(markup)).toContain("Edit Cup");
    expect(tags(markup, "td")).toHaveLength(4);
  });

  it("shows one empty-state row that spans every column, without row headers", () => {
    const markup = table({ rows: [], actions: true });
    const bodyCells = tags(markup, "td");
    expect(bodyCells).toHaveLength(1);
    expect(bodyCells[0]?.attributes.colSpan).toBe("3");
    expect(text(markup)).toContain("No products yet");
    expect(tags(markup, "th").filter((th) => th.attributes.scope === "row")).toHaveLength(0);
  });

  it("does not claim to be busy when not loading", () => {
    expect(first(table(), "table").attributes).not.toHaveProperty("aria-busy");
  });

  it("while loading sets aria-busy and renders skeleton rows instead of data or the empty state", () => {
    const markup = table({ loading: true, loadingRowCount: 3 });
    expect(first(markup, "table").attributes["aria-busy"]).toBe("true");
    expect(tags(markup, "tr")).toHaveLength(1 + 3);
    expect(markup).toContain("animate-pulse");
    expect(text(markup)).not.toContain("Mug");
    expect(text(markup)).not.toContain("No products yet");
    expect(text(table({ loading: true, rows: [] }))).not.toContain("No products yet");
  });

  it("loading rows keep the structure: a row header and a cell per column", () => {
    const markup = table({ loading: true, loadingRowCount: 2 });
    expect(tags(markup, "th").filter((th) => th.attributes.scope === "row")).toHaveLength(2);
    expect(tags(markup, "td")).toHaveLength(2);
  });

  it("announces the loading state through a visually hidden label", () => {
    const markup = table({ loading: true, loadingLabel: "Loading products" });
    expect(markup).toMatch(/<span class="sr-only">Loading products<\/span>/);
    expect(markup.match(/Loading products/g)).toHaveLength(1);
  });

  it("scrolls horizontally inside a wrapper instead of widening the page", () => {
    expect(first(table(), "div").attributes.class).toContain("overflow-x-auto");
  });
});

describe("DescriptionList", () => {
  it("renders terms and descriptions as dl, dt and dd in order", () => {
    const markup = render(
      <DescriptionList
        items={[
          { id: "a", term: "Email", description: "a@example.test" },
          { id: "b", term: "Role", description: "Owner" },
        ]}
      />,
    );
    expect(tags(markup, "dl")).toHaveLength(1);
    expect(tags(markup, "dt")).toHaveLength(2);
    expect(tags(markup, "dd")).toHaveLength(2);
    expect(markup).toMatch(/<dt[^>]*>Email<\/dt><dd[^>]*>a@example.test<\/dd>/);
    expect(text(markup)).toBe("Email a@example.test Role Owner");
  });
});

describe("StatusBadge", () => {
  it("shows the status as text and maps the tone to a token", () => {
    for (const [tone, token] of [
      ["neutral", "text-foreground"],
      ["success", "text-success"],
      ["warning", "text-warning"],
      ["danger", "text-danger"],
    ] as const) {
      const markup = render(<StatusBadge tone={tone} label="Paid" />);
      expect(text(markup)).toBe("Paid");
      expect(first(markup, "span").attributes.class).toContain(token);
    }
  });
});

describe("LiveRegion", () => {
  it("is a polite, atomic status region", () => {
    const tag = first(render(<LiveRegion>Saved</LiveRegion>), "div");
    expect(tag.attributes).toMatchObject({
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true",
    });
  });

  it("is rendered even when empty, so later messages are announced", () => {
    const markup = render(<LiveRegion>{null}</LiveRegion>);
    expect(first(markup, "div").attributes.role).toBe("status");
    expect(text(markup)).toBe("");
  });

  it("can be visually hidden", () => {
    expect(
      first(render(<LiveRegion visuallyHidden>Saved</LiveRegion>), "div").attributes.class,
    ).toContain("sr-only");
    expect(first(render(<LiveRegion>Saved</LiveRegion>), "div").attributes).not.toHaveProperty(
      "class",
    );
  });
});
