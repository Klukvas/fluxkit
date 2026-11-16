import type { Locale } from "@fluxkit/ui";

/** The template maker's site, separate from the shop's branding and contacts. */
export const demoNoticeUrls: Readonly<Record<Locale, string>> = {
  uk: "https://flux-lab.dev/uk?utm_source=fluxkit-demo&utm_medium=demo-notice",
  en: "https://flux-lab.dev/en?utm_source=fluxkit-demo&utm_medium=demo-notice",
};
