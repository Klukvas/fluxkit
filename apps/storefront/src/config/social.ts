/**
 * The social links of the fork's footer (`components/footer-columns.tsx`). A NEW file of the fork: `config/footer.ts` refuses
 * external URLs, so the links live here and a `footer.columns` column renders them.
 *
 * TODO(fluxkit): placeholders. The addresses are `example.com` (reserved, RFC 2606) so they reach nobody; the client's own profile
 * addresses replace them. `labelKey` is a `custom.` key of both messages-extra files (the link's accessible name); `icon` picks
 * the drawing in `components/footer-columns.tsx`. Absolute `https://` only.
 */
export interface SocialLink {
  id: string;
  icon: "instagram" | "facebook" | "telegram";
  labelKey: `custom.${string}`;
  href: `https://${string}`;
}

export const socialLinks: readonly SocialLink[] = [
  {
    id: "instagram",
    icon: "instagram",
    labelKey: "custom.footer.social.instagram",
    href: "https://example.com/social/instagram",
  },
  {
    id: "facebook",
    icon: "facebook",
    labelKey: "custom.footer.social.facebook",
    href: "https://example.com/social/facebook",
  },
  {
    id: "telegram",
    icon: "telegram",
    labelKey: "custom.footer.social.telegram",
    href: "https://example.com/social/telegram",
  },
];
