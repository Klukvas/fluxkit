import type { I18nText } from "@fluxkit/core";
import type { SeedMedia, SeedProduct, SeedVariantCommerce } from "./types.js";

// Demo products. Every title, text and image is a placeholder; there are no real products, brands or domains.

/** Marker that tests and docs use to find the internal demo values: it must never appear in a public response. */
export const INTERNAL_SUPPLIER_MARKER = "DEMO-INTERNAL-SUPPLIER";

const BRAND_SLUG = "demo-brand";

function image(name: string, alt: I18nText, color?: string): SeedMedia {
  return {
    url: `https://example.com/placeholder/${name}.jpg`,
    alt,
    ...(color === undefined ? {} : { optionValue: { optionCode: "color", valueCode: color } }),
  };
}

// Demo prices are plain amounts in minor units (59900 = 599.00 in a two-decimal currency). Stock shows every store state
// for the default LOW_STOCK_THRESHOLD of 5: plenty (in_stock), 1 to 5 (low_stock), none (out_of_stock) and backorder.
function clothingVariant(
  color: string,
  size: string,
  amount: number,
  commerce: Omit<SeedVariantCommerce, "optionValues" | "amount">,
): SeedVariantCommerce {
  return { optionValues: { color, size }, amount, ...commerce };
}

function defaultVariant(
  amount: number,
  commerce: Omit<SeedVariantCommerce, "optionValues" | "amount">,
): SeedVariantCommerce {
  return { optionValues: {}, amount, ...commerce };
}

const COTTON_CARE: I18nText = {
  uk: "Прати при 30 градусах, не вибілювати.",
  en: "Machine wash at 30 degrees, do not bleach.",
};

const clothingProducts: readonly SeedProduct[] = [
  {
    slug: "demo-t-shirt",
    title: { uk: "Демо футболка", en: "Demo T-shirt" },
    description: {
      uk: "Базова футболка з бавовни. Демонстраційний товар.",
      en: "A basic cotton T-shirt. Demo product.",
    },
    productTypeCode: "clothing",
    brandSlug: BRAND_SLUG,
    categorySlugs: ["demo-clothing-tops", "demo-clothing"],
    attributes: {
      material: "cotton",
      care_notes: COTTON_CARE,
      supplier_reference: `${INTERNAL_SUPPLIER_MARKER}-TSHIRT`,
    },
    options: [
      { optionCode: "color", valueCodes: ["black", "white", "red"] },
      { optionCode: "size", valueCodes: ["s", "m", "l"] },
    ],
    media: [
      image("t-shirt-front", { uk: "Футболка, вигляд спереду", en: "T-shirt, front view" }),
      image("t-shirt-black", { uk: "Чорна футболка", en: "Black T-shirt" }, "black"),
      image("t-shirt-red", { uk: "Червона футболка", en: "Red T-shirt" }, "red"),
    ],
    variants: [
      clothingVariant("black", "s", 59900, { stock: 3 }),
      clothingVariant("black", "m", 59900, { stock: 40, compareAtAmount: 79900 }),
      clothingVariant("black", "l", 59900, { stock: 35 }),
      clothingVariant("white", "s", 59900, { stock: 25 }),
      clothingVariant("white", "m", 59900, { stock: 60 }),
      clothingVariant("white", "l", 59900, { stock: 30 }),
      clothingVariant("red", "s", 62900, { stock: 18 }),
      clothingVariant("red", "m", 62900, { stock: 22 }),
      clothingVariant("red", "l", 62900, { stock: 0 }),
    ],
  },
  {
    slug: "demo-hoodie",
    title: { uk: "Демо худі", en: "Demo Hoodie" },
    description: {
      uk: "Тепле худі з капюшоном. Демонстраційний товар.",
      en: "A warm hoodie with a hood. Demo product.",
    },
    productTypeCode: "clothing",
    brandSlug: BRAND_SLUG,
    categorySlugs: ["demo-clothing-tops"],
    attributes: {
      material: "polyester",
      care_notes: COTTON_CARE,
      supplier_reference: `${INTERNAL_SUPPLIER_MARKER}-HOODIE`,
    },
    options: [
      { optionCode: "color", valueCodes: ["black", "blue"] },
      { optionCode: "size", valueCodes: ["s", "m", "l", "xl"] },
    ],
    media: [image("hoodie-front", { uk: "Худі, вигляд спереду", en: "Hoodie, front view" })],
    variants: [
      clothingVariant("black", "s", 129900, { stock: 12 }),
      clothingVariant("black", "m", 129900, { stock: 20 }),
      clothingVariant("black", "l", 129900, { stock: 15 }),
      clothingVariant("black", "xl", 134900, { stock: 5 }),
      clothingVariant("blue", "s", 129900, { stock: 2 }),
      clothingVariant("blue", "m", 129900, { stock: 28, compareAtAmount: 159900 }),
      clothingVariant("blue", "l", 129900, { stock: 14 }),
      clothingVariant("blue", "xl", 134900, { stock: 9 }),
    ],
  },
  {
    slug: "demo-linen-shirt",
    title: { uk: "Демо лляна сорочка", en: "Demo Linen Shirt" },
    description: {
      uk: "Легка сорочка з льону. Демонстраційний товар.",
      en: "A light linen shirt. Demo product.",
    },
    productTypeCode: "clothing",
    brandSlug: BRAND_SLUG,
    categorySlugs: ["demo-clothing-shirts"],
    attributes: {
      material: "linen",
      supplier_reference: `${INTERNAL_SUPPLIER_MARKER}-SHIRT`,
    },
    options: [
      { optionCode: "color", valueCodes: ["white", "blue"] },
      { optionCode: "size", valueCodes: ["m", "l"] },
    ],
    media: [
      image("linen-shirt-white", { uk: "Біла сорочка", en: "White shirt" }, "white"),
      image("linen-shirt-blue", { uk: "Синя сорочка", en: "Blue shirt" }, "blue"),
    ],
    variants: [
      clothingVariant("white", "m", 109900, { stock: 16 }),
      clothingVariant("white", "l", 109900, { stock: 11 }),
      clothingVariant("blue", "m", 114900, { stock: 0, allowBackorder: true }),
      clothingVariant("blue", "l", 114900, { stock: 7 }),
    ],
  },
];

const handToolProducts: readonly SeedProduct[] = [
  {
    slug: "demo-screwdriver",
    title: { uk: "Демо викрутка", en: "Demo Screwdriver" },
    description: {
      uk: "Хрестова викрутка з пластиковою ручкою. Демонстраційний товар.",
      en: "A Phillips screwdriver with a plastic handle. Demo product.",
    },
    productTypeCode: "hand_tool",
    brandSlug: BRAND_SLUG,
    categorySlugs: ["demo-tools-screwdrivers", "demo-tools"],
    attributes: { head_type: "phillips", length: 200, material: "steel", weight: 120 },
    options: [],
    media: [image("screwdriver", { uk: "Викрутка", en: "Screwdriver" })],
    variants: [defaultVariant(18900, { stock: 120 })],
  },
  {
    slug: "demo-hammer",
    title: { uk: "Демо молоток", en: "Demo Hammer" },
    description: {
      uk: "Столярний молоток з дерев'яною ручкою. Демонстраційний товар.",
      en: "A claw hammer with a wooden handle. Demo product.",
    },
    productTypeCode: "hand_tool",
    brandSlug: BRAND_SLUG,
    categorySlugs: ["demo-tools-hammers-wrenches"],
    attributes: { head_type: "claw", length: 330, material: "wood", weight: 450 },
    options: [],
    media: [image("hammer", { uk: "Молоток", en: "Hammer" })],
    variants: [defaultVariant(34900, { stock: 4, compareAtAmount: 44900 })],
  },
  {
    slug: "demo-adjustable-wrench",
    title: { uk: "Демо розвідний ключ", en: "Demo Adjustable Wrench" },
    description: {
      uk: "Розвідний ключ зі сталі. Демонстраційний товар.",
      en: "A steel adjustable wrench. Demo product.",
    },
    productTypeCode: "hand_tool",
    brandSlug: BRAND_SLUG,
    categorySlugs: ["demo-tools-hammers-wrenches"],
    attributes: { head_type: "adjustable", length: 250, material: "steel", weight: 300 },
    options: [],
    media: [image("wrench", { uk: "Розвідний ключ", en: "Adjustable wrench" })],
    variants: [defaultVariant(42900, { stock: 0 })],
  },
];

const digitalProducts: readonly SeedProduct[] = [
  {
    slug: "demo-e-book",
    title: { uk: "Демо електронна книга", en: "Demo E-book" },
    description: {
      uk: "Електронна книга для демонстрації цифрових товарів.",
      en: "An e-book that demonstrates digital goods.",
    },
    productTypeCode: "digital_product",
    brandSlug: BRAND_SLUG,
    categorySlugs: ["demo-digital-books", "demo-digital-goods"],
    attributes: { file_format: "epub", license_type: "personal" },
    options: [],
    media: [image("e-book-cover", { uk: "Обкладинка книги", en: "Book cover" })],
    variants: [defaultVariant(19900, {})],
  },
  {
    slug: "demo-template-pack",
    title: { uk: "Демо набір шаблонів", en: "Demo Template Pack" },
    description: {
      uk: "Архів із шаблонами документів. Демонстраційний товар.",
      en: "An archive of document templates. Demo product.",
    },
    productTypeCode: "digital_product",
    brandSlug: BRAND_SLUG,
    categorySlugs: ["demo-digital-templates"],
    attributes: { file_format: "zip", license_type: "commercial" },
    options: [],
    media: [image("template-pack", { uk: "Набір шаблонів", en: "Template pack" })],
    variants: [defaultVariant(49900, {})],
  },
];

export const demoProducts: readonly SeedProduct[] = [
  ...clothingProducts,
  ...handToolProducts,
  ...digitalProducts,
];
