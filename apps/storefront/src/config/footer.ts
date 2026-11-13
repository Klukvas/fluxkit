/**
 * The footer's composition: which blocks, top to bottom, and the link groups of its navigation. FORK-OWNED: upstream creates
 * this file once and never edits it again, so a client fork changes it without merge conflicts (plan
 * 2026-11-08-design-changeability.md, L3 and principle 6; contract `docs/contracts/header-footer.md`; how-to
 * `docs/customization.md`). The values below are the template's defaults; upstream edits them only together with
 * `docs/contracts/header-footer.md` (round 4, 2026-11-13: the `columns` layout became the default and the theme switch moved
 * to the header's `theme` control; the footer before it is `blocks: ["navigation", "contacts", "themeSwitch", "copyright"]`
 * without `layout`). The types, the view and the checks are in `layout/footer-layout.ts`; a wrong value fails
 * `layout/footer-layout.spec.ts` (and the TypeScript build for an unknown block name).
 *
 * `layout`: `stack` (also when left out) puts the blocks top to bottom in one column with ONE labelled navigation; `columns`
 * makes each link group a column (a navigation named by its heading: `headingKey`, or "Customer service" / "Legal" for the
 * built-in groups; an own `links` group needs a `headingKey`) and the contacts a column, two columns on a phone and four from
 * `lg`, with the other blocks and the "powered by" line in a bottom row. While `showToggle` of `config/theme.ts` is true, the
 * theme switch must be here (`themeSwitch`) or in the header (`theme` control of `config/header.ts`); both is allowed.
 *
 * NOT here: which shop pages are linked (`inFooter` in `config/shop-pages.ts`), the legal pages (`config/legal.ts`), the
 * contacts (`config/contacts.ts`), whether the theme switch exists at all (`showToggle` in `config/theme.ts`), the texts
 * (`messages-overrides`), social links (external URLs are not allowed here) or payment icons (a code edit of
 * `components/site-footer.tsx`). The "powered by" line is not a block: it always closes the footer (the template's
 * attribution; changing it is an owner decision).
 *
 * Besides the named blocks, `{ kind: "text", textKey }` adds a plain line of text (for example the accepted payment methods), and
 * a link group may carry a `headingKey` (a small heading above its list). New texts go into `src/messages-extra/{uk,en}.json`
 * under `custom.`; changed template texts into `src/messages-overrides/{uk,en}.json`.
 *
 * Example: the copyright on top, the legal pages first (with a heading), then the shop pages and the fork's own links, a
 * payments line (both `custom.` keys in `messages-extra`; backticks here only because `messages/messages.spec.ts` checks every
 * quoted key literal in the source, comments included, and upstream has no such keys):
 *
 *   export const footerConfig: FooterConfig = {
 *     blocks: ["copyright", "navigation", { kind: "text", textKey: `custom.footer.payments` }, "contacts", "themeSwitch"],
 *     navigation: {
 *       groups: [
 *         { kind: "legal", headingKey: `custom.footer.legal` },
 *         { kind: "shopPages" },
 *         { kind: "links", links: [{ labelKey: "nav.catalog", href: "/catalog" }] },
 *       ],
 *     },
 *   };
 */
import type { FooterConfig } from "../layout/footer-layout";

export const footerConfig: FooterConfig = {
  layout: "columns",
  blocks: ["navigation", "contacts", "copyright"],
  navigation: {
    groups: [{ kind: "shopPages" }, { kind: "legal" }],
  },
};
