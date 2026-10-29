import { describe, expect, it } from "vitest";
import { PRIVATE_PATHS, buildRobots } from "./robots";

describe("buildRobots", () => {
  const robots = buildRobots({ origin: "https://shop.example", locales: ["uk", "en"] });
  const rules = Array.isArray(robots.rules) ? robots.rules : [robots.rules];
  const disallow = rules.flatMap((rule) =>
    Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : [],
  );

  it("disallows cart, checkout, account and order pages in every locale, and the API path", () => {
    expect(PRIVATE_PATHS).toEqual(["/cart", "/checkout", "/account", "/order", "/payment"]);
    for (const locale of ["uk", "en"]) {
      for (const path of PRIVATE_PATHS) expect(disallow).toContain(`/${locale}${path}`);
    }
    expect(disallow).toContain("/store/");
  });

  it("allows everything else and points at the sitemap on the public origin", () => {
    expect(rules.every((rule) => rule.userAgent === "*")).toBe(true);
    expect(rules.some((rule) => rule.allow === "/")).toBe(true);
    expect(robots.sitemap).toBe("https://shop.example/sitemap.xml");
  });

  it("does not disallow the catalog, a category or a product", () => {
    for (const blocked of disallow) {
      expect(blocked).not.toMatch(/catalog|\/c\/|\/p\//);
    }
  });
});
