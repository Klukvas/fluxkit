import type { LocalImage } from "./home";

/**
 * FORK (reshape R5): what the fork's footer columns show besides the template's links and contacts
 * (`components/fork/footer-columns.tsx`, the `footer.columns` slot of `config/slots.tsx`). A new file of the fork.
 *
 * TODO(fluxkit): PLACEHOLDERS, all of it. The social addresses are `example.com` pages, the glyphs are neutral line icons (not
 * the networks' logos) and the pay pictures are neutral pictograms (not the schemes' marks): a client puts its own pages and
 * the marks it is licensed to show here.
 */

/** The neutral glyph of a social link (`SocialGlyph` in `components/fork/footer-columns.tsx`). */
export type SocialGlyphName = "photo" | "message" | "video";

export interface SocialLink {
  /** Unique: the list key. */
  id: string;
  /** Message key of the link's accessible name (`custom.` namespace). */
  labelKey: string;
  /** `https://` only; anything else is left out. */
  href: string;
  glyph: SocialGlyphName;
}

export const socialLinks: readonly SocialLink[] = [
  {
    id: "photo",
    labelKey: "custom.footer.social.photo",
    href: "https://example.com/photo",
    glyph: "photo",
  },
  {
    id: "message",
    labelKey: "custom.footer.social.message",
    href: "https://example.com/chat",
    glyph: "message",
  },
  {
    id: "video",
    labelKey: "custom.footer.social.video",
    href: "https://example.com/video",
    glyph: "video",
  },
];

/** The accepted ways to pay, as pictures under `public/fork/` (each with its own background, so it reads on both themes). */
export const payIcons: readonly LocalImage[] = [
  { src: "/fork/pay-bank-card.svg", width: 64, height: 40, altKey: "custom.footer.pay.bankCard" },
  {
    src: "/fork/pay-on-delivery.svg",
    width: 64,
    height: 40,
    altKey: "custom.footer.pay.onDelivery",
  },
  { src: "/fork/pay-transfer.svg", width: 64, height: 40, altKey: "custom.footer.pay.transfer" },
];
