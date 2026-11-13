import { locales, type Locale } from "@fluxkit/ui";
import {
  knownShopPageSlugs,
  productOptionGuide,
  productPageNote,
  shopPages,
  type ShopPageConfig,
  type ShopPageSection,
  type ShopPageSlug,
} from "../config/shop-pages";
import { localizedHref } from "./locale-path";

/**
 * Lookups and checks of the shop pages (`config/shop-pages.ts`). Pure: the route, the footer, the product page note, the trust
 * bar and the sitemap all go through here, so a page removed from the config disappears from every one of them.
 */

const SLUG = /^[a-z][a-z0-9-]*$/;
const ID = /^[a-z][a-z0-9-]*$/;

/**
 * First path segments other routes own (`app/[locale]/...`) or the template reserves. A shop page with one of these slugs would
 * never be reached (a static segment wins over `[page]`) or would shadow a later route. The locale codes are reserved too
 * (review m4 of PR 232): `/uk/en` would read like a language switch.
 */
export const RESERVED_SLUGS: readonly string[] = [
  ...locales,
  "account",
  "api",
  "c",
  "cart",
  "catalog",
  "checkout",
  "legal",
  "media",
  "order",
  "p",
  "payment",
  "search",
  "store",
  "theme",
];

function sectionMessageKeys(section: ShopPageSection): string[] {
  const title = "titleKey" in section && section.titleKey !== undefined ? [section.titleKey] : [];
  switch (section.kind) {
    case "text":
      return [...title, section.bodyKey];
    case "table":
      return [
        ...title,
        section.captionKey,
        ...section.columnKeys,
        ...section.rows.flatMap((row) => row.flatMap((cell) => ("key" in cell ? [cell.key] : []))),
        ...(section.noteKey === undefined ? [] : [section.noteKey]),
      ];
    case "faq":
      return [...title, ...section.items.flatMap((item) => [item.questionKey, item.answerKey])];
    case "contacts":
      return title;
    case "links":
      return title;
    default: {
      const unknown: never = section;
      throw new Error(`Unknown shop page section ${JSON.stringify(unknown)}.`);
    }
  }
}

/** Every message key a page uses (for the spec that checks both message files). */
export function shopPageMessageKeys(page: ShopPageConfig): string[] {
  return [page.titleKey, page.descriptionKey, ...page.sections.flatMap(sectionMessageKeys)];
}

/**
 * Throws on a malformed list: a repeated or reserved slug, a malformed or repeated section or question id, a table row whose
 * length is not the number of columns, a table without columns or rows, a FAQ without questions, or a "see also" link to a
 * page that is not a known slug.
 */
export function checkShopPages(pages: readonly ShopPageConfig[]): void {
  const slugs = new Set<string>();
  for (const page of pages) {
    if (!SLUG.test(page.slug))
      throw new RangeError(`Shop page slug "${page.slug}" is not a lowercase slug.`);
    if (RESERVED_SLUGS.includes(page.slug)) {
      throw new RangeError(`Shop page slug "${page.slug}" belongs to another route.`);
    }
    if (slugs.has(page.slug)) throw new RangeError(`Shop page "${page.slug}" is listed twice.`);
    slugs.add(page.slug);
    const ids = new Set<string>();
    for (const section of page.sections) {
      if (!ID.test(section.id) || ids.has(section.id)) {
        throw new RangeError(
          `Section id "${section.id}" of "${page.slug}" is malformed or repeated.`,
        );
      }
      ids.add(section.id);
      if (section.kind === "table") {
        if (section.columnKeys.length === 0 || section.rows.length === 0) {
          throw new RangeError(`Table "${section.id}" of "${page.slug}" needs columns and rows.`);
        }
        for (const row of section.rows) {
          if (row.length !== section.columnKeys.length) {
            throw new RangeError(
              `A row of table "${section.id}" of "${page.slug}" has ${String(row.length)} cells for ${String(section.columnKeys.length)} columns.`,
            );
          }
          for (const cell of row) {
            if ("value" in cell && cell.value.trim() === "") {
              throw new RangeError(`Table "${section.id}" of "${page.slug}" has an empty cell.`);
            }
          }
        }
      }
      if (section.kind === "links") {
        const known: readonly string[] = knownShopPageSlugs;
        for (const slug of section.pages) {
          if (!known.includes(slug)) {
            throw new RangeError(
              `"See also" link "${slug}" of "${page.slug}" names no known shop page.`,
            );
          }
        }
      }
      if (section.kind === "faq") {
        if (section.items.length === 0) {
          throw new RangeError(`FAQ "${section.id}" of "${page.slug}" has no question.`);
        }
        const itemIds = new Set<string>();
        for (const item of section.items) {
          if (!ID.test(item.id) || itemIds.has(item.id)) {
            throw new RangeError(
              `Question id "${item.id}" of "${page.slug}" is malformed or repeated.`,
            );
          }
          itemIds.add(item.id);
        }
      }
    }
  }
}

/** The enabled page with this slug, or `null` (the route answers 404). */
export function findShopPage(
  slug: string,
  pages: readonly ShopPageConfig[] = shopPages,
): ShopPageConfig | null {
  checkShopPages(pages);
  return pages.find((page) => page.slug === slug) ?? null;
}

/** The locale-less path of an enabled page, or `null` when the page is not enabled (a link to it is left out). */
export function shopPagePath(
  slug: ShopPageSlug,
  pages: readonly ShopPageConfig[] = shopPages,
): `/${string}` | null {
  return pages.some((page) => page.slug === slug) ? `/${slug}` : null;
}

export interface ShopPageLink {
  slug: ShopPageSlug;
  href: string;
  titleKey: string;
}

/** Links to the enabled pages among `slugs`, in that order, with the locale. */
export function shopPageLinks(
  locale: Locale,
  slugs: readonly ShopPageSlug[],
  pages: readonly ShopPageConfig[] = shopPages,
): ShopPageLink[] {
  return slugs.flatMap((slug) => {
    const page = pages.find((entry) => entry.slug === slug);
    return page === undefined
      ? []
      : [{ slug, href: localizedHref(locale, `/${slug}`), titleKey: page.titleKey }];
  });
}

/** The locale-less paths of every enabled page, for the sitemap. */
export function shopPagePaths(pages: readonly ShopPageConfig[] = shopPages): string[] {
  return pages.map((page) => `/${page.slug}`);
}

/** The product page note with its enabled links, or `null` when it is switched off or links nowhere. */
export function productNoteView(
  locale: Locale,
  note: typeof productPageNote = productPageNote,
  pages: readonly ShopPageConfig[] = shopPages,
): { titleKey: string; summaryKey: string; links: ShopPageLink[] } | null {
  if (note === null) return null;
  const links = shopPageLinks(locale, note.pages, pages);
  return links.length === 0
    ? null
    : { titleKey: note.titleKey, summaryKey: note.summaryKey, links };
}

/**
 * The link next to the option pickers of a product (plan 2026-11-13-product-type-guide-page). `typePage` is the product
 * type's `optionGuidePage` from the API (a slug the API cannot check against this storefront): when it is set, it decides,
 * and a slug that is not an enabled page here gives no link (never the fallback). When the type names no page, the fallback
 * `productOptionGuide` of `config/shop-pages.ts` applies (`null` upstream: no link). `null` when there is nothing to link.
 */
export function optionGuideLink(
  locale: Locale,
  typePage: string | null,
  fallback: ShopPageSlug | null = productOptionGuide,
  pages: readonly ShopPageConfig[] = shopPages,
): ShopPageLink | null {
  const slug = typePage ?? fallback;
  if (slug === null) return null;
  const page = pages.find((entry) => entry.slug === slug);
  return page === undefined
    ? null
    : { slug: page.slug, href: localizedHref(locale, `/${page.slug}`), titleKey: page.titleKey };
}

/** Plain text to paragraphs: a blank line starts a new one; blank paragraphs are dropped. */
export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
}
