/**
 * The footer's extra columns (reshape experiment, client request 5). Internal to the storefront, like `theme.ts`: a client
 * fork edits it. Labels are message keys. Empty lists hide their part; `newsletter: false` hides the signup placeholder.
 */
export type SocialIcon = "instagram" | "facebook" | "telegram";

export interface FooterConfig {
  /** TODO(fluxkit): UI only. No newsletter feature exists (no API, no consent record, no email list). */
  newsletter: boolean;
  /** `https://` addresses of the shop's profiles; placeholders here. */
  social: readonly { labelKey: string; href: `https://${string}`; icon: SocialIcon }[];
  /** Payment methods shown as text badges (no third-party logos in the template). */
  paymentKeys: readonly string[];
}

export const footerConfig: FooterConfig = {
  newsletter: true,
  social: [
    {
      labelKey: "footer.social.instagram",
      href: "https://example.com/instagram",
      icon: "instagram",
    },
    { labelKey: "footer.social.facebook", href: "https://example.com/facebook", icon: "facebook" },
    { labelKey: "footer.social.telegram", href: "https://example.com/telegram", icon: "telegram" },
  ],
  paymentKeys: ["footer.payment.card", "footer.payment.applePay", "footer.payment.googlePay"],
};
