/**
 * The header as data (plan 2026-11-08-design-changeability.md, L3; contract `docs/contracts/header-footer.md`): the types of
 * the fork-owned `config/header.ts`, the pure view `components/site-header.tsx` renders, and the checks its spec runs. Only
 * what needs no change of the header's CSS structure is configurable: which blocks, in which order (with `controls` last), the
 * order of the controls, the number of categories and the links after them. A centred header, a second row or an announcement
 * bar is a code edit of `site-header.tsx`.
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
 * from `xl`: the two go together. `logo` is the link to the home page (required). `search` shows only when the shop has
 * search on (`GET /store/config`). `controls` is the group at the end of the row (`.fk-header-end`, pushed to the end by
 * `ms-auto`, its dropdowns open towards the start), holding the `controls` in their order: it must be the LAST block.
 */
export type HeaderBlockName = "menu" | "logo" | "navigation" | "search" | "controls";

/** The client islands of the controls group: the language list, the cart icon with its count, the account menu. */
export type HeaderControlName = "language" | "cart" | "account";

export interface HeaderConfig {
  /**
   * CORE-EDIT (fork a1-reshape): `centred` puts the logo in the middle from `lg`, the navigation links split before and after
   * it (from `xl`), the controls at the end, and the search box in a full-width row below. Below `lg` the header is the same
   * one row as `row` (the default). `blocks` still decides which blocks exist; their order is fixed in `centred`.
   */
  layout?: "row" | "centred";
  /** The blocks of the header row, in order; a block that is not listed is not rendered. Each at most once. */
  blocks: readonly HeaderBlockName[];
  /** The controls of the `controls` block, in order; each at most once; not empty while `controls` is listed. */
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

/** The side of its button a dropdown panel is aligned with (`HeaderDisclosure`). */
export type PanelAlign = "start" | "end";

export type HeaderBlockView =
  | { kind: "menu"; links: readonly HeaderLink[]; align: PanelAlign }
  | { kind: "logo" }
  | { kind: "navigation"; links: readonly HeaderLink[] }
  | { kind: "search" }
  | { kind: "controls"; controls: readonly HeaderControlName[] };

/**
 * Where the menu's panel (`w-max min-w-48`, absolutely placed under its button) opens. Below `lg` the logo grows
 * (`max-lg:grow`), so every block after it packs at the END of the row and `navigation` is hidden below `xl`: the button's
 * place on a phone depends on what follows it, not on its index. Two shapes only, measured in Chromium at 320, 360 and 390 px,
 * left-to-right and right-to-left, with every control set and the search box on and off (zero overflow):
 * - `menu` before `logo` with nothing before it that shows on a phone (only `navigation` may precede it): the button is the
 *   first thing in the row, the panel opens towards the end (`start`, the default);
 * - `menu` after `logo` with nothing after it that shows on a phone (only `navigation` may follow, and no `controls` at all):
 *   the button is the last thing in the row, the panel opens towards the start (`end`).
 * Every other order is refused by `headerConfigProblems`: its panel was measured past an edge of the screen (a search icon
 * before the button moved it 52 px in, enough for a long category name at 360 px).
 */
export function menuPanelAlign(config: HeaderConfig): PanelAlign {
  return config.blocks.indexOf("menu") < config.blocks.indexOf("logo") ? "start" : "end";
}

/** Whether the menu's place is one of the two measured shapes (see `menuPanelAlign`); true without a menu. */
export function isSupportedMenuPlace(blocks: readonly HeaderBlockName[]): boolean {
  const menu = blocks.indexOf("menu");
  if (menu === -1) return true;
  const hiddenOnPhone = (block: HeaderBlockName) => block === "navigation";
  if (menu < blocks.indexOf("logo")) return blocks.slice(0, menu).every(hiddenOnPhone);
  return !blocks.includes("controls") && blocks.slice(menu + 1).every(hiddenOnPhone);
}

/**
 * The header's blocks as `SiteHeader` renders them, in config order. Left out: `search` when the shop has no search, `menu`
 * and `navigation` when there is no link at all (no empty landmark). `categories` is `null` when the API could not be read:
 * the configured links still show. A config with a structural problem throws here (`assertHeaderConfig`), so a fork that
 * skipped the tests still fails loudly on the first page instead of rendering a broken header.
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
  assertHeaderConfig(config);
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
        if (links.length > 0) blocks.push({ kind: "menu", links, align: menuPanelAlign(config) });
        break;
      case "navigation":
        if (links.length > 0) blocks.push({ kind: "navigation", links });
        break;
      case "logo":
        blocks.push({ kind: "logo" });
        break;
      case "search":
        if (input.searchEnabled) blocks.push({ kind: "search" });
        break;
      case "controls":
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

/**
 * What is wrong with a header config (empty when nothing is): run by `layout/header-layout.spec.ts` on `config/header.ts`
 * with the message keys of each locale, and at render without them (`messageKeys` `null`: the translator already throws on
 * an unknown key).
 */
export function headerConfigProblems(
  config: HeaderConfig,
  messageKeys: ReadonlySet<string> | null,
): string[] {
  const problems: string[] = [];
  if (config.blocks.length === 0) problems.push("header lists no blocks");
  if (!config.blocks.includes("logo")) {
    problems.push('header block "logo" is required (the link to the home page)');
  }
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
  if (config.blocks.includes("controls")) {
    if (config.controls.length === 0) {
      problems.push(
        'header block "controls" is listed but `controls` is empty: leave the block out instead',
      );
    }
    if (config.blocks.at(-1) !== "controls") {
      problems.push(
        'header block "controls" must be the last block (the row pushes it to the end and its dropdowns open towards the start)',
      );
    }
  }
  if (config.blocks.includes("logo") && !isSupportedMenuPlace(config.blocks)) {
    problems.push(
      'header block "menu" must be the first block shown on a phone (before "logo", preceded by nothing but "navigation") or the last one (after "logo", followed by nothing but "navigation", with no "controls"): elsewhere its dropdown opens past the edge of a phone screen',
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
    if (messageKeys !== null && !messageKeys.has(link.labelKey)) {
      problems.push(`header link "${link.href}": message key "${link.labelKey}" does not exist`);
    }
  }
  for (const href of repeatedValues(config.navigation.links.map((link) => link.href))) {
    problems.push(`header link "${href}" is listed more than once`);
  }
  return problems;
}

/** Throws with every structural problem of a header config (see `headerConfigProblems`). */
export function assertHeaderConfig(config: HeaderConfig): void {
  const problems = headerConfigProblems(config, null);
  if (problems.length > 0) {
    throw new Error(`config/header.ts is invalid: ${problems.join("; ")}`);
  }
}
