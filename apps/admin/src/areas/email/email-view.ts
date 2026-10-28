import type { AdminEmailMessageStatus, AdminEmailTemplateCategory } from "@fluxkit/api-client";
import { locales, type StatusTone } from "@fluxkit/ui";
import { buildPath, PATHS } from "../../router/paths";

/**
 * Pure helpers of the Email area's screens: status tones and labels, the translated explanation of a stored error code,
 * the age of the oldest waiting mail and the links between screens. Message keys live in the area's file (`email`).
 */

/** In the order the status page lists them (the order of a mail's life). */
export const MESSAGE_STATUSES: readonly AdminEmailMessageStatus[] = [
  "pending",
  "sending",
  "sent",
  "failed",
  "unknown",
  "cancelled",
];

/**
 * Tone of a status badge. The text always carries the meaning; the tone is a hint (design tokens through the Badge).
 * `unknown` is a warning, not a failure: the provider may or may not have sent the mail.
 */
export const MESSAGE_STATUS_TONES: Record<AdminEmailMessageStatus, StatusTone> = {
  pending: "warning",
  sending: "neutral",
  sent: "success",
  failed: "danger",
  unknown: "warning",
  cancelled: "neutral",
};

export function statusLabelKey(status: AdminEmailMessageStatus): string {
  return `mail.status.${status}`;
}

export function categoryLabelKey(category: AdminEmailTemplateCategory): string {
  return `mail.category.${category}`;
}

/**
 * The reasons a mail's `lastErrorCode` can start with: the provider failure reasons of the email port, and the codes the
 * sender writes itself (`docs/api/jobs.md`, ADR 0031 decisions 6 and 7).
 */
export const ERROR_CODE_REASONS = [
  "unavailable",
  "rate_limited",
  "rejected",
  "misconfigured",
  "quota_exceeded",
  "idempotency_conflict",
  "not_sent",
  "deadline_passed",
  "template_unavailable",
  "variables_invalid",
  "render_failed",
  "message_invalid",
] as const;

export interface ErrorCodeView {
  /** Message key of the explanation. */
  key: string;
  /** The stored code, shown in small print next to it (admins quote it to support); it is never provider text. */
  code: string;
}

/**
 * A stored error code in words. A code is the reason, or `reason:providerCode` (`rejected:validation_error`); the
 * explanation follows the reason, the whole code stays visible. A reason this version does not know gets a neutral text.
 */
export function describeErrorCode(code: string): ErrorCodeView {
  const reason = code.split(":", 1)[0] ?? code;
  return (ERROR_CODE_REASONS as readonly string[]).includes(reason)
    ? { key: `mail.code.${reason}`, code }
    : { key: "mail.code.unrecognized", code };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long ago `from` was, as locale text ("5 minutes ago"), with `Intl.RelativeTimeFormat`. `now` is a parameter so the
 * result is testable; a time in the future (clock skew between the API and the browser) reads as "now".
 */
export function ageText(from: string, now: Date, locale: string): string {
  const elapsed = Math.max(0, now.getTime() - new Date(from).getTime());
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (elapsed >= DAY_MS) return formatter.format(-Math.floor(elapsed / DAY_MS), "day");
  if (elapsed >= HOUR_MS) return formatter.format(-Math.floor(elapsed / HOUR_MS), "hour");
  return formatter.format(-Math.floor(elapsed / MINUTE_MS), "minute");
}

export function messageHref(id: string): string {
  return buildPath(PATHS.emailMessageDetail, { id });
}

export function templateHref(key: string, locale?: string): string {
  const base = buildPath(PATHS.emailTemplatePreview, { key });
  return locale === undefined ? base : `${base}?locale=${encodeURIComponent(locale)}`;
}

/** The mailbox as `Name <address>` or the bare address. */
export function mailboxText(mailbox: { address: string; displayName: string | null }): string {
  return mailbox.displayName === null || mailbox.displayName === ""
    ? mailbox.address
    : `${mailbox.displayName} <${mailbox.address}>`;
}

/** The preview language: `?locale` when it is one of the shop's languages, else the admin's interface language, else the first. */
export function previewLocale(requested: string | null, uiLocale: string): string {
  const known = locales as readonly string[];
  if (requested !== null && known.includes(requested)) return requested;
  return known.includes(uiLocale) ? uiLocale : (locales[0] ?? "en");
}
