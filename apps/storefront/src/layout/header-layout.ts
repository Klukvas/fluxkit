/**
 * The header as data (plan 2026-11-08-design-changeability.md, L3; contract `docs/contracts/header-footer.md`): the types of
 * the fork-owned `config/header.ts`, the pure view `components/site-header.tsx` renders, and the checks its spec runs. Only
 * what needs no change of the header's CSS structure is configurable: which blocks, in which order, the order of the controls
 * at the end, the number of categories and the links after them. A centred header, a second row or an announcement bar is a
 * code edit of `site-header.tsx`.
 */
import type { Locale, Translator } from "@fluxkit/ui";
import { isPlainStorefrontPath, localizedHref } from "../lib/locale-path";
import type { NavigationLink } from "./navigation";

/** A top-level category as the header links it (`lib/navigation-categories.ts`). */
export interface NavigationCategory {
  slug: string;
  name: string;
}

/**
 * The parts of the header row. `menu` is the navigation below `xl` (a disclosure button), `navigation` the same links inline
 * from `xl`: the two go together. `search` shows only when the shop has search on (`GET /store/config`). `controls` is the
 * group at the end of the row (`.fk-header-end`, pushed to the end), holding the `controls` in their order.
 */
export type HeaderBlockName = "menu" | "logo" | "navigation" | "search" | "controls";

/** The client islands of the controls group: the language list, the cart icon with its count, the account menu. */
export type HeaderControlName = "language" | "cart" | "account";

export interface HeaderConfig {
  /** The blocks of the header row, in order; a block that is not listed is not rendered. Each at most once. */
  blocks: readonly HeaderBlockName[];
  /** The controls of the `controls` block, in order; each at most once. An empty list renders no group. */
  controls: readonly HeaderControlName[];
  navigation: {
    /** Most top-level categories in the navigation, 0 to `HEADER_CATEGORY_LIMIT_MAX`; the rest are reachable through the catalog. */
    categoryLimit: number;
    /** Links after the categories: a message key and a storefront path without the locale (`localizedHref` adds it). */
    links: readonly NavigationLink[];
  };
}

/** The upper bound of `categoryLimit`: the inline row scrolls, but every link is in each page's first HTML twice. */
export const HEADER_CATEGORY_LIMIT_MAX = 12;

/** A resolved navigation link: a unique React key, the localized target, the label. */
export interface HeaderLink {
  key: string;
  href: string;
  label: string;
}

export type HeaderBlockView =
  | { kind: "menu"; links: readonly HeaderLink[] }
  | { kind: "logo" }
  | { kind: "navigation"; links: readonly HeaderLink[] }
  | { kind: "search" }
  | { kind: "controls"; controls: readonly HeaderControlName[] };

/**
 * The header's blocks as `SiteHeader` renders them, in config order. Left out: `search` when the shop has no search, `menu`
 * and `navigation` when there is no link at all (no empty landmark), `controls` when it holds none. `categories` is `null`
 * when the API could not be read: the configured links still show.
 */
export function headerView(
  config: HeaderConfig,
  input: {
    locale: Locale;
    t: Translator;
    categories: readonly NavigationCategory[] | null;
    searchEnabled: boolean;
  },
): HeaderBlockView[] {
  const { locale, t } = input;
  const links: HeaderLink[] = [
    ...(input.categories ?? []).slice(0, config.navigation.categoryLimit).map((category) => ({
      key: `c:${category.slug}`,
      href: localizedHref(locale, `/c/${encodeURIComponent(category.slug)}`),
      label: category.name,
    })),
    ...config.navigation.links.map((link) => ({
      key: link.href,
      href: localizedHref(locale, link.href),
      label: t(link.labelKey),
    })),
  ];
  const blocks: HeaderBlockView[] = [];
  for (const name of config.blocks) {
    switch (name) {
      case "menu":
      case "navigation":
        if (links.length > 0) blocks.push({ kind: name, links });
        break;
      case "logo":
        blocks.push({ kind: "logo" });
        break;
      case "search":
        if (input.searchEnabled) blocks.push({ kind: "search" });
        break;
      case "controls":
        if (config.controls.length > 0)
          blocks.push({ kind: "controls", controls: config.controls });
        break;
      default: {
        const unknown: never = name;
        throw new RangeError(`Unknown header block ${String(unknown)}`);
      }
    }
  }
  return blocks;
}

/** The values that occur more than once, each once (for one problem per repeated value). */
export function repeatedValues<T>(values: readonly T[]): T[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

/** What is wrong with a header config (empty when nothing is): run by `layout/header-layout.spec.ts` on `config/header.ts`. */
export function headerConfigProblems(
  config: HeaderConfig,
  messageKeys: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  for (const block of repeatedValues(config.blocks)) {
    problems.push(`header block "${block}" is listed more than once`);
  }
  for (const control of repeatedValues(config.controls)) {
    problems.push(`header control "${control}" is listed more than once`);
  }
  if (config.blocks.includes("menu") !== config.blocks.includes("navigation")) {
    problems.push(
      'header blocks "menu" and "navigation" go together: the menu is the navigation below `xl`, the inline list from `xl`',
    );
  }
  const limit = config.navigation.categoryLimit;
  if (!Number.isInteger(limit) || limit < 0 || limit > HEADER_CATEGORY_LIMIT_MAX) {
    problems.push(
      `header categoryLimit must be a whole number from 0 to ${String(HEADER_CATEGORY_LIMIT_MAX)}`,
    );
  }
  for (const link of config.navigation.links) {
    if (!isPlainStorefrontPath(link.href)) {
      problems.push(`header link "${link.href}" is not a plain storefront path`);
    }
    if (!messageKeys.has(link.labelKey)) {
      problems.push(`header link "${link.href}": message key "${link.labelKey}" does not exist`);
    }
  }
  for (const href of repeatedValues(config.navigation.links.map((link) => link.href))) {
    problems.push(`header link "${href}" is listed more than once`);
  }
  return problems;
}
