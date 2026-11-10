/**
 * FORK config (a file the fork added): the social profiles of the footer's contacts column (`components/footer-columns.tsx`).
 * `labelKey` is a key of the fork's `custom.` namespace (the link's accessible name); `href` an absolute `https://` address.
 * TODO(fluxkit): placeholder addresses on the reserved `example.com` domain; a client fork puts its real profiles here.
 */
export type SocialIcon = "photo" | "video" | "chat";

export interface SocialLink {
  icon: SocialIcon;
  labelKey: string;
  href: `https://${string}`;
}

export const socialLinks: readonly SocialLink[] = [
  { icon: "photo", labelKey: "custom.footer.social.photo", href: "https://example.com/photos" },
  { icon: "video", labelKey: "custom.footer.social.video", href: "https://example.com/videos" },
  { icon: "chat", labelKey: "custom.footer.social.chat", href: "https://example.com/chat" },
];

/** Payment method pictures under `public/payments/` (neutral placeholders, no third-party logo). */
export const paymentIcons: readonly { src: `/${string}`; altKey: string }[] = [
  { src: "/payments/card.svg", altKey: "custom.footer.payment.card" },
  { src: "/payments/bank.svg", altKey: "custom.footer.payment.bank" },
  { src: "/payments/cash.svg", altKey: "custom.footer.payment.cash" },
];
