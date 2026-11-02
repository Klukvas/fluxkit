import type { Messages } from "@fluxkit/ui";

/**
 * Namespaces of message keys that client components use. Only these are serialized into the page for the browser, so the
 * client payload stays small as server-only namespaces (home sections, footer) grow. Add a prefix here when a client
 * component starts using a new namespace (README, "How to add a message").
 */
export const CLIENT_MESSAGE_PREFIXES = [
  "nav.",
  "site.",
  "seo.",
  "locale.",
  "error.",
  "errors.",
  "notFound.",
  "loading.",
  "product.",
  "availability.",
  "cart.",
  "account.",
  "checkout.",
  "order.",
  "payment.",
  "notice.",
  // The header search box and the filter form of the results page (the page's own words stay server-side under "search.").
  "searchBox.",
  "searchForm.",
  // Design batch A (plan 2026-11-03-storefront-design-a.md): the account pages' breadcrumbs, the trust bar and the funnel steps
  // are rendered by client islands (account layout, product page, cart, checkout, order pages).
  "breadcrumbs.",
  "trust.",
  "funnel.",
] as const;

export function pickClientMessages(messages: Messages): Messages {
  return Object.fromEntries(
    Object.entries(messages).filter(([key]) =>
      CLIENT_MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix)),
    ),
  );
}
