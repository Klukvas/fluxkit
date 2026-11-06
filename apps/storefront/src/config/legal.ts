/**
 * The shop's legal pages and who is responsible for them (privacy plan step 10, ADR 0033 decision 11; AGENTS.md sections 2.2
 * and 15). Internal to the storefront in v1: a client fork edits THIS file and the `legal.*` messages, nowhere else.
 *
 * Master ships placeholders only: the texts are i18n messages that say the shop must supply its own, and the identity
 * (`legal-identity.json`) is empty. A page shows a visible placeholder for every identity value that is still `null`.
 * Nothing here is legal advice.
 * TODO(fluxkit): legal review of the texts, the retention periods and the processor list before an EU launch (privacy plan
 * tasks O1 to O8).
 */

import { THEME_COOKIE } from "../lib/theme-mode";
import legalIdentityFile from "./legal-identity.json";

/**
 * The marker every placeholder legal text (the `legal.<page>.intro` message of every page, in every language) starts with.
 * A page shows the "Template placeholder" box only while its own text carries it, and the release check refuses the build
 * while any `legal.*` message carries it.
 */
export const LEGAL_PLACEHOLDER_MARKER = "TODO(fluxkit): replace with the shop's own legal text";

/**
 * A legal text as the page shows it: without the marker (and the full stop and spaces right after it). The marker stays in the
 * messages for the release check and the "Template placeholder" box, but a shopper never reads it (repair batch 2: it was an
 * English developer note on the Ukrainian page).
 */
export function withoutLegalMarker(text: string): string {
  const index = text.indexOf(LEGAL_PLACEHOLDER_MARKER);
  if (index === -1) return text;
  const after = text.slice(index + LEGAL_PLACEHOLDER_MARKER.length).replace(/^\.?\s*/, "");
  return `${text.slice(0, index)}${after}`.trim();
}

export type LegalPageSlug = "privacy" | "terms" | "cookies";

export interface LegalPageConfig {
  slug: LegalPageSlug;
  /** Message key of the footer link and of the page title. */
  labelKey: string;
}

/**
 * The legal pages, in footer order. Each has a route folder `app/[locale]/(site)/legal/<slug>/` (a spec checks both ways).
 * Remove a page here and delete its folder to drop it; the footer follows.
 */
export const legalPages: readonly LegalPageConfig[] = [
  { slug: "privacy", labelKey: "legal.privacy.title" },
  { slug: "terms", labelKey: "legal.terms.title" },
  { slug: "cookies", labelKey: "legal.cookies.title" },
];

/** The page a notice or a link to the privacy notice points at, and the one for the terms. */
export const privacyPageSlug: LegalPageSlug = "privacy";
export const termsPageSlug: LegalPageSlug = "terms";

/**
 * The cookies a shopper can receive, for the cookie statement (one table, texts in `legal.cookies.row.<id>.*`). The cart and
 * session cookies are set by the API under `/store`, `HttpOnly` and first-party; a guard in the API
 * (`apps/api/src/privacy/inventory`) fails when it sets another cookie, and a spec here compares these names with the API's.
 * The theme cookie is the storefront's only one (`lib/theme-mode.ts`, design batch B): a preference set only when the shopper
 * picks a theme, holding one of three words; `source-guards.spec.ts` allows exactly two files to write it.
 * A client fork that adds a cookie adds a row here and its message keys.
 */
export interface CookieRow {
  id: "cart" | "session" | "theme";
  name: string;
}

export const cookieTable: readonly CookieRow[] = [
  { id: "cart", name: "fluxkit_cart" },
  { id: "session", name: "fluxkit_customer_session" },
  { id: "theme", name: THEME_COOKIE },
];

export interface LegalIdentity {
  /** The legal name of the business that runs the shop (the controller), or `null` while unset. */
  shopLegalName: string | null;
  /** Its postal address, or `null`. */
  shopLegalAddress: string | null;
  /** Where a person writes about their data (an email address), or `null`. */
  privacyContact: string | null;
  /** The day the texts were last changed (`YYYY-MM-DD`), or `null`. */
  lastUpdated: string | null;
}

/**
 * The values live in `legal-identity.json` (a fork edits THAT file) because the release check in `next.config.ts` runs in
 * plain Node and reads the same file; with `STOREFRONT_REQUIRE_LEGAL_TEXT=true` the build refuses a `null` or blank value.
 */
export const legalIdentity: LegalIdentity = legalIdentityFile;
