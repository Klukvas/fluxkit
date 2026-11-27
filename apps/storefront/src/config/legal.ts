/**
 * The shop's legal pages and who is responsible for them (privacy plan step 10, ADR 0033 decision 11; AGENTS.md sections 2.2
 * and 15). Internal to the storefront in v1: a client fork edits THIS file and the `legal.*` messages, nowhere else.
 *
 * Master ships default texts requiring legal review (plan 2026-11-27-legal-texts.md), and the identity
 * (`legal-identity.json`) is empty. A page shows a visible placeholder for every identity value that is still `null`.
 * Nothing here is legal advice.
 * TODO(fluxkit): legal review of the texts, the retention periods and the processor list before an EU launch (privacy plan
 * tasks O1 to O8).
 */

import { THEME_COOKIE } from "../lib/theme-mode";
import type { TextSection } from "./shop-pages";
import legalIdentityFile from "./legal-identity.json";

/** Backstop for older fork texts: the release check refuses any marked legal message; the page hides the marker. */
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

/** Ordered default text sections; a fork can add, drop or reorder entries and their messages. */
export const legalSections: Record<LegalPageSlug, readonly TextSection[]> = {
  privacy: [
    {
      kind: "text",
      id: "controller",
      titleKey: "legal.privacy.section.controller.title",
      bodyKey: "legal.privacy.section.controller.body",
    },
    {
      kind: "text",
      id: "data",
      titleKey: "legal.privacy.section.data.title",
      bodyKey: "legal.privacy.section.data.body",
    },
    {
      kind: "text",
      id: "purposes",
      titleKey: "legal.privacy.section.purposes.title",
      bodyKey: "legal.privacy.section.purposes.body",
    },
    {
      kind: "text",
      id: "recipients",
      titleKey: "legal.privacy.section.recipients.title",
      bodyKey: "legal.privacy.section.recipients.body",
    },
    {
      kind: "text",
      id: "transfers",
      titleKey: "legal.privacy.section.transfers.title",
      bodyKey: "legal.privacy.section.transfers.body",
    },
    {
      kind: "text",
      id: "retention",
      titleKey: "legal.privacy.section.retention.title",
      bodyKey: "legal.privacy.section.retention.body",
    },
    {
      kind: "text",
      id: "security",
      titleKey: "legal.privacy.section.security.title",
      bodyKey: "legal.privacy.section.security.body",
    },
    {
      kind: "text",
      id: "children",
      titleKey: "legal.privacy.section.children.title",
      bodyKey: "legal.privacy.section.children.body",
    },
    {
      kind: "text",
      id: "changes",
      titleKey: "legal.privacy.section.changes.title",
      bodyKey: "legal.privacy.section.changes.body",
    },
  ],
  terms: [
    {
      kind: "text",
      id: "general",
      titleKey: "legal.terms.section.general.title",
      bodyKey: "legal.terms.section.general.body",
    },
    {
      kind: "text",
      id: "subject",
      titleKey: "legal.terms.section.subject.title",
      bodyKey: "legal.terms.section.subject.body",
    },
    {
      kind: "text",
      id: "ordering",
      titleKey: "legal.terms.section.ordering.title",
      bodyKey: "legal.terms.section.ordering.body",
    },
    {
      kind: "text",
      id: "prices",
      titleKey: "legal.terms.section.prices.title",
      bodyKey: "legal.terms.section.prices.body",
    },
    {
      kind: "text",
      id: "payment",
      titleKey: "legal.terms.section.payment.title",
      bodyKey: "legal.terms.section.payment.body",
    },
    {
      kind: "text",
      id: "delivery",
      titleKey: "legal.terms.section.delivery.title",
      bodyKey: "legal.terms.section.delivery.body",
    },
    {
      kind: "text",
      id: "returns",
      titleKey: "legal.terms.section.returns.title",
      bodyKey: "legal.terms.section.returns.body",
    },
    {
      kind: "text",
      id: "quality",
      titleKey: "legal.terms.section.quality.title",
      bodyKey: "legal.terms.section.quality.body",
    },
    {
      kind: "text",
      id: "liability",
      titleKey: "legal.terms.section.liability.title",
      bodyKey: "legal.terms.section.liability.body",
    },
    {
      kind: "text",
      id: "personalData",
      titleKey: "legal.terms.section.personalData.title",
      bodyKey: "legal.terms.section.personalData.body",
    },
    {
      kind: "text",
      id: "disputes",
      titleKey: "legal.terms.section.disputes.title",
      bodyKey: "legal.terms.section.disputes.body",
    },
    {
      kind: "text",
      id: "final",
      titleKey: "legal.terms.section.final.title",
      bodyKey: "legal.terms.section.final.body",
    },
  ],
  cookies: [
    {
      kind: "text",
      id: "storage",
      titleKey: "legal.cookies.section.storage.title",
      bodyKey: "legal.cookies.section.storage.body",
    },
    {
      kind: "text",
      id: "noTracking",
      titleKey: "legal.cookies.section.noTracking.title",
      bodyKey: "legal.cookies.section.noTracking.body",
    },
    {
      kind: "text",
      id: "manage",
      titleKey: "legal.cookies.section.manage.title",
      bodyKey: "legal.cookies.section.manage.body",
    },
    {
      kind: "text",
      id: "changes",
      titleKey: "legal.cookies.section.changes.title",
      bodyKey: "legal.cookies.section.changes.body",
    },
  ],
};

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
  /** The legal name, including its legal form (e.g. ФОП / ТОВ), of the seller (the controller), or `null` while unset. */
  shopLegalName: string | null;
  /** ЄДРПОУ or РНОКПП, or `null`. */
  shopTaxId: string | null;
  /** Seller email and phone may equal the public values in `config/contacts.ts`. */
  shopEmail: string | null;
  shopPhone: string | null;
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
