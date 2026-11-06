import type { SeedBanner } from "./types.js";

/**
 * TODO(fluxkit): demo home banners (plan docs/plans/2026-11-05-admin-home-banners.md, owner decision 2 of 2026-11-05). A shop
 * replaces or deletes them in the admin. Their texts read like a shop's own (repair batch 2: the owner's review saw "demo
 * banner, replace it" on the page); this comment and the admin's Help article say they are demo data. Two `card` banners
 * (picture, title, text) and one
 * `image` banner (a finished picture with its words drawn in, an own picture for `en` and the default one for every other
 * locale), so both layouts and the per-locale picture show on a fresh demo. Pictures: `seeds/assets/banner-*.webp`.
 */
export const demoBanners: readonly SeedBanner[] = [
  {
    id: "5eedba22-0000-4000-8000-000000000001",
    layout: "card",
    title: { uk: "Новинки сезону", en: "New this season" },
    text: {
      uk: "Свіжі надходження з каталогу в одному місці.",
      en: "Fresh arrivals from the catalog in one place.",
    },
    imageAlt: { uk: "Пакети з покупками та цінник", en: "Shopping bags and a price tag" },
    image: "banner-season.webp",
    link: "/catalog",
    tone: "accent",
  },
  {
    id: "5eedba22-0000-4000-8000-000000000002",
    layout: "card",
    title: { uk: "Ідеї для подарунків", en: "Gift ideas" },
    text: {
      uk: "Шукайте подарунок у каталозі за категоріями.",
      en: "Browse the catalog by category to find a gift.",
    },
    // No alt text: a decorative picture, the card's title names the link.
    image: "banner-gifts.webp",
    link: "/c/demo-clothing",
    tone: "surface",
  },
  {
    id: "5eedba22-0000-4000-8000-000000000003",
    layout: "image",
    // The same words as in the picture (a screen reader does not read a picture).
    imageAlt: {
      uk: "Нова колекція. Дивіться новинки в каталозі",
      en: "New collection. See what is new in the catalog",
    },
    image: "banner-collection-uk.webp",
    localeImages: [{ locale: "en", file: "banner-collection-en.webp" }],
    link: "/catalog",
    tone: "surface",
  },
];
