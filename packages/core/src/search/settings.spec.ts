import { describe, expect, it } from "vitest";
import { SEARCH_DOCUMENT_VERSION, SEARCH_LIMITS, deriveIndexSettings } from "./index.js";
import type { IndexSettingsInput } from "./index.js";
import { assignment, attribute, selectAttribute } from "./test-support.js";

const input: IndexSettingsInput = {
  locale: "uk",
  currency: "UAH",
  options: [{ code: "size" }, { code: "color" }],
  attributes: [
    assignment(selectAttribute("material", ["steel"], { isFilterable: true, isSearchable: true })),
    assignment(attribute("waterproof", "boolean", { isFilterable: true })),
    assignment(attribute("weight", "number", { isFilterable: true }), "variant"),
    assignment(selectAttribute("not_filterable", ["a"], { isSearchable: true })),
    assignment(attribute("notes", "text", { isFilterable: true })),
    // inconsistent on purpose: the database forbids it, the derivation must hold anyway
    assignment(
      selectAttribute("internal_cost", ["a"], {
        isInternal: true,
        isFilterable: true,
        isSearchable: true,
        isVisibleOnStorefront: false,
      }),
    ),
    assignment(
      selectAttribute("hidden", ["a"], { isFilterable: true, isVisibleOnStorefront: false }),
    ),
  ],
  synonymGroups: [],
};

describe("deriveIndexSettings", () => {
  it("derives the settings of a Ukrainian index from the definitions", () => {
    const { settings } = deriveIndexSettings(input);
    expect(settings).toEqual({
      searchableAttributes: [
        "title",
        "brandName",
        "sku",
        "optionLabels",
        "categoryNames",
        "attributeText",
        "stems",
        "stems5",
        "description",
      ],
      filterableAttributes: [
        // id: the sync deletes the documents a product lost with `productId IN [...] AND NOT id IN [...]`.
        "id",
        "productId",
        "brand",
        "categories",
        "inStock",
        "price",
        "opt_color",
        "opt_size",
        "attr_material",
        "attr_waterproof",
        "attr_weight",
      ],
      sortableAttributes: ["price", "publishedAt", "productId"],
      displayedAttributes: ["id", "productId", "productSlug", "title"],
      typoTolerance: {
        enabled: true,
        disableOnAttributes: ["sku", "stems", "stems5"],
        disableOnNumbers: true,
      },
      pagination: { maxTotalHits: SEARCH_LIMITS.maxTotalHits },
      faceting: { maxValuesPerFacet: 100 },
      synonyms: {},
      localizedAttributes: [{ attributePatterns: ["*"], locales: ["ukr"] }],
    });
  });

  it("does not set a distinctAttribute (a request can not switch it off again)", () => {
    expect(deriveIndexSettings(input).settings).not.toHaveProperty("distinctAttribute");
  });

  it("never mentions an internal, hidden or non-filterable attribute in the filterable list or anywhere else", () => {
    const json = JSON.stringify(deriveIndexSettings(input));
    for (const code of ["internal_cost", "hidden", "not_filterable", "notes"]) {
      expect(json).not.toContain(code);
    }
  });

  it("uses the English language tag on the English index and none on other locales", () => {
    expect(deriveIndexSettings({ ...input, locale: "en" }).settings.localizedAttributes).toEqual([
      { attributePatterns: ["*"], locales: ["eng"] },
    ]);
    expect(deriveIndexSettings({ ...input, locale: "de" }).settings.localizedAttributes).toEqual(
      [],
    );
  });

  it("builds synonyms as groups in which every term maps to the others, normalized and sorted", () => {
    const { settings } = deriveIndexSettings({
      ...input,
      synonymGroups: [
        ["Викрутка", "відвертка", "  ВИКРУТКА "],
        ["відвертка", "шуруповерт"],
        ["single"],
        ["м’ясо", "мясо"],
        ["", " "],
      ],
    });
    expect(settings.synonyms).toEqual({
      "м'ясо": ["мясо"],
      мясо: ["м'ясо"],
      викрутка: ["відвертка"],
      відвертка: ["викрутка", "шуруповерт"],
      шуруповерт: ["відвертка"],
    });
    expect(Object.keys(settings.synonyms)).toEqual(Object.keys(settings.synonyms).sort());
  });

  it("returns a stable hash that ignores the order of the definitions", () => {
    const first = deriveIndexSettings(input);
    const shuffled = deriveIndexSettings({
      ...input,
      options: [...input.options].reverse(),
      attributes: [...input.attributes].reverse(),
    });
    expect(first.settingsHash).toMatch(/^[0-9a-f]{14}$/);
    expect(shuffled.settingsHash).toBe(first.settingsHash);
    expect(shuffled.settings).toEqual(first.settings);
  });

  it("changes the hash when a filterable attribute, an option or a synonym changes", () => {
    const base = deriveIndexSettings(input).settingsHash;
    const withAttribute = deriveIndexSettings({
      ...input,
      attributes: [
        ...input.attributes,
        assignment(attribute("flag", "boolean", { isFilterable: true })),
      ],
    }).settingsHash;
    const withOption = deriveIndexSettings({
      ...input,
      options: [...input.options, { code: "fit" }],
    }).settingsHash;
    const withSynonyms = deriveIndexSettings({
      ...input,
      synonymGroups: [["a", "b"]],
    }).settingsHash;
    expect(new Set([base, withAttribute, withOption, withSynonyms]).size).toBe(4);
  });

  it("does not change the hash for attributes the index ignores", () => {
    const base = deriveIndexSettings(input).settingsHash;
    const same = deriveIndexSettings({
      ...input,
      attributes: [
        ...input.attributes,
        assignment(
          selectAttribute("extra_hidden", ["a"], {
            isFilterable: true,
            isVisibleOnStorefront: false,
          }),
        ),
      ],
    }).settingsHash;
    expect(same).toBe(base);
  });

  it("returns a rebuild key made of the document version, the currency and the locale", () => {
    expect(deriveIndexSettings(input).rebuildKey).toBe(`${SEARCH_DOCUMENT_VERSION}:UAH:uk`);
    expect(deriveIndexSettings({ ...input, currency: "EUR" }).rebuildKey).toBe(
      `${SEARCH_DOCUMENT_VERSION}:EUR:uk`,
    );
    // the settings hash is the part that can be applied in place; it does not carry the rebuild key
    expect(deriveIndexSettings({ ...input, currency: "EUR" }).settingsHash).toBe(
      deriveIndexSettings(input).settingsHash,
    );
  });
});
