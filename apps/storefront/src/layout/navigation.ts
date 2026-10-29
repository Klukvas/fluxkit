/**
 * Header and footer links as configuration (AGENTS.md section 2.2): labels are message keys, targets are storefront paths
 * without the locale (`localizedHref` adds it). Reorder, add or remove entries here without touching a component. Internal
 * to the storefront in v1, not a public contract (plan, open question 11).
 */

import { legalPages } from "../config/legal";

export interface NavigationLink {
  labelKey: string;
  href: string;
}

/** The `id` of `<main>`, the target of the skip link. */
export const MAIN_CONTENT_ID = "main-content";

/** Links after the category list in the header navigation. */
export const headerLinks: readonly NavigationLink[] = [
  { labelKey: "nav.catalog", href: "/catalog" },
];

/** Most top-level categories shown in the header; the rest are reachable through the catalog. */
export const HEADER_CATEGORY_LIMIT = 6;

export const footerLinks: readonly NavigationLink[] = [
  { labelKey: "footer.catalog", href: "/catalog" },
  { labelKey: "footer.cart", href: "/cart" },
  { labelKey: "footer.account", href: "/account" },
  // The legal pages (privacy plan step 10) come from their own config: add or remove a page there, the footer follows.
  ...legalPages.map((page) => ({ labelKey: page.labelKey, href: `/legal/${page.slug}` })),
];

/** Targets of the header's cart and account islands. */
export const sessionLinks = {
  cart: "/cart",
  account: "/account",
  signIn: "/account/login",
} as const;
