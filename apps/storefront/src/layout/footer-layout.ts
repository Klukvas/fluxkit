/**
 * The footer as data (plan 2026-11-08-design-changeability.md, L3; contract `docs/contracts/header-footer.md`): the types of
 * the fork-owned `config/footer.ts`, the pure view `components/site-footer.tsx` renders, and the checks its spec runs. The
 * footer stays one column of blocks (`.fk-site-footer` in app/globals.css); which blocks, their order, text lines from
 * messages, and the link groups (with optional headings) of its one labelled navigation are configurable. Columns side by
 * side, social links (external) and payment icons are the `footer.columns` slot (`config/slots.tsx`, `docs/contracts/slots.md`)
 * or a code edit.
 */
import type { ContactsView } from "../lib/contacts";
import { isPlainStorefrontPath } from "../lib/locale-path";
import { repeatedValues } from "./header-layout";
import type { NavigationLink } from "./navigation";

/**
 * The footer's named blocks. `navigation` is one labelled `nav` holding the link groups as lists; `contacts` the shop's phones
 * and email (`config/contacts.ts`, nothing when none is set); `themeSwitch` the Light / Dark / System switch (only while
 * `showToggle` of `config/theme.ts` is true); `copyright` one line. The "powered by" line is not a block: `SiteFooter` always
 * renders it last (the template's attribution).
 */
export type FooterBlockName = "navigation" | "contacts" | "themeSwitch" | "copyright";

/**
 * A line of text from the messages (for example accepted payment methods or a short note): `textKey` is a message key, a
 * fork's own one under `custom.` in `messages-extra`. Plain text only, no link and no picture.
 */
export interface FooterTextBlock {
  kind: "text";
  textKey: string;
}

/** A block of the footer: a named block (each at most once) or a text line (each key at most once). */
export type FooterBlock = FooterBlockName | FooterTextBlock;

/**
 * A list of links in the footer's navigation: the shop pages with `inFooter` (`config/shop-pages.ts`), the legal pages
 * (`config/legal.ts`), or the fork's own links (message key and storefront path without the locale; internal paths only).
 * `headingKey`, when set, puts a small heading (`h2`, message key) above the list.
 */
export type FooterLinkGroup = (
  { kind: "shopPages" } | { kind: "legal" } | { kind: "links"; links: readonly NavigationLink[] }
) & { headingKey?: string };

export interface FooterConfig {
  /** The blocks, top to bottom; a block that is not listed is not rendered. */
  blocks: readonly FooterBlock[];
  navigation: {
    /** The lists of the navigation block, in order; an empty list renders nothing (nor its heading). */
    groups: readonly FooterLinkGroup[];
  };
}

/** A resolved link group: its heading's message key (or `null`) and its links. */
export interface FooterLinkGroupView {
  headingKey: string | null;
  links: readonly NavigationLink[];
}

export type FooterBlockView =
  | { kind: "navigation"; groups: readonly FooterLinkGroupView[] }
  | { kind: "contacts"; contacts: ContactsView }
  | { kind: "themeSwitch" }
  | { kind: "copyright" }
  | { kind: "text"; textKey: string };

/**
 * The footer's blocks as `SiteFooter` renders them, in config order. Left out: empty link groups, `navigation` when no group
 * has a link (no empty landmark), `themeSwitch` while the theme config hides it. The contacts block is passed on as it is:
 * `FooterContacts` renders nothing without a phone or an email. A config with a structural problem throws here
 * (`assertFooterConfig`, with `showThemeSwitch` as `showToggle`), so a fork that skipped the tests still fails loudly.
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
  assertFooterConfig(config, input.showThemeSwitch);
  const groups = config.navigation.groups
    .map((group): FooterLinkGroupView => {
      const headingKey = group.headingKey ?? null;
      switch (group.kind) {
        case "shopPages":
          return { headingKey, links: input.shopLinks };
        case "legal":
          return { headingKey, links: input.legalLinks };
        case "links":
          return { headingKey, links: group.links };
        default: {
          const unknown: never = group;
          throw new RangeError(`Unknown footer link group ${JSON.stringify(unknown)}`);
        }
      }
    })
    .filter((group) => group.links.length > 0);
  const blocks: FooterBlockView[] = [];
  for (const block of config.blocks) {
    if (typeof block !== "string") {
      blocks.push({ kind: "text", textKey: block.textKey });
      continue;
    }
    switch (block) {
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
        const unknown: never = block;
        throw new RangeError(`Unknown footer block ${String(unknown)}`);
      }
    }
  }
  return blocks;
}

/**
 * What is wrong with a footer config (empty when nothing is): run by `layout/footer-layout.spec.ts` on `config/footer.ts`
 * with the message keys of each locale, and at render without them (`messageKeys` `null`: the translator throws instead).
 * `showToggle` is that of `config/theme.ts`: hiding the switch while the shop still honours a stored choice would leave a
 * shopper unable to change it back.
 */
export function footerConfigProblems(
  config: FooterConfig,
  messageKeys: ReadonlySet<string> | null,
  showToggle: boolean,
): string[] {
  const problems: string[] = [];
  const missingKey = (key: string) => messageKeys !== null && !messageKeys.has(key);
  if (config.blocks.length === 0) problems.push("footer lists no blocks");
  const named = config.blocks.filter(
    (block): block is FooterBlockName => typeof block === "string",
  );
  for (const block of repeatedValues(named)) {
    problems.push(`footer block "${block}" is listed more than once`);
  }
  const texts = config.blocks.filter(
    (block): block is FooterTextBlock => typeof block !== "string",
  );
  for (const key of repeatedValues(texts.map((block) => block.textKey))) {
    problems.push(`footer text "${key}" is listed more than once`);
  }
  for (const block of texts) {
    if (missingKey(block.textKey)) {
      problems.push(`footer text: message key "${block.textKey}" does not exist`);
    }
  }
  const builtIn = config.navigation.groups
    .map((group) => group.kind)
    .filter((kind) => kind !== "links");
  for (const kind of repeatedValues(builtIn)) {
    problems.push(`footer link group "${kind}" is listed more than once`);
  }
  config.navigation.groups.forEach((group, index) => {
    if (group.headingKey !== undefined && missingKey(group.headingKey)) {
      problems.push(
        `footer link group ${String(index + 1)}: heading key "${group.headingKey}" does not exist`,
      );
    }
    if (group.kind !== "links") return;
    if (group.links.length === 0) {
      problems.push(`footer link group ${String(index + 1)} has no links`);
    }
    for (const link of group.links) {
      if (!isPlainStorefrontPath(link.href)) {
        problems.push(`footer link "${link.href}" is not a plain storefront path`);
      }
      if (missingKey(link.labelKey)) {
        problems.push(`footer link "${link.href}": message key "${link.labelKey}" does not exist`);
      }
    }
    for (const href of repeatedValues(group.links.map((link) => link.href))) {
      problems.push(`footer link "${href}" is listed more than once in group ${String(index + 1)}`);
    }
  });
  if (showToggle && !config.blocks.includes("themeSwitch")) {
    problems.push(
      'footer block "themeSwitch" is missing while `showToggle` in config/theme.ts is true: set `showToggle: false` to hide the switch',
    );
  }
  return problems;
}

/** Throws with every structural problem of a footer config (see `footerConfigProblems`). */
export function assertFooterConfig(config: FooterConfig, showToggle: boolean): void {
  const problems = footerConfigProblems(config, null, showToggle);
  if (problems.length > 0) {
    throw new Error(`config/footer.ts is invalid: ${problems.join("; ")}`);
  }
}
