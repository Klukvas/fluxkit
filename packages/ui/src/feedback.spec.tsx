import { describe, expect, it } from "vitest";
import { Alert } from "./alert";
import { Badge } from "./badge";
import { EmptyState } from "./empty-state";
import { SkipLink } from "./skip-link";
import { Skeleton } from "./skeleton";
import { Spinner } from "./spinner";
import { first, render, tags, text } from "./test-helpers";

describe("Alert", () => {
  it("announces danger immediately with role alert", () => {
    expect(first(render(<Alert variant="danger">Failed</Alert>), "div").attributes.role).toBe(
      "alert",
    );
  });

  it("announces info, success and warning politely with role status", () => {
    for (const variant of ["info", "success", "warning"] as const) {
      expect(first(render(<Alert variant={variant}>Note</Alert>), "div").attributes.role).toBe(
        "status",
      );
    }
  });

  it("defaults to info, renders title and content, and colors only by token", () => {
    const markup = render(<Alert title="Heads up">Body</Alert>);
    expect(first(markup, "div").attributes.role).toBe("status");
    expect(text(markup)).toBe("Heads up Body");
    expect(render(<Alert variant="success">x</Alert>)).toContain("border-success");
    expect(render(<Alert variant="warning">x</Alert>)).toContain("border-warning");
    expect(render(<Alert variant="danger">x</Alert>)).toContain("border-danger");
  });

  it("does not rely on color alone: the content is text", () => {
    expect(text(render(<Alert variant="danger">Card declined</Alert>))).toBe("Card declined");
  });
});

describe("Badge", () => {
  it("renders inline text with a variant", () => {
    const markup = render(<Badge variant="warning">Low stock</Badge>);
    expect(first(markup, "span").attributes.class).toContain("text-warning");
    expect(text(markup)).toBe("Low stock");
    expect(render(<Badge>Plain</Badge>)).toContain("text-foreground");
  });
});

describe("Spinner", () => {
  it("has an accessible name from the label prop and is a status region", () => {
    const markup = render(<Spinner label="Loading cart" />);
    expect(first(markup, "span").attributes.role).toBe("status");
    expect(text(markup)).toBe("Loading cart");
    expect(markup).toContain("motion-reduce:animate-none");
  });
});

describe("Skeleton", () => {
  it("is decorative: hidden from assistive technology and without text", () => {
    const markup = render(<Skeleton className="h-6 w-24" />);
    expect(first(markup, "div").attributes["aria-hidden"]).toBe("true");
    expect(first(markup, "div").attributes.class).toContain("h-6 w-24");
    expect(text(markup)).toBe("");
  });
});

describe("EmptyState", () => {
  it("renders a heading, a description and an action", () => {
    const markup = render(
      <EmptyState
        title="Cart is empty"
        description="Add something"
        action={<a href="/">Shop</a>}
      />,
    );
    expect(tags(markup, "h2")).toHaveLength(1);
    expect(text(markup)).toBe("Cart is empty Add something Shop");
    expect(first(markup, "a").attributes.href).toBe("/");
  });

  it("allows another heading level and omits optional parts", () => {
    const markup = render(<EmptyState title="No results" headingAs="h3" />);
    expect(tags(markup, "h3")).toHaveLength(1);
    expect(tags(markup, "p")).toHaveLength(0);
  });
});

describe("SkipLink", () => {
  it("is a link to the target id, hidden until focused", () => {
    const markup = render(<SkipLink targetId="main-content">Skip to content</SkipLink>);
    const link = first(markup, "a");
    expect(link.attributes.href).toBe("#main-content");
    expect(link.attributes.class).toContain("sr-only");
    expect(link.attributes.class).toContain("focus:not-sr-only");
    expect(text(markup)).toBe("Skip to content");
  });
});
