/**
 * Pages and frames of the visual harness (plan `docs/plans/2026-11-08-design-changeability.md`, section 7). Pure data,
 * checked by `pages.spec.ts`. The seeded dataset is the TEST FIXTURE of `pnpm seed:test` (`e2e/prepare-database.ts`).
 */

/** The seeded product with options (colour, size) that the product page and the cart line use. */
export const PRODUCT_SLUG = "demo-t-shirt";
/** The variant put into the cart before the cart and checkout pages (black, M). */
export const CART_VARIANT_SKU = "DEMO-T-SHIRT-BLACK-M";

/** The instant the browser clock is installed at, before every navigation. */
export const FROZEN_TIME = "2026-11-08T12:00:00Z";

/** The cookie the storefront reads the theme from (ADR 0045). */
export const THEME_COOKIE = "fluxkit_theme";

export type Theme = "light" | "dark" | "system";
export const THEMES: readonly Theme[] = ["light", "dark", "system"];

export interface VisualPage {
  /** Stable key in snapshots, screenshot names and `.visual/exceptions.json`. */
  id: string;
  path: string;
  /** `cart-line`: one line (`CART_VARIANT_SKU`) is added to the browser's cart through the API before the visit. */
  setup?: "cart-line";
}

/** The computed-style comparison: 8 pages, each in light and dark, at the desktop size. */
export const COMPUTED_STYLE_PAGES: readonly VisualPage[] = [
  { id: "home", path: "/uk" },
  { id: "catalog", path: "/uk/catalog" },
  { id: "product", path: `/uk/p/${PRODUCT_SLUG}` },
  { id: "cart", path: "/uk/cart", setup: "cart-line" },
  { id: "checkout", path: "/uk/checkout", setup: "cart-line" },
  { id: "login", path: "/uk/account/login" },
  { id: "register", path: "/uk/account/register" },
  { id: "legal-privacy", path: "/uk/legal/privacy" },
];
export const COMPUTED_STYLE_THEMES: readonly Theme[] = ["light", "dark"];
export const COMPUTED_STYLE_VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * A phone-width pass of the computed styles (light and dark), limited to the selectors whose look changes most below the
 * desktop breakpoints (header, hero, banner card, product card); `selectors` keeps the run short.
 */
export const COMPUTED_STYLE_MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
export const COMPUTED_STYLE_MOBILE_SELECTORS: readonly string[] = [
  "header.banner",
  "header.first-link",
  "header.button",
  "home.hero",
  "home.banner-card",
  "card.article",
  "card.title",
  "card.badge",
  "price.text",
];
export const COMPUTED_STYLE_MOBILE_PAGES: readonly VisualPage[] = [
  { id: "home-390", path: "/uk" },
  { id: "catalog-390", path: "/uk/catalog" },
];

const ALWAYS_REQUIRED = ["page.body", "header.banner", "main.h1", "footer.contentinfo"];
const CARDS = ["card.article", "card.title", "price.text"];
const FORM = ["form.textbox", "button.primary"];

/**
 * Positive coverage: what each computed-style page MUST find (on both sides). Without it a selector that silently stopped
 * matching anything would compare as "absent = absent" and hide a refactor. Matches what the first CI run recorded
 * (PR 239). `computed-styles.visual.ts` fails a page whose required selector is missing.
 */
export const REQUIRED_SELECTORS: Readonly<Record<string, readonly string[]>> = {
  home: [...ALWAYS_REQUIRED, ...CARDS, "home.hero", "home.banner-card"],
  catalog: [...ALWAYS_REQUIRED, ...CARDS],
  product: [...ALWAYS_REQUIRED, "product.summary", "product.badge", "price.text", "button.primary"],
  cart: [...ALWAYS_REQUIRED, "button.secondary", "price.text"],
  checkout: [...ALWAYS_REQUIRED, ...FORM],
  login: [...ALWAYS_REQUIRED, ...FORM],
  register: [...ALWAYS_REQUIRED, ...FORM],
  "legal-privacy": ALWAYS_REQUIRED,
  "home-390": ["header.banner", "home.hero", "card.article"],
  "catalog-390": ["header.banner", "card.article"],
};

/** The required selectors of a page that were absent (`null`) or not recorded at all. */
export function missingRequiredSelectors(
  pageId: string,
  styles: Readonly<Record<string, unknown>>,
): string[] {
  const required = REQUIRED_SELECTORS[pageId];
  if (required === undefined) throw new Error(`Page "${pageId}" has no required selectors.`);
  return required.filter((name) => styles[name] === undefined || styles[name] === null);
}

export const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;

export interface ScreenshotFrame {
  page: VisualPage;
  viewport: ViewportName;
  theme: Theme;
  /** `false`: the page is loaded with scripts off (the server HTML as a browser without JavaScript shows it). */
  javaScript: boolean;
}

/** Pages shot at both sizes in light and dark. */
export const SCREENSHOT_PAGES: readonly VisualPage[] = [
  ...COMPUTED_STYLE_PAGES,
  { id: "search", path: "/uk/search?q=футболка" },
  { id: "not-found", path: "/uk/nonexistent" },
];
/** Pages also shot in the system theme with a dark colour scheme (both sizes). */
export const SYSTEM_THEME_PAGE_IDS: readonly string[] = ["home", "product"];
/** English pages, desktop only, light and dark. */
export const ENGLISH_PAGES: readonly VisualPage[] = [
  { id: "en-home", path: "/en" },
  { id: "en-catalog", path: "/en/catalog" },
];
/** Pages shot a second time without scripts (both sizes, light). */
export const NO_SCRIPT_PAGES: readonly VisualPage[] = [
  { id: "register", path: "/uk/account/register" },
  { id: "en-register", path: "/en/account/register" },
];

/** Element shots: taken on the home page at both sizes, light and dark. Names are entries of `selectors.ts`. */
export const ELEMENT_SHOT_SELECTORS: readonly string[] = [
  "header.banner",
  "footer.contentinfo",
  "card.article",
  "home.hero",
];
export const ELEMENT_SHOT_PAGE_ID = "home";

export function screenshotFrames(): ScreenshotFrame[] {
  const frames: ScreenshotFrame[] = [];
  for (const page of SCREENSHOT_PAGES) {
    for (const viewport of ["mobile", "desktop"] as const) {
      for (const theme of ["light", "dark"] as const) {
        frames.push({ page, viewport, theme, javaScript: true });
      }
      if (SYSTEM_THEME_PAGE_IDS.includes(page.id)) {
        frames.push({ page, viewport, theme: "system", javaScript: true });
      }
    }
  }
  for (const page of ENGLISH_PAGES) {
    for (const theme of ["light", "dark"] as const) {
      frames.push({ page, viewport: "desktop", theme, javaScript: true });
    }
  }
  for (const page of NO_SCRIPT_PAGES) {
    for (const viewport of ["mobile", "desktop"] as const) {
      frames.push({ page, viewport, theme: "light", javaScript: false });
    }
  }
  return frames;
}

/** The file name (without extension) of a frame's screenshot, e.g. `home-1280-dark` or `register-390-light-nojs`. */
export function frameName(frame: ScreenshotFrame): string {
  const width = String(VIEWPORTS[frame.viewport].width);
  return `${frame.page.id}-${width}-${frame.theme}${frame.javaScript ? "" : "-nojs"}`;
}

/** Every page id the harness knows (exceptions may name only these, or `*`). */
export function knownPageIds(): Set<string> {
  return new Set(
    [
      ...COMPUTED_STYLE_PAGES,
      ...COMPUTED_STYLE_MOBILE_PAGES,
      ...SCREENSHOT_PAGES,
      ...ENGLISH_PAGES,
      ...NO_SCRIPT_PAGES,
    ].map((page) => page.id),
  );
}
