/**
 * The announcement bar above the header (the fork's `header.top` slot component, `components/announcement-bar.tsx`). A NEW file of
 * the fork, not part of the template: it is the "from config" half of the bar, so the text and the link change here and in
 * `src/messages-extra/{uk,en}.json` without touching the component.
 *
 * `messageKey` is a `custom.` key of both messages-extra files. `href` is a storefront path without the locale, or `null` for a
 * bar that is only text. `enabled: false` hides the bar (the slot component then returns `null`).
 */
export interface AnnouncementConfig {
  enabled: boolean;
  messageKey: `custom.${string}`;
  href: `/${string}` | null;
  /** Message key of the link's text, shown after the message when `href` is set. */
  linkLabelKey: `custom.${string}`;
}

export const announcementConfig: AnnouncementConfig = {
  enabled: true,
  messageKey: "custom.announcement.text",
  href: "/delivery-and-payment",
  linkLabelKey: "custom.announcement.link",
};
