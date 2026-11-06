import type { SeedProductType } from "../types.js";

/**
 * ProductType presets of the coffee-shop supplies demo. Data only: which attributes (from `dictionaries.ts`) describe a product
 * of the type and which options may generate its variants. A product picks the options it needs (a simple product picks none and
 * keeps its single default variant).
 */
export const coffeeProductTypes: readonly SeedProductType[] = [
  {
    code: "disposable_ware",
    name: { uk: "Одноразовий посуд", en: "Disposable ware" },
    requiresShipping: true,
    optionCodes: ["volume", "diameter", "cup_slots", "pack_size"],
    attributes: [
      { attributeCode: "ware_material", level: "product", isRequired: true },
      { attributeCode: "ware_color", level: "product" },
      { attributeCode: "cup_wall", level: "product" },
      { attributeCode: "supplier_code", level: "product" },
    ],
  },
  {
    code: "coffee",
    name: { uk: "Кава", en: "Coffee" },
    requiresShipping: true,
    optionCodes: ["net_weight", "grind", "pack_size"],
    attributes: [
      { attributeCode: "roast_level", level: "product", isRequired: true },
      { attributeCode: "coffee_origin", level: "product", isRequired: true },
      { attributeCode: "arabica_share", level: "product" },
      { attributeCode: "processing", level: "product" },
      { attributeCode: "storage_notes", level: "product" },
      { attributeCode: "supplier_code", level: "product" },
    ],
  },
  {
    code: "dairy",
    name: { uk: "Молочні та рослинні напої", en: "Dairy and plant drinks" },
    requiresShipping: true,
    optionCodes: ["volume", "net_weight", "pack_size"],
    attributes: [
      { attributeCode: "milk_base", level: "product", isRequired: true },
      { attributeCode: "fat_content", level: "product" },
      { attributeCode: "shelf_life_days", level: "product" },
      { attributeCode: "storage_notes", level: "product" },
    ],
  },
  {
    code: "ice",
    name: { uk: "Харчовий лід", en: "Food ice" },
    requiresShipping: true,
    optionCodes: ["net_weight"],
    attributes: [{ attributeCode: "storage_notes", level: "product", isRequired: true }],
  },
  {
    code: "grocery",
    name: { uk: "Бакалія", en: "Grocery" },
    requiresShipping: true,
    optionCodes: ["net_weight", "pack_size"],
    attributes: [
      { attributeCode: "storage_notes", level: "product" },
      { attributeCode: "shelf_life_days", level: "product" },
    ],
  },
  {
    code: "syrup_sauce",
    name: { uk: "Сиропи та соуси", en: "Syrups and sauces" },
    requiresShipping: true,
    optionCodes: ["volume"],
    attributes: [
      { attributeCode: "syrup_flavour", level: "product", isRequired: true },
      { attributeCode: "shelf_life_days", level: "product" },
    ],
  },
  {
    code: "equipment",
    name: { uk: "Обладнання", en: "Equipment" },
    requiresShipping: true,
    optionCodes: ["diameter", "volume"],
    attributes: [
      { attributeCode: "machine_kind", level: "product" },
      { attributeCode: "group_count", level: "product" },
      { attributeCode: "burr_type", level: "product" },
      { attributeCode: "power_w", level: "product" },
      { attributeCode: "voltage_v", level: "product" },
      { attributeCode: "capacity_ml", level: "product" },
      { attributeCode: "supplier_code", level: "product" },
    ],
  },
  {
    code: "cleaning",
    name: { uk: "Засоби для чищення та фільтри", en: "Cleaning and filters" },
    requiresShipping: true,
    optionCodes: ["pack_size", "volume"],
    attributes: [
      { attributeCode: "ware_material", level: "product" },
      { attributeCode: "storage_notes", level: "product" },
    ],
  },
  {
    code: "consumables",
    name: { uk: "Пакування та витратні матеріали", en: "Packaging and consumables" },
    requiresShipping: true,
    optionCodes: ["pack_size", "glove_size"],
    attributes: [
      { attributeCode: "ware_material", level: "product", isRequired: true },
      { attributeCode: "ware_color", level: "product" },
    ],
  },
  {
    code: "digital_goods",
    name: { uk: "Цифрові товари", en: "Digital goods" },
    requiresShipping: false,
    optionCodes: ["card_value"],
    attributes: [{ attributeCode: "digital_format", level: "product", isRequired: true }],
  },
];
