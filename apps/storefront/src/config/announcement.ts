/**
 * FORK (reshape R3): the thin announcement bar above the header row (`components/fork/announcement-bar.tsx`, registered in
 * the `header.top` slot of `config/slots.tsx`). A new file of the fork: upstream does not know it.
 *
 * The text is a message key of the fork's `custom.` namespace (`src/messages-extra/{uk,en}.json`); keep it to one short line:
 * below `lg` the bar is part of the sticky header. `link` is an optional link after the text: a message key and a plain
 * storefront path without the locale (the same rule as the header's links). `enabled: false` removes the bar.
 */
export interface AnnouncementConfig {
  enabled: boolean;
  textKey: string;
  link: { labelKey: string; href: string } | null;
}

export const announcementConfig: AnnouncementConfig = {
  enabled: true,
  textKey: "custom.announcement.text",
  link: { labelKey: "custom.announcement.link", href: "/delivery-and-payment" },
};
