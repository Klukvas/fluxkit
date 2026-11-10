/**
 * The footer's composition: which blocks, top to bottom, and the link groups of its navigation. FORK-OWNED: upstream creates
 * this file once and never edits it again, so a client fork changes it without merge conflicts (plan
 * 2026-11-08-design-changeability.md, L3 and principle 6; contract `docs/contracts/header-footer.md`; how-to
 * `docs/customization.md`). The values below are the template's defaults and render exactly the footer the template rendered
 * before this file existed. The types, the view and the checks are in `layout/footer-layout.ts`; a wrong value fails
 * `layout/footer-layout.spec.ts` (and the TypeScript build for an unknown block name).
 *
 * NOT here: which shop pages are linked (`inFooter` in `config/shop-pages.ts`), the legal pages (`config/legal.ts`), the
 * contacts (`config/contacts.ts`), whether the theme switch exists at all (`showToggle` in `config/theme.ts`), the texts
 * (`messages-overrides`), columns side by side, social links (external URLs are not allowed here) or payment icons (a code
 * edit of `components/site-footer.tsx`). The "powered by" line is not a block: it always closes the footer (the template's
 * attribution; changing it is an owner decision).
 *
 * Besides the named blocks, `{ kind: "text", textKey }` adds a plain line of text (for example the accepted payment methods), and
 * a link group may carry a `headingKey` (a small heading above its list). New texts go into `src/messages-extra/{uk,en}.json`
 * under `custom.`; changed template texts into `src/messages-overrides/{uk,en}.json`.
 *
 * Example: the copyright on top, the legal pages first (with a heading), then the shop pages and the fork's own links, a
 * payments line (both `custom.` keys in `messages-extra`):
 *
 *   export const footerConfig: FooterConfig = {
 *     blocks: ["copyright", "navigation", { kind: "text", textKey: "custom.footer.payments" }, "contacts", "themeSwitch"],
 *     navigation: {
 *       groups: [
 *         { kind: "legal", headingKey: "custom.footer.legal" },
 *         { kind: "shopPages" },
 *         { kind: "links", links: [{ labelKey: "nav.catalog", href: "/catalog" }] },
 *       ],
 *     },
 *   };
 */
import type { FooterConfig } from "../layout/footer-layout";

export const footerConfig: FooterConfig = {
  blocks: ["navigation", "contacts", "themeSwitch", "copyright"],
  navigation: {
    groups: [{ kind: "shopPages" }, { kind: "legal" }],
  },
};
