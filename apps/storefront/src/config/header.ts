/**
 * The header's composition: which blocks, in which order, the controls at the end of the row, the number of categories and the
 * links after them. FORK-OWNED: upstream creates this file once and never edits it again, so a client fork changes it without
 * merge conflicts (plan 2026-11-08-design-changeability.md, L3 and principle 6; contract `docs/contracts/header-footer.md`;
 * how-to `docs/customization.md`). The values below are the template's defaults and render exactly the header the template
 * rendered before this file existed. The types, the view and the checks are in `layout/header-layout.ts`; a wrong value fails
 * `layout/header-layout.spec.ts` (and the TypeScript build for an unknown block name).
 *
 * Supported orders: `logo` is required; `controls`, when listed, is the LAST block (the row pushes it to the end and its
 * dropdowns open towards the start); `menu` and `navigation` go together; the menu's dropdown opens towards the end from the
 * first half of the row and towards the start from the second half. Anything else fails the check, also at render.
 * A link's text is a message key: a new text goes into `src/messages-extra/{uk,en}.json` under `custom.` (a changed template
 * text into `src/messages-overrides/{uk,en}.json`).
 *
 * NOT here: the logo (`config/brand.ts`), the header's look (tokens, `.fk-header-*` in app/globals.css), a centred header, a
 * second row or an announcement bar (a code edit of `components/site-header.tsx`).
 *
 * Example: logo first, the search box after the navigation, four categories, the cart before the language list, the delivery
 * page linked after the catalog:
 *
 *   export const headerConfig: HeaderConfig = {
 *     blocks: ["logo", "menu", "navigation", "search", "controls"],
 *     controls: ["cart", "account", "language"],
 *     navigation: {
 *       categoryLimit: 4,
 *       links: [
 *         { labelKey: "nav.catalog", href: "/catalog" },
 *         { labelKey: "shopPages.delivery.title", href: "/delivery-and-payment" },
 *       ],
 *     },
 *   };
 */
import type { HeaderConfig } from "../layout/header-layout";

export const headerConfig: HeaderConfig = {
  blocks: ["menu", "logo", "navigation", "search", "controls"],
  controls: ["language", "cart", "account"],
  navigation: {
    categoryLimit: 6,
    links: [{ labelKey: "nav.catalog", href: "/catalog" }],
  },
};
