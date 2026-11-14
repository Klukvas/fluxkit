import { describe, expect, it } from "vitest";
import { Loader } from "./loader";
import { render, tags, text } from "./test-helpers";

describe("Loader", () => {
  it("has three decorative neutral dots and no default words", () => {
    const markup = render(<Loader />);
    expect(
      tags(markup, "span").filter((tag) => tag.attributes["data-dot"] !== undefined),
    ).toHaveLength(3);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("motion-reduce:animate-none");
    expect(text(markup)).toBe("");
  });
  it("can expose a loading label supplied by the caller", () => {
    expect(text(render(<Loader label="Loading cart" />))).toBe("Loading cart");
  });
});
