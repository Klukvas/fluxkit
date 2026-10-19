import { describe, expect, it } from "vitest";
import { shouldBlockNavigation } from "./unsaved-changes";

const at = (pathname: string, search = "", hash = "") => ({ pathname, search, hash });

describe("shouldBlockNavigation", () => {
  it("never blocks a clean form", () => {
    expect(shouldBlockNavigation(false, at("/account"), at("/orders"))).toBe(false);
  });

  it("blocks leaving a dirty form for another path or another query", () => {
    expect(shouldBlockNavigation(true, at("/account"), at("/orders"))).toBe(true);
    expect(shouldBlockNavigation(true, at("/products/1"), at("/products/1", "?tab=prices"))).toBe(
      true,
    );
  });

  it("does not block a jump inside the page (the skip link's fragment)", () => {
    expect(shouldBlockNavigation(true, at("/account"), at("/account", "", "#main"))).toBe(false);
  });
});
