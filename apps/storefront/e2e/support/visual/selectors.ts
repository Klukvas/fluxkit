/**
 * The FIXED, versioned list of elements whose computed styles the visual harness records (plan
 * `docs/plans/2026-11-08-design-changeability.md`, section 7). Pure data: no Playwright import, so the unit tests can check
 * it without a browser (`selectors.spec.ts`); `browser.ts` turns an entry into a locator.
 *
 * Rules for an entry (checked by `selectors.spec.ts`):
 * - located by ARIA role (with an optional accessible name or heading level), by a stable `data-*` attribute, by an element
 *   or attribute selector, or by visible text; NEVER by a utility class (no `.` class selector anywhere),
 * - the first VISIBLE match counts; no match is recorded as "absent" (a difference too, when the other side has it),
 * - a name is never reused for another element: renaming or removing an entry, or changing what it finds, bumps
 *   `SELECTOR_LIST_VERSION` (both sides of a comparison always run the same harness, so a bump never mixes versions).
 */
/**
 * 2: `overlay.dialog` and `footer.heading` removed (never matched), `feedback.*` scoped to main (PR 239 review).
 * 3: `feedback.alert` removed (scoped to main it never matched on the compared pages; CI warning of PR 239).
 * 4: `home.hero-picture` added (the hero's picture alone, a screenshot mask for B4's neutral demo pictures, PR-E2).
 * 5: `cart.checkout-link` added (the cart's checkout link alone, a screenshot mask for its `uk` label change, PR 261).
 */
export const SELECTOR_LIST_VERSION = 5;

/** Where the search starts: the whole page or one landmark. */
export type SelectorScope = "page" | "banner" | "main" | "contentinfo";

/** ARIA roles the list uses (a subset of Playwright's `AriaRole`, kept here so this file needs no Playwright import). */
export type SelectorRole =
  | "banner"
  | "button"
  | "checkbox"
  | "combobox"
  | "contentinfo"
  | "heading"
  | "link"
  | "main"
  | "navigation"
  | "radio"
  | "search"
  | "status"
  | "textbox";

/** One step of the path from the scope to the element; exactly one of `role`, `css` or `text`. */
export type SelectorStep =
  | {
      role: SelectorRole;
      /** Accessible name as the source of a regular expression (case-sensitive). */
      name?: string;
      /** Heading level, `role: "heading"` only. */
      level?: 1 | 2 | 3 | 4 | 5 | 6;
    }
  | { css: string }
  | { text: string };

export interface SelectorSpec {
  /** Stable key in the snapshot and in `.visual/exceptions.json`: `<area>.<element>`, lower case. */
  name: string;
  /** What the entry is meant to find, for the report and the README. */
  description: string;
  scope: SelectorScope;
  steps: readonly SelectorStep[];
}

/** A price as the `uk` pages print it: `1 199,00 ₴`, `від 499,00 ₴` (Intl `uk`, UAH; grouping by a no-break space). */
const UK_PRICE = String.raw`\d[\d\s  ]*(?:,\d+)?\s?₴`;

export const SELECTORS: readonly SelectorSpec[] = [
  {
    name: "page.body",
    description: "the document body (page background, base text colour and font)",
    scope: "page",
    steps: [{ css: "body" }],
  },
  {
    name: "header.banner",
    description: "the site header landmark",
    scope: "page",
    steps: [{ role: "banner" }],
  },
  {
    name: "header.first-link",
    description: "the first visible link of the header (the shop name or logo)",
    scope: "banner",
    steps: [{ role: "link" }],
  },
  {
    name: "header.nav-link",
    description: "the first visible link of the header's main navigation",
    scope: "banner",
    steps: [{ role: "navigation" }, { role: "link" }],
  },
  {
    name: "header.search-input",
    description: "the text field of the header search form",
    scope: "banner",
    steps: [{ role: "search" }, { css: "input" }],
  },
  {
    name: "header.search-button",
    description: "the first visible button of the header search form",
    scope: "banner",
    steps: [{ role: "search" }, { role: "button" }],
  },
  {
    name: "header.button",
    description: "the first visible button of the header (menu, language or account control)",
    scope: "banner",
    steps: [{ role: "button" }],
  },
  {
    name: "main.h1",
    description: "the page heading",
    scope: "main",
    steps: [{ role: "heading", level: 1 }],
  },
  {
    name: "main.h2",
    description: "the first visible second-level heading of the main content",
    scope: "main",
    steps: [{ role: "heading", level: 2 }],
  },
  {
    name: "main.h3",
    description: "the first visible third-level heading of the main content",
    scope: "main",
    steps: [{ role: "heading", level: 3 }],
  },
  {
    name: "main.link",
    description: "the first visible link of the main content",
    scope: "main",
    steps: [{ role: "link" }],
  },
  {
    name: "main.breadcrumb-link",
    description:
      "the first link of a navigation inside the main content (breadcrumbs, account menu)",
    scope: "main",
    steps: [{ role: "navigation" }, { role: "link" }],
  },
  {
    name: "button.primary",
    description:
      "the first submit button of the main content (add to cart, sign in, place order: variant primary)",
    scope: "main",
    steps: [{ css: 'button[type="submit"]' }],
  },
  {
    name: "button.secondary",
    description: "the cart line's remove button (variant secondary)",
    scope: "main",
    steps: [{ role: "button", name: "^Видалити" }],
  },
  {
    // Both `uk` labels ("Оформити замовлення" before PR 261, "Оформлення" after) start with "Оформ", so either side finds the
    // link; on the cart page the funnel's checkout step is not a link yet, so it cannot match first.
    name: "cart.checkout-link",
    description: "the cart summary's link to the checkout",
    scope: "main",
    steps: [{ role: "link", name: "^Оформ" }],
  },
  {
    name: "main.button",
    description: "the first visible button of the main content",
    scope: "main",
    steps: [{ role: "button" }],
  },
  {
    name: "form.textbox",
    description: "the first visible text field of the main content",
    scope: "main",
    steps: [{ role: "textbox" }],
  },
  {
    name: "form.select",
    description: "the first visible native select of the main content",
    scope: "main",
    steps: [{ css: "select" }],
  },
  {
    name: "form.checkbox",
    description: "the first visible checkbox of the main content",
    scope: "main",
    steps: [{ role: "checkbox" }],
  },
  {
    name: "form.radio",
    description:
      "the first visible radio button of the main content (option picker, delivery choice)",
    scope: "main",
    steps: [{ role: "radio" }],
  },
  {
    name: "card.article",
    description: "the first product card",
    scope: "main",
    steps: [{ css: "article" }],
  },
  {
    name: "card.title",
    description: "the heading of the first product card",
    scope: "main",
    steps: [{ css: "article" }, { role: "heading" }],
  },
  {
    name: "card.badge",
    description:
      "the availability badge of the first product card that has one (a direct span child of the card)",
    scope: "main",
    steps: [{ css: "article > span" }],
  },
  {
    name: "price.text",
    description: "the first visible price of the main content",
    scope: "main",
    steps: [{ text: UK_PRICE }],
  },
  {
    name: "product.badge",
    description: "the availability badge of the product page",
    scope: "main",
    steps: [{ css: "#product-availability" }],
  },
  {
    name: "product.summary",
    description: "the product page's summary column",
    scope: "main",
    steps: [{ css: "[data-product-summary]" }],
  },
  {
    name: "home.hero",
    description: "the home page hero",
    scope: "main",
    steps: [{ css: "[data-hero]" }],
  },
  {
    // The picture alone, so a PR that replaces the demo picture masks only it in the screenshots (plan B4), not the hero's text.
    name: "home.hero-picture",
    description: "the picture of the home page hero",
    scope: "main",
    steps: [{ css: "[data-hero]" }, { css: "img" }],
  },
  {
    name: "home.banner-card",
    description: "the first home banner card",
    scope: "main",
    steps: [{ css: "[data-banner-id]" }],
  },
  {
    name: "home.trust-bar",
    description: "the trust bar",
    scope: "page",
    steps: [{ css: "[data-trust-bar]" }],
  },
  {
    // Inside the main content only: page-level matches were always-present live regions (Next's route announcer). An alert
    // entry was dropped in version 3: no compared page shows one in its default state, so it only ever compared "absent".
    name: "feedback.status",
    description: "the first visible status region of the main content",
    scope: "main",
    steps: [{ role: "status" }],
  },
  {
    // The row of the result count, the list/grid switch (PR-F, plan L2/L5) and the sort: the region PR-F masks in the
    // screenshots of the catalog and search pages (`.visual/exceptions.json`). Same element on both sides of a comparison.
    name: "results.toolbar",
    description: "the toolbar row of a faceted list (result count, view switch, sort)",
    scope: "main",
    steps: [{ css: 'div:has(> [role="status"] > #search-results-heading)' }],
  },
  {
    name: "footer.contentinfo",
    description: "the site footer landmark",
    scope: "page",
    steps: [{ role: "contentinfo" }],
  },
  {
    name: "footer.link",
    description: "the first visible link of the footer",
    scope: "contentinfo",
    steps: [{ role: "link" }],
  },
  {
    name: "footer.button",
    description: "the first visible button of the footer (theme switch)",
    scope: "contentinfo",
    steps: [{ role: "button" }],
  },
];

export const SELECTOR_NAMES: ReadonlySet<string> = new Set(SELECTORS.map((entry) => entry.name));

export function selectorByName(name: string): SelectorSpec {
  const found = SELECTORS.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Unknown visual selector "${name}".`);
  return found;
}
