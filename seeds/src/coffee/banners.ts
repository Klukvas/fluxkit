import type { SeedBanner } from "../types.js";

/**
 * Home banners of the coffee demo (ADR 0046): three `card` banners in one row (owner, 2026-11-13: an `image` banner with its
 * words drawn in looked broken next to two cards; the test fixture still shows the `image` layout and a per-locale picture).
 * Demo data: a shop replaces or deletes them in the admin (`/admin/banners`). Fixed ids, distinct from the test fixture's, so
 * both datasets can be seeded into one database. Pictures: `seeds/assets/coffee/banner-*.webp`
 * (`scripts/generate-coffee-images.mjs`).
 */
export const coffeeBanners: readonly SeedBanner[] = [
  {
    id: "5eedba22-0000-4000-8000-0000000c0f01",
    layout: "card",
    title: { uk: "Усе для кави з собою", en: "Everything for coffee to go" },
    text: {
      uk: "Стаканчики, кришки, холдери і трубочки в одному замовленні.",
      en: "Cups, lids, sleeves and straws in one order.",
    },
    imageAlt: {
      uk: "Паперові стаканчики з кришками різного об'єму",
      en: "Paper cups with lids in several sizes",
    },
    image: "coffee/banner-coffee-to-go.webp",
    link: "/c/cups-and-lids",
    tone: "accent",
  },
  {
    id: "5eedba22-0000-4000-8000-0000000c0f02",
    layout: "card",
    title: { uk: "Кава для еспресо і фільтра", en: "Coffee for espresso and filter" },
    text: {
      uk: "Суміші та моносорти в зерні й мелені, пакети по 250 г і 1 кг.",
      en: "Blends and single origins, whole bean or ground, in 250 g and 1 kg bags.",
    },
    // No alt text: a decorative picture, the card's title names the link.
    image: "coffee/banner-coffee-beans.webp",
    link: "/c/coffee",
    tone: "surface",
  },
  {
    id: "5eedba22-0000-4000-8000-0000000c0f03",
    layout: "card",
    title: { uk: "Обладнання для кав'ярні", en: "Equipment for your cafe" },
    text: {
      uk: "Кавомашини, кавомолки та інструменти бариста.",
      en: "Coffee machines, grinders and barista tools.",
    },
    // No alt text: a decorative picture, the card's title names the link.
    image: "coffee/banner-equipment.webp",
    link: "/c/equipment",
    tone: "surface",
  },
];
