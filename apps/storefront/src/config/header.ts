/**
 * The header's composition: which blocks, in which order, the controls at the end of the row, the number of categories and the
 * links after them. FORK-OWNED: upstream creates this file once and never edits it again, so a client fork changes it without
 * merge conflicts (plan 2026-11-08-design-changeability.md, L3 and principle 6; contract `docs/contracts/header-footer.md`;
 * how-to `docs/customization.md`). The values below are the template's defaults and render exactly the header the template
 * rendered before this file existed. The types, the view and the checks are in `layout/header-layout.ts`; a wrong value fails
 * `layout/header-layout.spec.ts` (and the TypeScript build for an unknown block name).
 *
 * Supported orders (anything else fails the check, also at render): `logo` is required; `controls`, when listed, is the LAST
 * block; `menu` and `navigation` go together; `menu` is either the first block shown on a phone (before `logo`, with only
 * `navigation` before it; its dropdown opens towards the end, the default) or the last one (after `logo`, with only
 * `navigation` after it and no `controls`; its dropdown opens towards the start). Below `lg` the logo grows, so everything
 * after it sits at the end of the row; `navigation` shows only from `xl`. Other places put the dropdown past a phone's edge.
 * A link's text is a message key: a new text goes into `src/messages-extra/{uk,en}.json` under `custom.` (a changed template
 * text into `src/messages-overrides/{uk,en}.json`).
 *
 * NOT here: the logo (`config/brand.ts`), the header's look (tokens, `.fk-header-*` in app/globals.css), a centred header, a
 * second row or an announcement bar (a code edit of `components/site-header.tsx`).
 *
 * Example: the search icon right after the menu button, four categories, the cart before the language list, the delivery
 * page linked after the catalog:
 *
 *   export const headerConfig: HeaderConfig = {
 *     blocks: ["menu", "search", "logo", "navigation", "controls"],
 *     controls: ["cart", "account", "language"],
 *     navigation: {
 *       categoryLimit: 4,
 *       links: [
 *         { labelKey: "nav.catalog", href: "/catalog" },
 *         { labelKey: "shopPages.delivery.title", href: "/delivery-and-payment" },
 *       ],
 *     },
 *   };
 *
 * A "logo left, menu right" header has no controls group: `blocks: ["logo", "search", "menu", "navigation"], controls: []`.
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
