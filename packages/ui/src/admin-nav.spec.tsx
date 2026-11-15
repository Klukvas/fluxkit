import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { HomeIcon } from "./icons";
import { FilterBar } from "./filter-bar";
import { SideNav, type SideNavGroup } from "./side-nav";
import { first, render, tags, text } from "./test-helpers";

const groups: SideNavGroup[] = [
  {
    id: "catalog",
    heading: "Catalog",
    items: [
      { id: "products", label: "Products", href: "/admin-ui/products", current: true },
      { id: "brands", label: "Brands", href: "/admin-ui/brands" },
    ],
  },
  { id: "sales", items: [{ id: "orders", label: "Orders", href: "/admin-ui/orders" }] },
];

describe("SideNav", () => {
  it("preserves comfortable spacing by default and when explicitly requested", () => {
    for (const density of [undefined, "comfortable"] as const) {
      const markup = render(<SideNav label="Main" groups={groups} density={density} />);
      expect(first(markup, "nav").attributes.class).toBe("flex flex-col gap-6");
      expect(first(markup, "ul").attributes.class).toBe("flex flex-col gap-1");
      expect(first(markup, "a").attributes.class).toContain(
        "flex min-h-11 items-center gap-3 rounded-control px-3 py-2 font-medium",
      );
      expect(markup).not.toContain("pointer-coarse:");
    }
  });

  it("opts into compact spacing while retaining coarse-pointer targets and focus styles", () => {
    const markup = render(<SideNav label="Main" groups={groups} density="compact" />);
    expect(first(markup, "nav").attributes.class).toBe("flex flex-col gap-2");
    expect(first(markup, "ul").attributes.class).toBe("flex flex-col gap-0.5");
    for (const link of tags(markup, "a")) {
      const classes = String(link.attributes.class).split(" ");
      expect(classes).toEqual(
        expect.arrayContaining([
          "min-h-9",
          "py-1",
          "text-sm",
          "pointer-coarse:min-h-11",
          "focus-visible:outline-ring",
        ]),
      );
      expect(classes).not.toContain("min-h-11");
      expect(classes).not.toContain("py-2");
    }
  });

  it("opts into muted current items, hidden names and labelled group separators", () => {
    const iconGroups = groups.map((group) => ({
      ...group,
      items: group.items.map((item) => ({ ...item, icon: <HomeIcon /> })),
    }));
    const markup = render(
      <SideNav label="Main" groups={iconGroups} collapsed currentTone="muted" />,
    );
    expect(first(markup, "a").attributes.class).toContain("bg-muted text-foreground");
    expect(markup).not.toContain("bg-primary");
    expect(markup).toContain('<span class="sr-only">Products</span>');
    expect(first(markup, "svg").attributes["aria-hidden"]).toBe("true");
    expect(first(markup, "h2").attributes.class).toContain("sr-only");
    expect(first(markup, "ul").attributes["aria-labelledby"]).toBe(
      first(markup, "h2").attributes.id,
    );
    expect(markup).toContain('aria-hidden="true" class="mb-2 border-t border-border"');
    expect(markup).toContain('popover="manual"');
  });

  it("keeps missing-icon labels visible and heading ids unique across responsive instances", () => {
    const markup = render(
      <>
        <SideNav label="A" groups={groups} collapsed />
        <SideNav label="B" groups={groups} />
      </>,
    );
    const ids = tags(markup, "h2").map((heading) => heading.attributes.id);
    expect(new Set(ids).size).toBe(2);
    expect(markup).not.toContain('<span class="sr-only">Products</span>');
    expect(markup).not.toContain('popover="manual"');
  });

  it("is a labelled nav with a list of links per group", () => {
    const markup = render(<SideNav label="Main" groups={groups} />);
    expect(first(markup, "nav").attributes["aria-label"]).toBe("Main");
    expect(tags(markup, "ul")).toHaveLength(2);
    expect(tags(markup, "a").map((link) => link.attributes.href)).toEqual([
      "/admin-ui/products",
      "/admin-ui/brands",
      "/admin-ui/orders",
    ]);
  });

  it("marks exactly the current item with aria-current=page", () => {
    const current = tags(render(<SideNav label="Main" groups={groups} />), "a").filter(
      (link) => "aria-current" in link.attributes,
    );
    expect(current).toHaveLength(1);
    expect(current[0]?.attributes).toMatchObject({
      "aria-current": "page",
      href: "/admin-ui/products",
    });
  });

  it("labels a group's list with its heading and leaves a group without heading unlabelled", () => {
    const markup = render(<SideNav label="Main" groups={groups} />);
    const heading = first(markup, "h2");
    expect(markup).toMatch(/<h2[^>]*>Catalog<\/h2>/);
    const [labelled, bare] = tags(markup, "ul");
    expect(labelled?.attributes["aria-labelledby"]).toBe(heading.attributes.id);
    expect(bare?.attributes).not.toHaveProperty("aria-labelledby");
    expect(tags(markup, "h2")).toHaveLength(1);
  });

  it("lets the heading level be chosen", () => {
    const markup = render(<SideNav label="Main" groups={groups} headingAs="h3" />);
    expect(tags(markup, "h3")).toHaveLength(1);
    expect(tags(markup, "h2")).toHaveLength(0);
  });

  it("renders links through renderLink, passing href, classes, aria-current and the label", () => {
    const markup = render(
      <SideNav
        label="Main"
        groups={groups}
        renderLink={({ href, className, children, ...rest }): ReactNode => (
          <a data-router="1" href={href} className={className} {...rest}>
            {children}
          </a>
        )}
      />,
    );
    const links = tags(markup, "a");
    expect(links.every((link) => link.attributes["data-router"] === "1")).toBe(true);
    expect(links.filter((link) => link.attributes["aria-current"] === "page")).toHaveLength(1);
    expect(links.every((link) => String(link.attributes.class).length > 0)).toBe(true);
    expect(text(markup)).toBe("Catalog Products Brands Orders");
  });

  it("styles the current item differently from the others by a token pair", () => {
    const links = tags(render(<SideNav label="Main" groups={groups} />), "a");
    expect(links[0]?.attributes.class).toContain("bg-primary");
    expect(links[1]?.attributes.class).not.toContain("bg-primary");
  });
});

describe("FilterBar", () => {
  it("is a labelled form region around its children", () => {
    const markup = render(
      <FilterBar label="Filter orders">
        <input aria-label="Search" />
      </FilterBar>,
    );
    expect(first(markup, "form").attributes["aria-label"]).toBe("Filter orders");
    expect(tags(markup, "input")).toHaveLength(1);
  });

  it("always posts, so a submit before the script runs never puts the values into the URL", () => {
    expect(first(render(<FilterBar label="Filter">x</FilterBar>), "form").attributes.method).toBe(
      "post",
    );
  });

  it("passes other native form attributes through", () => {
    const markup = render(
      <FilterBar label="Filter" action="/x" className="extra">
        x
      </FilterBar>,
    );
    expect(first(markup, "form").attributes).toMatchObject({ action: "/x" });
    expect(first(markup, "form").attributes.class).toContain("extra");
  });
});
