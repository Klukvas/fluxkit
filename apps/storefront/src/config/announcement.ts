/**
 * The thin announcement bar above the header (reshape experiment, client request 3). Internal to the storefront, like
 * `theme.ts`: a client fork edits it. The text is a message key (uk and en in `src/messages`); `null` hides the bar.
 * Plain text only, no link: every byte of it is in every page's first HTML (README, "Keep the header small").
 */
export interface AnnouncementConfig {
  messageKey: string | null;
}

export const announcementConfig: AnnouncementConfig = {
  messageKey: "announcement.text",
};
