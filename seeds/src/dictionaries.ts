import type { SeedAttribute, SeedOption } from "./types.js";

// Attributes describe a product; options generate variants (AGENTS.md 2.3). Texts are placeholders.

export const demoAttributes: readonly SeedAttribute[] = [
  {
    code: "material",
    name: { uk: "Матеріал", en: "Material" },
    inputType: "select",
    isFilterable: true,
    options: [
      { code: "cotton", label: { uk: "Бавовна", en: "Cotton" } },
      { code: "linen", label: { uk: "Льон", en: "Linen" } },
      { code: "polyester", label: { uk: "Поліестер", en: "Polyester" } },
      { code: "steel", label: { uk: "Сталь", en: "Steel" } },
      { code: "wood", label: { uk: "Дерево", en: "Wood" } },
    ],
  },
  {
    code: "care_notes",
    name: { uk: "Догляд", en: "Care notes" },
    inputType: "text",
  },
  {
    // Exercises the leak rules: an internal attribute must never leave the public API.
    code: "supplier_reference",
    name: { uk: "Код постачальника", en: "Supplier reference" },
    inputType: "text",
    isLocalized: false,
    isInternal: true,
  },
  {
    code: "head_type",
    name: { uk: "Тип наконечника", en: "Head type" },
    inputType: "select",
    isFilterable: true,
    options: [
      { code: "flat", label: { uk: "Плоский", en: "Flat" } },
      { code: "phillips", label: { uk: "Хрестовий", en: "Phillips" } },
      { code: "claw", label: { uk: "Цвяходер", en: "Claw" } },
      { code: "adjustable", label: { uk: "Розвідний", en: "Adjustable" } },
    ],
  },
  {
    code: "length",
    name: { uk: "Довжина", en: "Length" },
    inputType: "number",
    unit: "mm",
    validation: { min: 1, integer: true },
    isFilterable: true,
    isSortable: true,
  },
  {
    code: "weight",
    name: { uk: "Вага", en: "Weight" },
    inputType: "number",
    unit: "g",
    validation: { min: 1, integer: true },
    isSortable: true,
  },
  {
    code: "file_format",
    name: { uk: "Формат файлу", en: "File format" },
    inputType: "select",
    isFilterable: true,
    options: [
      { code: "pdf", label: { uk: "PDF", en: "PDF" } },
      { code: "epub", label: { uk: "EPUB", en: "EPUB" } },
      { code: "zip", label: { uk: "ZIP-архів", en: "ZIP archive" } },
    ],
  },
  {
    code: "license_type",
    name: { uk: "Тип ліцензії", en: "License type" },
    inputType: "select",
    isFilterable: true,
    options: [
      { code: "personal", label: { uk: "Особиста", en: "Personal" } },
      { code: "commercial", label: { uk: "Комерційна", en: "Commercial" } },
    ],
  },
];

export const demoOptions: readonly SeedOption[] = [
  {
    code: "color",
    name: { uk: "Колір", en: "Color" },
    values: [
      { code: "black", label: { uk: "Чорний", en: "Black" } },
      { code: "white", label: { uk: "Білий", en: "White" } },
      { code: "red", label: { uk: "Червоний", en: "Red" } },
      { code: "blue", label: { uk: "Синій", en: "Blue" } },
    ],
  },
  {
    code: "size",
    name: { uk: "Розмір", en: "Size" },
    values: [
      { code: "s", label: { uk: "S", en: "S" } },
      { code: "m", label: { uk: "M", en: "M" } },
      { code: "l", label: { uk: "L", en: "L" } },
      { code: "xl", label: { uk: "XL", en: "XL" } },
    ],
  },
];
