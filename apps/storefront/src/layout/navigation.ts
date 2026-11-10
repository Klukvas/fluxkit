/**
 * Footer and account links as configuration (AGENTS.md section 2.2): labels are message keys, targets are storefront paths
 * without the locale (`localizedHref` adds it). Internal to the storefront, not a public contract (plan, open question 11).
 * The header's links, its category count and the order of the header and footer blocks are in the fork-owned
 * `config/header.ts` and `config/footer.ts` (contract `docs/contracts/header-footer.md`).
 */

import { legalPages } from "../config/legal";
import { shopPages } from "../config/shop-pages";

export interface NavigationLink {
  labelKey: string;
  href: string;
}

/** The `id` of `<main>`, the target of the skip link. */
export const MAIN_CONTENT_ID = "main-content";

/**
 * The footer's second list: the legal pages (privacy plan step 10), from their own config: add or remove a page there, the
 * footer follows. Catalog, cart and account are not repeated here (repair batch 2): the header shows all three on every page,
 * and the footer's bytes went to the shop pages and the contacts instead (then under a byte budget; since ADR 0048 a loose cap).
 */
export const footerLinks: readonly NavigationLink[] = legalPages.map((page) => ({
  labelKey: page.labelKey,
  href: `/legal/${page.slug}`,
}));

/**
 * The shop pages linked from the footer (repair batch 2): the enabled pages of `config/shop-pages.ts` with `inFooter`, in
 * config order, as their own short list before `footerLinks`. Remove a page there, or set `inFooter: false`, and the footer
 * follows.
 */
export const footerShopLinks: readonly NavigationLink[] = shopPages
  .filter((page) => page.inFooter)
  .map((page) => ({ labelKey: page.titleKey, href: `/${page.slug}` }));

/** Targets of the header's cart and account islands. */
export const sessionLinks = {
  cart: "/cart",
  account: "/account",
  signIn: "/account/login",
  register: "/account/register",
} as const;

/**
 * The signed-in customer's pages, in menu order: the header's account menu and the account pages' side menu (tabs on a
 * phone) both list these (owner decision 2026-11-02). "Your data" (privacy, ADR 0033) is labelled "Privacy and data".
 */
export const accountLinks: readonly NavigationLink[] = [
  { labelKey: "nav.account.overview", href: "/account" },
  { labelKey: "nav.account.orders", href: "/account/orders" },
  { labelKey: "nav.account.profile", href: "/account/profile" },
  { labelKey: "nav.account.privacy", href: "/account/data" },
];

/** The guest's entries of the header's account menu. */
export const guestLinks: readonly NavigationLink[] = [
  { labelKey: "nav.account.signIn", href: sessionLinks.signIn },
  { labelKey: "nav.account.register", href: sessionLinks.register },
];

/**
 * The account link that is "current" for a path: the longest matching one, so `/account/orders/AB-12` marks "My orders"
 * and only `/account` itself marks the overview. `pathname` is locale-less.
 */
export function currentAccountLink(pathname: string): string | null {
  const matches = accountLinks
    .map((link) => link.href)
    .filter((href) =>
      href === "/account"
        ? pathname === href
        : pathname === href || pathname.startsWith(`${href}/`),
    );
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}
