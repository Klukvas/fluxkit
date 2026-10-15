import type { SeedBrand, SeedCategory } from "./types.js";

export const demoBrands: readonly SeedBrand[] = [
  { slug: "demo-brand", name: { uk: "Демо-бренд", en: "Demo Brand" } },
];

export const demoCategories: readonly SeedCategory[] = [
  {
    slug: "demo-clothing",
    name: { uk: "Одяг", en: "Clothing" },
    children: [
      { slug: "demo-clothing-tops", name: { uk: "Футболки та худі", en: "Tops" } },
      { slug: "demo-clothing-shirts", name: { uk: "Сорочки", en: "Shirts" } },
    ],
  },
  {
    slug: "demo-tools",
    name: { uk: "Інструменти", en: "Tools" },
    children: [
      { slug: "demo-tools-screwdrivers", name: { uk: "Викрутки", en: "Screwdrivers" } },
      {
        slug: "demo-tools-hammers-wrenches",
        name: { uk: "Молотки та ключі", en: "Hammers and wrenches" },
      },
    ],
  },
  {
    slug: "demo-digital-goods",
    name: { uk: "Цифрові товари", en: "Digital goods" },
    children: [
      { slug: "demo-digital-books", name: { uk: "Електронні книги", en: "E-books" } },
      { slug: "demo-digital-templates", name: { uk: "Шаблони", en: "Templates" } },
    ],
  },
];
