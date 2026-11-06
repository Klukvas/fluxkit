import type { SeedBanner } from "../types.js";

/**
 * Home banners of the coffee demo (ADR 0046): two `card` banners and one `image` banner whose words are drawn in (an own
 * picture for `en`, the default one for every other locale), so both layouts and the per-locale picture show on a fresh demo.
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
    layout: "image",
    // The same words as in the picture (a screen reader does not read a picture).
    imageAlt: {
      uk: "Обладнання для кав'ярні. Кавомашини, кавомолки та інструменти бариста",
      en: "Equipment for your cafe. Coffee machines, grinders and barista tools",
    },
    image: "coffee/banner-equipment-uk.webp",
    localeImages: [{ locale: "en", file: "coffee/banner-equipment-en.webp" }],
    link: "/c/equipment",
    tone: "surface",
  },
];
