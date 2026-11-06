import type { SeedBrand, SeedCategory } from "../types.js";

/**
 * Brands of the coffee-shop supplies demo. Every name is invented for the template (no real company, trademark or product);
 * a client fork replaces them with its own suppliers.
 */
export const coffeeBrands: readonly SeedBrand[] = [
  { slug: "cuplia", name: { uk: "Cuplia", en: "Cuplia" } },
  { slug: "milkora", name: { uk: "Milkora", en: "Milkora" } },
  { slug: "greenfold", name: { uk: "Greenfold", en: "Greenfold" } },
  { slug: "icetta", name: { uk: "Icetta", en: "Icetta" } },
  { slug: "roast-harbor", name: { uk: "Roast Harbor", en: "Roast Harbor" } },
  { slug: "leafline", name: { uk: "Leafline", en: "Leafline" } },
  { slug: "siropia", name: { uk: "Siropia", en: "Siropia" } },
  { slug: "crema-works", name: { uk: "Crema Works", en: "Crema Works" } },
  { slug: "tampwise", name: { uk: "Tampwise", en: "Tampwise" } },
  { slug: "cleanbrew", name: { uk: "Cleanbrew", en: "Cleanbrew" } },
  { slug: "brew-school", name: { uk: "Brew School", en: "Brew School" } },
];

function node(
  slug: string,
  uk: string,
  en: string,
  children?: readonly SeedCategory[],
): SeedCategory {
  return { slug, name: { uk, en }, ...(children === undefined ? {} : { children }) };
}

/** A tree: roots, their children, and one third level (coffee beans). Slugs differ from the test fixture's. */
export const coffeeCategories: readonly SeedCategory[] = [
  node("cups-and-lids", "Стаканчики та кришки", "Cups and lids", [
    node("paper-cups", "Паперові стаканчики", "Paper cups"),
    node("cold-cups", "Стаканчики для холодних напоїв", "Cold drink cups"),
    node("lids", "Кришки", "Lids"),
    node("cup-accessories", "Холдери та підставки", "Sleeves and carriers"),
  ]),
  node("straws-and-stirrers", "Трубочки та розмішувачі", "Straws and stirrers", [
    node("straws", "Трубочки", "Straws"),
    node("stirrers-and-sugar", "Розмішувачі та цукор", "Stirrers and sugar"),
  ]),
  node("milk-and-cream", "Молоко та вершки", "Milk and cream", [
    node("dairy-milk", "Молоко", "Milk"),
    node("plant-milk", "Рослинне молоко", "Plant-based milk"),
    node("cream", "Вершки та згущене молоко", "Cream and condensed milk"),
  ]),
  node("ice", "Лід", "Ice"),
  node("coffee", "Кава", "Coffee", [
    node("coffee-beans", "Кава в зернах", "Coffee beans", [
      node("espresso-blends", "Еспресо-суміші", "Espresso blends"),
      node("single-origin", "Моносорти", "Single origin"),
    ]),
    node("ground-coffee", "Мелена кава", "Ground coffee"),
    node("instant-and-capsules", "Розчинна кава та капсули", "Instant coffee and capsules"),
  ]),
  node("tea-and-cocoa", "Чай та какао", "Tea and cocoa"),
  node("syrups-and-sauces", "Сиропи та соуси", "Syrups and sauces", [
    node("syrups", "Сиропи", "Syrups"),
    node("sauces", "Соуси", "Sauces"),
  ]),
  node("equipment", "Обладнання", "Equipment", [
    node("espresso-machines", "Кавомашини", "Coffee machines"),
    node("grinders", "Кавомолки", "Grinders"),
    node("barista-tools", "Інструменти бариста", "Barista tools"),
    node("ice-makers-and-blenders", "Льодогенератори та блендери", "Ice makers and blenders"),
  ]),
  node("cleaning-and-filters", "Чищення та фільтри", "Cleaning and filters", [
    node("filters", "Фільтри", "Filters"),
    node("cleaning", "Засоби для чищення", "Cleaning products"),
  ]),
  node("packaging", "Пакування та витратні матеріали", "Packaging and consumables", [
    node("bags-and-napkins", "Пакети та серветки", "Bags and napkins"),
    node("consumables", "Витратні матеріали", "Consumables"),
  ]),
  node("gift-cards-and-guides", "Сертифікати та посібники", "Gift cards and guides"),
];
