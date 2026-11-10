/**
 * The footer as data (plan 2026-11-08-design-changeability.md, L3; contract `docs/contracts/header-footer.md`): the types of
 * the fork-owned `config/footer.ts`, the pure view `components/site-footer.tsx` renders, and the checks its spec runs. The
 * footer stays one column of blocks (`.fk-site-footer` in app/globals.css); which blocks, their order and the link groups of
 * its one labelled navigation are configurable. Columns side by side, headings or social and payment icons are a code edit
 * (or, later, the `footer.columns` slot of plan WP5).
 */
import type { ContactsView } from "../lib/contacts";
import { isPlainStorefrontPath } from "../lib/locale-path";
import { repeatedValues } from "./header-layout";
import type { NavigationLink } from "./navigation";

/**
 * The footer's blocks. `navigation` is one labelled `nav` holding the link groups as lists; `contacts` the shop's phones and
 * email (`config/contacts.ts`, nothing when none is set); `themeSwitch` the Light / Dark / System switch (only while
 * `showToggle` of `config/theme.ts` is true); `copyright` one line. The "powered by" line is not a block: `SiteFooter` always
 * renders it last (the template's attribution).
 */
export type FooterBlockName = "navigation" | "contacts" | "themeSwitch" | "copyright";

/**
 * A list of links in the footer's navigation: the shop pages with `inFooter` (`config/shop-pages.ts`), the legal pages
 * (`config/legal.ts`), or the fork's own links (message key and storefront path without the locale).
 */
export type FooterLinkGroup =
  { kind: "shopPages" } | { kind: "legal" } | { kind: "links"; links: readonly NavigationLink[] };

export interface FooterConfig {
  /** The blocks, top to bottom; a block that is not listed is not rendered. Each at most once. */
  blocks: readonly FooterBlockName[];
  navigation: {
    /** The lists of the navigation block, in order; an empty list renders nothing. */
    groups: readonly FooterLinkGroup[];
  };
}

export type FooterBlockView =
  | { kind: "navigation"; groups: readonly (readonly NavigationLink[])[] }
  | { kind: "contacts"; contacts: ContactsView }
  | { kind: "themeSwitch" }
  | { kind: "copyright" };

/**
 * The footer's blocks as `SiteFooter` renders them, in config order. Left out: empty link groups, `navigation` when no group
 * has a link (no empty landmark), `themeSwitch` while the theme config hides it. The contacts block is passed on as it is:
 * `FooterContacts` renders nothing without a phone or an email.
 */
export function footerView(
  config: FooterConfig,
  input: {
    shopLinks: readonly NavigationLink[];
    legalLinks: readonly NavigationLink[];
    contacts: ContactsView;
    showThemeSwitch: boolean;
  },
): FooterBlockView[] {
  const groups = config.navigation.groups
    .map((group) => {
      switch (group.kind) {
        case "shopPages":
          return input.shopLinks;
        case "legal":
          return input.legalLinks;
        case "links":
          return group.links;
        default: {
          const unknown: never = group;
          throw new RangeError(`Unknown footer link group ${JSON.stringify(unknown)}`);
        }
      }
    })
    .filter((links) => links.length > 0);
  const blocks: FooterBlockView[] = [];
  for (const name of config.blocks) {
    switch (name) {
      case "navigation":
        if (groups.length > 0) blocks.push({ kind: "navigation", groups });
        break;
      case "contacts":
        blocks.push({ kind: "contacts", contacts: input.contacts });
        break;
      case "themeSwitch":
        if (input.showThemeSwitch) blocks.push({ kind: "themeSwitch" });
        break;
      case "copyright":
        blocks.push({ kind: "copyright" });
        break;
      default: {
        const unknown: never = name;
        throw new RangeError(`Unknown footer block ${String(unknown)}`);
      }
    }
  }
  return blocks;
}

/**
 * What is wrong with a footer config (empty when nothing is): run by `layout/footer-layout.spec.ts` on `config/footer.ts`.
 * `showToggle` is that of `config/theme.ts`: hiding the switch while the shop still honours a stored choice would leave a
 * shopper unable to change it back.
 */
export function footerConfigProblems(
  config: FooterConfig,
  messageKeys: ReadonlySet<string>,
  showToggle: boolean,
): string[] {
  const problems: string[] = [];
  for (const block of repeatedValues(config.blocks)) {
    problems.push(`footer block "${block}" is listed more than once`);
  }
  const builtIn = config.navigation.groups
    .map((group) => group.kind)
    .filter((kind) => kind !== "links");
  for (const kind of repeatedValues(builtIn)) {
    problems.push(`footer link group "${kind}" is listed more than once`);
  }
  config.navigation.groups.forEach((group, index) => {
    if (group.kind !== "links") return;
    if (group.links.length === 0) {
      problems.push(`footer link group ${String(index + 1)} has no links`);
    }
    for (const link of group.links) {
      if (!isPlainStorefrontPath(link.href)) {
        problems.push(`footer link "${link.href}" is not a plain storefront path`);
      }
      if (!messageKeys.has(link.labelKey)) {
        problems.push(`footer link "${link.href}": message key "${link.labelKey}" does not exist`);
      }
    }
  });
  if (showToggle && !config.blocks.includes("themeSwitch")) {
    problems.push(
      'footer block "themeSwitch" is missing while `showToggle` in config/theme.ts is true: set `showToggle: false` to hide the switch',
    );
  }
  return problems;
}
