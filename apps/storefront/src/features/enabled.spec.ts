import { describe, expect, it } from "vitest";
import type { CatalogOutcome, StoreData } from "../lib/store-data";
import { currentFeatures, loadEnabledFeatures } from "./enabled";

type ConfigOutcome = Awaited<ReturnType<StoreData["getConfig"]>>;

const config = {
  currency: "UAH",
  currencyExponent: 2,
  pricesIncludeTax: true,
  defaultLocale: "uk",
  locales: ["uk", "en"],
  emailDelivery: false,
  onlinePayment: false,
  search: false,
  features: ["notebook"],
};

function dataOf(outcome: ConfigOutcome): Pick<StoreData, "getConfig"> {
  return { getConfig: async () => outcome };
}

describe("enabled features (plan 2026-11-13-blog.md, E5)", () => {
  it("reads GET /store/config features and says whether the copy is stale", async () => {
    expect(await loadEnabledFeatures(dataOf({ ok: true, data: config, stale: false }))).toEqual({
      features: ["notebook"],
      stale: false,
    });
    expect(await loadEnabledFeatures(dataOf({ ok: true, data: config, stale: true }))).toEqual({
      features: ["notebook"],
      stale: true,
    });
  });

  it("throws when the config answers 4xx: whether a feature is on is unknown", async () => {
    const refused: CatalogOutcome<typeof config> = {
      ok: false,
      status: 404,
      problem: { type: "about:blank", title: "t", status: 404, code: "not_found", detail: "d" },
    };
    await expect(loadEnabledFeatures(dataOf(refused))).rejects.toThrow(
      "GET /store/config answered 404 not_found, so the enabled features are unknown.",
    );
  });

  it("refuses a stale copy for a decision that must be current (a slice's page, the sitemap)", () => {
    expect(currentFeatures({ features: ["notebook"], stale: false })).toEqual(["notebook"]);
    expect(() => currentFeatures({ features: ["notebook"], stale: true })).toThrow(
      /only an older copy is in memory/,
    );
  });
});
