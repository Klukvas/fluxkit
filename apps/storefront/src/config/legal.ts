/**
 * The shop's legal pages and who is responsible for them (privacy plan step 10, ADR 0033 decision 11; AGENTS.md sections 2.2
 * and 15). Internal to the storefront in v1: a client fork edits THIS file and the `legal.*` messages, nowhere else.
 *
 * Master ships placeholders only: the texts are i18n messages that say the shop must supply its own, and the identity below is
 * empty. A page shows a visible placeholder for every identity value that is still `null`. Nothing here is legal advice.
 * TODO(fluxkit): legal review of the texts, the retention periods and the processor list before an EU launch (privacy plan
 * tasks O1 to O8).
 */

/** The marker every placeholder text carries; `lib/legal-marker.ts` finds it, a release check refuses it. */
export const LEGAL_PLACEHOLDER_MARKER = "TODO(fluxkit): replace with the shop's own legal text";

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
 * The cookies a shopper can receive, for the cookie statement (one table, texts in `legal.cookies.row.<id>.*`). They are set
 * by the API, not by the storefront (which sets none), under `/store`, `HttpOnly` and first-party. A guard in the API
 * (`apps/api/src/privacy/inventory`) fails when it sets another cookie; a spec here compares these names with the API's.
 * A client fork that adds a cookie adds a row here and its message keys.
 */
export interface CookieRow {
  id: "cart" | "session";
  name: string;
}

export const cookieTable: readonly CookieRow[] = [
  { id: "cart", name: "fluxkit_cart" },
  { id: "session", name: "fluxkit_customer_session" },
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

export const legalIdentity: LegalIdentity = {
  shopLegalName: null,
  shopLegalAddress: null,
  privacyContact: null,
  lastUpdated: null,
};
