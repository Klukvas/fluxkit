import { describe, expect, it } from "vitest";
import { Breadcrumbs } from "./breadcrumbs";
import { Pagination, pageItems } from "./pagination";
import { first, render, tags, text } from "./test-helpers";

describe("pageItems", () => {
  it("lists every page when there are few", () => {
    expect(pageItems(2, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageItems(1, 1)).toEqual([1]);
  });

  it("collapses the middle of a long range into gaps", () => {
    expect(pageItems(1, 20)).toEqual([1, 2, "gap", 20]);
    expect(pageItems(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageItems(20, 20)).toEqual([1, "gap", 19, 20]);
    expect(pageItems(3, 20)).toEqual([1, 2, 3, 4, "gap", 20]);
  });
});

describe("Pagination", () => {
  const pagination = (currentPage: number, pageCount: number): string =>
    render(
      <Pagination
        label="Pages"
        currentPage={currentPage}
        pageCount={pageCount}
        hrefForPage={(page) => `/catalog?page=${page}`}
        previousLabel="Previous"
        nextLabel="Next"
        pageLabel={(page) => `Page ${page}`}
      />,
    );

  it("is a labelled nav with a list of links", () => {
    const markup = pagination(2, 5);
    expect(first(markup, "nav").attributes["aria-label"]).toBe("Pages");
    expect(tags(markup, "ul")).toHaveLength(1);
    expect(tags(markup, "a").map((link) => link.attributes.href)).toEqual([
      "/catalog?page=1",
      "/catalog?page=1",
      "/catalog?page=2",
      "/catalog?page=3",
      "/catalog?page=4",
      "/catalog?page=5",
      "/catalog?page=3",
    ]);
  });

  it("marks exactly the current page with aria-current=page", () => {
    const current = tags(pagination(3, 5), "a").filter((link) => "aria-current" in link.attributes);
    expect(current).toHaveLength(1);
    expect(current[0]?.attributes).toMatchObject({
      "aria-current": "page",
      href: "/catalog?page=3",
    });
  });

  it("gives page links an accessible name from props", () => {
    expect(tags(pagination(2, 5), "a").map((link) => link.attributes["aria-label"])).toEqual([
      undefined,
      "Page 1",
      "Page 2",
      "Page 3",
      "Page 4",
      "Page 5",
      undefined,
    ]);
    expect(text(pagination(2, 5))).toBe("Previous 1 2 3 4 5 Next");
  });

  it("disables previous on the first page: not a link, aria-disabled", () => {
    const markup = pagination(1, 5);
    expect(markup).toMatch(/<span[^>]*aria-disabled="true"[^>]*>Previous<\/span>/);
    expect(tags(markup, "a").some((link) => link.attributes.href === "/catalog?page=0")).toBe(
      false,
    );
    expect(text(markup).startsWith("Previous")).toBe(true);
    expect(tags(markup, "a").at(-1)?.attributes.rel).toBe("next");
  });

  it("disables next on the last page", () => {
    const markup = pagination(5, 5);
    expect(markup).toMatch(/<span[^>]*aria-disabled="true"[^>]*>Next<\/span>/);
    expect(tags(markup, "a").some((link) => link.attributes.rel === "next")).toBe(false);
    expect(tags(markup, "a")[0]?.attributes.rel).toBe("prev");
  });

  it("renders gaps hidden from assistive technology", () => {
    expect(pagination(10, 20)).toContain('<li aria-hidden="true">');
  });

  it("renders nothing for a single page", () => {
    expect(pagination(1, 1)).toBe("");
  });
});

describe("Breadcrumbs", () => {
  const items = [
    { label: "Home", href: "/uk" },
    { label: "Mugs", href: "/uk/mugs" },
    { label: "Red mug" },
  ];

  it("is a labelled nav with an ordered list", () => {
    const markup = render(<Breadcrumbs label="Breadcrumb" items={items} />);
    expect(first(markup, "nav").attributes["aria-label"]).toBe("Breadcrumb");
    expect(tags(markup, "ol")).toHaveLength(1);
    expect(tags(markup, "li")).toHaveLength(3);
  });

  it("links the parents and marks the last item as the current page without a link", () => {
    const markup = render(<Breadcrumbs label="Breadcrumb" items={items} />);
    expect(tags(markup, "a").map((link) => link.attributes.href)).toEqual(["/uk", "/uk/mugs"]);
    expect(markup).toMatch(/<span[^>]*aria-current="page"[^>]*>Red mug<\/span>/);
    expect(markup.match(/aria-current/g)).toHaveLength(1);
  });

  it("hides separators from assistive technology", () => {
    const markup = render(<Breadcrumbs label="Breadcrumb" items={items} />);
    expect(
      tags(markup, "span").filter((span) => span.attributes["aria-hidden"] === "true"),
    ).toHaveLength(2);
  });

  it("renders nothing without items", () => {
    expect(render(<Breadcrumbs label="Breadcrumb" items={[]} />)).toBe("");
  });
});
