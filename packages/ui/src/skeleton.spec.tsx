import { describe, expect, it } from "vitest";
import { Skeleton } from "./skeleton";
import { first, render } from "./test-helpers";

describe("Skeleton variants", () => {
  it("leaves the existing pulse output unchanged by default", () => {
    expect(render(<Skeleton />)).toBe(
      '<div aria-hidden="true" class="animate-pulse rounded-media bg-muted motion-reduce:animate-none"></div>',
    );
  });
  it("opts into a decorative shimmer with a static muted base", () => {
    const markup = render(<Skeleton variant="shimmer" />);
    expect(first(markup, "div").attributes["aria-hidden"]).toBe("true");
    expect(markup).toContain("fk-skeleton-shimmer");
    expect(markup).toContain("bg-muted");
    expect(markup).not.toContain("animate-pulse");
  });
});
