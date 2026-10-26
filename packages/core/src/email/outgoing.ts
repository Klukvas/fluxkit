import {
  formatMailbox,
  validateDisplayName,
  validateEmailAddress,
  type EmailAddress,
} from "./address.js";
import { validateSubject } from "./header.js";
import { EMAIL_LIMITS, EMAIL_TAG_VALUE_PATTERN } from "./limits.js";
import type { OutgoingEmail } from "./provider-port.js";

/*
 * The last check before a mail is handed to a provider (ADR 0031 decision 16): the API runs it after rendering, and a
 * provider may run it again and answer `not_sent` for a message that fails it (nothing left the process).
 */

export interface OutgoingEmailIssue {
  /** `from`, `replyTo`, `to`, `subject`, `html`, `text`, `tags.category` or `idempotencyKey`. */
  readonly path: string;
  /** A short code: the reason of the failing check, or `not_normalized`, `empty`, `not_a_string`, `invalid`. */
  readonly code: string;
}

function mailboxIssues(path: string, value: unknown): OutgoingEmailIssue[] {
  const mailbox = value as Partial<EmailAddress> | null;
  if (typeof mailbox !== "object" || mailbox === null) {
    return [{ path, code: "invalid" }];
  }
  const address = validateEmailAddress(mailbox.address);
  if (!address.ok) {
    return [{ path, code: address.reason }];
  }
  if (address.address !== mailbox.address) {
    return [{ path, code: "not_normalized" }];
  }
  if (mailbox.displayName !== null) {
    const name = validateDisplayName(mailbox.displayName);
    if (!name.ok) {
      return [{ path, code: name.reason }];
    }
    if (name.displayName !== mailbox.displayName) {
      return [{ path, code: "not_normalized" }];
    }
  }
  // Throws only for what the checks above let through, which would be a bug in them.
  formatMailbox(mailbox as EmailAddress);
  return [];
}

function bodyIssues(path: string, value: unknown): OutgoingEmailIssue[] {
  if (typeof value !== "string") {
    return [{ path, code: "not_a_string" }];
  }
  return value.trim().length === 0 ? [{ path, code: "empty" }] : [];
}

/**
 * Every problem of `message` and its idempotency key, empty when it may be sent: normalized, header-safe mailboxes
 * (one recipient), a header-safe subject (`sanitizeSubject` output), non-blank HTML and text parts, a tag by Resend's
 * rule and a key of 1 to `EMAIL_LIMITS.idempotencyKeyMaxLength` visible ASCII characters.
 */
export function validateOutgoingEmail(
  message: OutgoingEmail,
  idempotencyKey: string,
): OutgoingEmailIssue[] {
  const issues: OutgoingEmailIssue[] = [
    ...mailboxIssues("from", message.from),
    ...(message.replyTo === undefined ? [] : mailboxIssues("replyTo", message.replyTo)),
    ...mailboxIssues("to", message.to),
  ];
  const subject = validateSubject(message.subject);
  if (!subject.ok) {
    issues.push({ path: "subject", code: subject.reason });
  }
  issues.push(...bodyIssues("html", message.html), ...bodyIssues("text", message.text));
  const category: unknown = (message.tags as { category?: unknown } | undefined)?.category;
  if (typeof category !== "string" || !EMAIL_TAG_VALUE_PATTERN.test(category)) {
    issues.push({ path: "tags.category", code: "invalid" });
  }
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.length === 0 ||
    idempotencyKey.length > EMAIL_LIMITS.idempotencyKeyMaxLength ||
    !/^[!-~]+$/.test(idempotencyKey)
  ) {
    issues.push({ path: "idempotencyKey", code: "invalid" });
  }
  return issues;
}
