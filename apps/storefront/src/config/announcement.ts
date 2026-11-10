/**
 * FORK config (a file the fork added): the thin announcement bar above the header row (`components/announcement-bar.tsx`,
 * registered in the `header.top` slot of `config/slots.tsx`). `messageKey` is a key of the fork's `custom.` namespace in
 * `src/messages-extra/{uk,en}.json`; `href` is a storefront path without the locale, or `null` for plain text. `null` as
 * the whole value hides the bar.
 */
export interface AnnouncementConfig {
  messageKey: string;
  href: string | null;
}

export const announcement: AnnouncementConfig | null = {
  messageKey: "custom.announcement.text",
  href: "/delivery-and-payment",
};
