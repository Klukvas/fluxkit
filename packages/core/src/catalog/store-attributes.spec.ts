import { describe, expect, it } from "vitest";
import { publicAttributeDefinitions, selectPublicAttributes } from "./store-attributes.js";
import { deepFreeze } from "./test-support.js";
import type { AttributeDefinition, AttributeInputType } from "./types.js";

const context = { locale: "en", defaultLocale: "uk" } as const;

function attribute(
  code: string,
  inputType: AttributeInputType,
  overrides: Partial<AttributeDefinition> = {},
): AttributeDefinition {
  return {
    code,
    inputType,
    isLocalized: false,
    unit: null,
    validation: {},
    isFilterable: false,
    isSearchable: false,
    isVisibleOnStorefront: true,
    isComparable: false,
    isSortable: false,
    isInternal: false,
    options: [],
    ...overrides,
  };
}

describe("selectPublicAttributes allowlist", () => {
  const definitions = [
    attribute("visible", "text"),
    attribute("hidden", "text", { isVisibleOnStorefront: false }),
    attribute("secret", "text", { isInternal: true, isVisibleOnStorefront: false }),
    // Not possible in the database (CHECK), but the serializer must hold on its own.
    attribute("leaky", "text", { isInternal: true, isVisibleOnStorefront: true }),
  ];

  it("keeps only visible, non-internal attributes", () => {
    const result = selectPublicAttributes(
      definitions,
      { visible: "a", hidden: "b", secret: "c", leaky: "d" },
      context,
    );
    expect(result).toEqual({ visible: "a" });
  });

  it("drops keys that have no definition", () => {
    expect(selectPublicAttributes(definitions, { visible: "a", unknown_key: "x" }, context)).toEqual(
      { visible: "a" },
    );
  });

  it("omits attributes that have no value", () => {
    expect(selectPublicAttributes(definitions, {}, context)).toEqual({});
  });

  it("ignores inherited properties of the values object", () => {
    const values = Object.create({ visible: "inherited" }) as Record<string, unknown>;
    expect(selectPublicAttributes(definitions, values, context)).toEqual({});
  });

  it("never reads a value for an internal attribute", () => {
    const values: Record<string, unknown> = {};
    Object.defineProperty(values, "secret", {
      enumerable: true,
      get() {
        throw new Error("internal value was read");
      },
    });
    expect(() => selectPublicAttributes(definitions, values, context)).not.toThrow();
  });
});

describe("selectPublicAttributes value resolution", () => {
  it("resolves localized text with the requested locale", () => {
    expect(
      selectPublicAttributes(
        [attribute("care", "text", { isLocalized: true })],
        { care: { uk: "Прати при 30", en: "Wash at 30" } },
        context,
      ),
    ).toEqual({ care: "Wash at 30" });
  });

  it("falls back to the default locale per field", () => {
    expect(
      selectPublicAttributes(
        [
          attribute("care", "text", { isLocalized: true }),
          attribute("fit", "text", { isLocalized: true }),
        ],
        { care: { uk: "Прати" }, fit: { uk: "Вільний", en: "Loose" } },
        context,
      ),
    ).toEqual({ care: "Прати", fit: "Loose" });
  });

  it("drops localized text that has neither locale", () => {
    expect(
      selectPublicAttributes(
        [attribute("care", "text", { isLocalized: true })],
        { care: { de: "Waschen" } },
        context,
      ),
    ).toEqual({});
  });

  it("returns plain text as is", () => {
    expect(selectPublicAttributes([attribute("model", "text")], { model: "X-1" }, context)).toEqual({
      model: "X-1",
    });
  });

  it("returns number with its unit", () => {
    expect(
      selectPublicAttributes([attribute("weight_g", "number", { unit: "g" })], { weight_g: 180 }, context),
    ).toEqual({ weight_g: { value: 180, unit: "g" } });
    expect(
      selectPublicAttributes([attribute("count", "number")], { count: 0 }, context),
    ).toEqual({ count: { value: 0, unit: null } });
  });

  it("returns boolean (including false) and date as is", () => {
    expect(
      selectPublicAttributes(
        [attribute("organic", "boolean"), attribute("released", "date")],
        { organic: false, released: "2026-01-31" },
        context,
      ),
    ).toEqual({ organic: false, released: "2026-01-31" });
  });

  const material = attribute("material", "select", {
    options: [
      { code: "cotton", label: { uk: "Бавовна", en: "Cotton" }, position: 0 },
      { code: "linen", label: { uk: "Льон" }, position: 1 },
      { code: "wool" },
    ],
  });

  it("resolves a select value to code and label", () => {
    expect(selectPublicAttributes([material], { material: "cotton" }, context)).toEqual({
      material: { code: "cotton", label: "Cotton" },
    });
  });

  it("falls back to the default locale label, then to the code", () => {
    expect(selectPublicAttributes([material], { material: "linen" }, context)).toEqual({
      material: { code: "linen", label: "Льон" },
    });
    expect(selectPublicAttributes([material], { material: "wool" }, context)).toEqual({
      material: { code: "wool", label: "wool" },
    });
  });

  it("drops a select value whose option no longer exists", () => {
    expect(selectPublicAttributes([material], { material: "silk" }, context)).toEqual({});
  });

  const season = attribute("season", "multiselect", {
    options: [
      { code: "summer", label: { en: "Summer" }, position: 2 },
      { code: "spring", label: { en: "Spring" }, position: 1 },
      { code: "winter", label: { en: "Winter" }, position: 4 },
      { code: "autumn", label: { en: "Autumn" } },
    ],
  });

  it("orders multiselect values by option position, not by stored order", () => {
    expect(
      selectPublicAttributes([season], { season: ["summer", "spring"] }, context),
    ).toEqual({
      season: [
        { code: "spring", label: "Spring" },
        { code: "summer", label: "Summer" },
      ],
    });
  });

  it("puts options without a position last, keeping their stored order", () => {
    expect(
      selectPublicAttributes([season], { season: ["autumn", "winter"] }, context),
    ).toEqual({
      season: [
        { code: "winter", label: "Winter" },
        { code: "autumn", label: "Autumn" },
      ],
    });
  });

  it("drops unknown multiselect codes and the attribute when nothing is left", () => {
    expect(selectPublicAttributes([season], { season: ["spring", "monsoon"] }, context)).toEqual({
      season: [{ code: "spring", label: "Spring" }],
    });
    expect(selectPublicAttributes([season], { season: ["monsoon"] }, context)).toEqual({});
  });

  it("drops values of the wrong shape instead of passing them through", () => {
    expect(
      selectPublicAttributes(
        [
          attribute("model", "text"),
          attribute("weight_g", "number"),
          attribute("organic", "boolean"),
          attribute("season", "multiselect", { options: [{ code: "a" }] }),
        ],
        { model: 5, weight_g: "heavy", organic: "yes", season: "a" },
        context,
      ),
    ).toEqual({});
  });
});

describe("selectPublicAttributes purity", () => {
  it("does not mutate frozen input and returns equal results", () => {
    const definitions = deepFreeze([
      attribute("material", "select", {
        options: [{ code: "cotton", label: { en: "Cotton" }, position: 0 }],
      }),
      attribute("secret", "text", { isInternal: true, isVisibleOnStorefront: false }),
    ]);
    const values = deepFreeze({ material: "cotton", secret: "s" });
    expect(selectPublicAttributes(definitions, values, context)).toEqual(
      selectPublicAttributes(definitions, values, context),
    );
  });
});

describe("publicAttributeDefinitions", () => {
  const definitions = [
    attribute("weight_g", "number", {
      unit: "g",
      validation: { min: 0 },
      isFilterable: true,
      isComparable: true,
      isSortable: true,
      isSearchable: true,
    }),
    attribute("material", "select", {
      isFilterable: true,
      options: [{ code: "cotton", label: { en: "Cotton" }, position: 3 }, { code: "wool" }],
    }),
    attribute("hidden", "text", { isVisibleOnStorefront: false }),
    attribute("secret", "text", { isInternal: true, isVisibleOnStorefront: false }),
    attribute("leaky", "text", { isInternal: true }),
  ];

  it("lists only visible, non-internal definitions", () => {
    expect(publicAttributeDefinitions(definitions).map((entry) => entry.code)).toEqual([
      "weight_g",
      "material",
    ]);
  });

  it("exposes only the three public flags", () => {
    const [weight] = publicAttributeDefinitions(definitions);
    expect(weight).toEqual({
      code: "weight_g",
      inputType: "number",
      isLocalized: false,
      unit: "g",
      validation: { min: 0 },
      isFilterable: true,
      isComparable: true,
      isSortable: true,
      options: [],
    });
    expect(weight).not.toHaveProperty("isInternal");
    expect(weight).not.toHaveProperty("isSearchable");
    expect(weight).not.toHaveProperty("isVisibleOnStorefront");
  });

  it("exposes option code, label and position only when defined", () => {
    const [, material] = publicAttributeDefinitions(definitions);
    expect(material?.options).toEqual([
      { code: "cotton", label: { en: "Cotton" }, position: 3 },
      { code: "wool" },
    ]);
  });

  it("is pure: frozen input and equal results", () => {
    const frozen = deepFreeze(definitions.map((definition) => ({ ...definition })));
    expect(publicAttributeDefinitions(frozen)).toEqual(publicAttributeDefinitions(frozen));
  });
});
