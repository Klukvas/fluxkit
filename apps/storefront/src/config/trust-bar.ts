/**
 * The trust bar next to the product page's "Add to cart", under the cart summary and in the checkout's summary column (review
 * recommendation 1, plan 2026-11-03-storefront-design-a.md). Internal to the storefront in v1, like `checkout.ts`: a client
 * fork edits this list and the `trust.*` messages. An empty list hides the bar everywhere.
 */

/** The icons a trust bar item can show (`components/icons.tsx`). */
export type TrustBarIconKey = "delivery" | "payment" | "contact" | "returns";

export interface TrustBarItemConfig {
  icon: TrustBarIconKey;
  /** Message key of the line (uk and en in `src/messages`). */
  messageKey: string;
}

/**
 * TODO(fluxkit): demo copy. Generic placeholders, NOT promises of the template: a client fork replaces them with what the shop
 * really offers (delivery time, return period, payment methods) or empties the list. Never ship them unchanged as a legal
 * statement.
 */
export const trustBarItems: readonly TrustBarItemConfig[] = [
  { icon: "delivery", messageKey: "trust.delivery" },
  { icon: "payment", messageKey: "trust.payment" },
  { icon: "contact", messageKey: "trust.contact" },
];
