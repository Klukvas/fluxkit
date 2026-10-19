import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import uk from "../messages/uk.json";
import { CLIENT_MESSAGE_PREFIXES, pickClientMessages } from "./client-messages";

describe("pickClientMessages", () => {
  it("keeps client namespaces and drops the rest", () => {
    const picked = pickClientMessages({
      "nav.cart": "a",
      "error.title": "b",
      "errors.generic": "c",
      "footer.copyright": "d",
      "home.hero.title": "e",
    });
    expect(Object.keys(picked).sort()).toEqual(["error.title", "errors.generic", "nav.cart"]);
  });

  it("does not match a prefix inside a longer word (error. is not errors.)", () => {
    expect(pickClientMessages({ "errorish.x": "a" })).toEqual({});
  });

  it("carries every key the client components use, in both locales", () => {
    for (const messages of [uk, en]) {
      const picked = pickClientMessages(messages);
      for (const key of [
        "nav.cart",
        "nav.account.signIn",
        "locale.switcher.label",
        "error.title",
        "errors.network",
        "notFound.title",
        // The not-found view names its own page title in the browser (review L9).
        "site.name",
        "seo.pageTitle",
        "loading.page",
        "product.addToCart",
        "product.added",
        "availability.in_stock",
        "errors.rule.quantity_limit",
      ]) {
        expect(picked[key], key).toBeDefined();
      }
    }
    expect(CLIENT_MESSAGE_PREFIXES.length).toBeGreaterThan(0);
  });
});
