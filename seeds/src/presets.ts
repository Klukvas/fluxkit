import type { SeedProductType } from "./types.js";

/**
 * ProductType presets. They are data: a client fork edits or replaces them. Each preset only assigns attributes and
 * options from `dictionaries.ts`; no niche-specific field exists in the product schema.
 */
export const productTypePresets: readonly SeedProductType[] = [
  {
    code: "clothing",
    name: { uk: "Одяг", en: "Clothing" },
    requiresShipping: true,
    optionCodes: ["color", "size"],
    attributes: [
      { attributeCode: "material", level: "product", isRequired: true },
      { attributeCode: "care_notes", level: "product" },
      { attributeCode: "supplier_reference", level: "product" },
    ],
  },
  {
    code: "hand_tool",
    name: { uk: "Ручний інструмент", en: "Hand tool" },
    requiresShipping: true,
    optionCodes: [],
    attributes: [
      { attributeCode: "head_type", level: "product", isRequired: true },
      { attributeCode: "length", level: "product" },
      { attributeCode: "material", level: "product" },
      { attributeCode: "weight", level: "product" },
    ],
  },
  {
    code: "digital_product",
    name: { uk: "Цифровий товар", en: "Digital product" },
    requiresShipping: false,
    optionCodes: [],
    attributes: [
      { attributeCode: "file_format", level: "product", isRequired: true },
      { attributeCode: "license_type", level: "product" },
    ],
  },
];
