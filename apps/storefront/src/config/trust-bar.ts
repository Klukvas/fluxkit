/**
 * The trust bar next to the product page's "Add to cart", under the cart summary and in the checkout's summary column (review
 * recommendation 1, plan 2026-11-03-storefront-design-a.md). Internal to the storefront in v1, like `checkout.ts`: a client
 * fork edits this list and the `trust.*` messages. An empty list hides the bar everywhere.
 */

import type { ShopPageSlug } from "./shop-pages";

/** The icons a trust bar item can show (`components/icons.tsx`). */
export type TrustBarIconKey = "delivery" | "payment" | "contact" | "returns";

export interface TrustBarItemConfig {
  icon: TrustBarIconKey;
  /** Message key of the line (uk and en in `src/messages`). */
  messageKey: string;
  /** A shop page the line links to (`config/shop-pages.ts`); a page that is not enabled leaves the line as plain text. */
  page?: ShopPageSlug;
}

/**
 * TODO(fluxkit): demo copy (`demo-content.json` `trustBar`: a release build with `STOREFRONT_REQUIRE_LEGAL_TEXT=true` refuses
 * until the fork clears it). Generic placeholders, NOT promises of the template: a client fork replaces them with what the shop
 * really offers (delivery time, return period, payment methods) or empties the list. Never ship them unchanged as a legal
 * statement.
 */
export const trustBarItems: readonly TrustBarItemConfig[] = [
  { icon: "delivery", messageKey: "trust.delivery", page: "delivery-and-payment" },
  { icon: "payment", messageKey: "trust.payment" },
  { icon: "contact", messageKey: "trust.contact", page: "contacts" },
];
