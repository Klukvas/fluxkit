import { EMAIL_MAX_LENGTH } from "../auth/email.js";
import { hasHeaderUnsafeCharacter } from "./header.js";
import { EMAIL_LIMITS } from "./limits.js";
import { codePointLengthUpTo } from "./text.js";

/*
 * Mail addresses and display names (ADR 0031 decisions 12 and 16). Stricter than `validateEmail` (the account rule):
 * every value here may end up in a mail header, so the check refuses rather than repairs, and accepts only the RFC 5322
 * dot-atom subset in ASCII. Non-ASCII addresses (SMTPUTF8) are refused because the provider's and the receivers' support
 * for them is not known; an internationalized domain is accepted in its ASCII (punycode) form.
 */

/** One mailbox: the normalized address and an optional display name (the shop name for `EMAIL_FROM`). */
export interface EmailAddress {
  readonly address: string;
  readonly displayName: string | null;
}

export type EmailAddressValidation =
  | { readonly ok: true; readonly address: string }
  | {
      readonly ok: false;
      readonly reason:
        | "not_a_string"
        | "empty"
        | "too_long"
        | "forbidden_character"
        | "non_ascii"
        | "invalid_format";
    };

/** RFC 5322 `atext` (letters, digits and ``!#$%&'*+-/=?^_`{|}~``) in dot-separated atoms: no quoted local part. */
const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
/** A DNS label: letters, digits, inner hyphens. */
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
/** Anything outside printable ASCII (controls are refused earlier, so this finds non-ASCII characters). */
const NON_ASCII = /[^ -~]/;

/** Trims the ASCII space only: any other white space is refused, never silently removed from a header value. */
function trimSpaces(value: string): string {
  return value.replace(/^ +| +$/g, "");
}

/**
 * The address check of every recipient and sender: no control or other header-unsafe character anywhere (checked before
 * trimming), ASCII only, one `@`, a dot-atom local part of at most 64 characters, a domain of at least two DNS labels of
 * at most 63 characters whose last label is not numeric, at most `EMAIL_MAX_LENGTH` in total. Answers the normalized form
 * (`normalizeEmail`: trimmed, lower case), the form the API stores and compares.
 */
export function validateEmailAddress(input: unknown): EmailAddressValidation {
  if (typeof input !== "string") {
    return { ok: false, reason: "not_a_string" };
  }
  const trimmed = trimSpaces(input);
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (trimmed.length > EMAIL_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }
  if (hasHeaderUnsafeCharacter(input)) {
    return { ok: false, reason: "forbidden_character" };
  }
  if (NON_ASCII.test(trimmed)) {
    return { ok: false, reason: "non_ascii" };
  }
  const address = trimmed.toLowerCase();
  const at = address.indexOf("@");
  if (at < 0 || at !== address.lastIndexOf("@")) {
    return { ok: false, reason: "invalid_format" };
  }
  const local = address.slice(0, at);
  const labels = address.slice(at + 1).split(".");
  const topLevel = labels[labels.length - 1] ?? "";
  if (
    local.length === 0 ||
    local.length > EMAIL_LIMITS.localPartMaxLength ||
    !LOCAL_PART.test(local) ||
    labels.length < 2 ||
    labels.some(
      (label) => label.length > EMAIL_LIMITS.domainLabelMaxLength || !DOMAIN_LABEL.test(label),
    ) ||
    /^[0-9]+$/.test(topLevel)
  ) {
    return { ok: false, reason: "invalid_format" };
  }
  return { ok: true, address };
}

export type DisplayNameValidation =
  | { readonly ok: true; readonly displayName: string }
  | {
      readonly ok: false;
      readonly reason: "not_a_string" | "empty" | "too_long" | "forbidden_character";
    };

/** Characters with a meaning in a mailbox (`<`, `>`) or in the quoted string we write it in (`"`, `\`). */
const NAME_FORBIDDEN = /["<>\\]/;

/**
 * A display name in any script: NFC-normalized and trimmed, not blank, at most `EMAIL_LIMITS.displayNameMaxLength` code
 * points after normalization, no header-unsafe character and none of `" < > \`. Answers the normalized name.
 */
export function validateDisplayName(input: unknown): DisplayNameValidation {
  if (typeof input !== "string") {
    return { ok: false, reason: "not_a_string" };
  }
  if (hasHeaderUnsafeCharacter(input) || NAME_FORBIDDEN.test(input)) {
    return { ok: false, reason: "forbidden_character" };
  }
  // Bounded before normalizing: NFC never shortens a string below a third of its UTF-16 length.
  if (input.length > EMAIL_LIMITS.displayNameMaxLength * 8) {
    return { ok: false, reason: "too_long" };
  }
  const displayName = input.normalize("NFC").trim();
  if (displayName.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (
    codePointLengthUpTo(displayName, EMAIL_LIMITS.displayNameMaxLength) >
    EMAIL_LIMITS.displayNameMaxLength
  ) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, displayName };
}

export type MailboxParse =
  | { readonly ok: true; readonly mailbox: EmailAddress }
  | {
      readonly ok: false;
      readonly reason:
        | "not_a_string"
        | "empty"
        | "too_long"
        | "forbidden_character"
        | "invalid_format"
        | "invalid_address"
        | "invalid_display_name";
    };

/**
 * Reads `EMAIL_FROM` / `EMAIL_REPLY_TO` (ADR 0031 decision 12): a bare address, or `Display Name <address>` with the name
 * optionally in double quotes (no quotes or backslashes inside). At most `EMAIL_LIMITS.mailboxMaxLength` code points, no
 * header-unsafe character anywhere, exactly one `<` and one `>` with the `>` last. One mailbox only.
 */
export function parseMailbox(input: unknown): MailboxParse {
  if (typeof input !== "string") {
    return { ok: false, reason: "not_a_string" };
  }
  if (codePointLengthUpTo(input, EMAIL_LIMITS.mailboxMaxLength) > EMAIL_LIMITS.mailboxMaxLength) {
    return { ok: false, reason: "too_long" };
  }
  if (hasHeaderUnsafeCharacter(input)) {
    return { ok: false, reason: "forbidden_character" };
  }
  const value = input.trim();
  if (value.length === 0) {
    return { ok: false, reason: "empty" };
  }
  const open = value.indexOf("<");
  const close = value.indexOf(">");
  if (open < 0 && close < 0) {
    const bare = validateEmailAddress(value);
    return bare.ok
      ? { ok: true, mailbox: Object.freeze({ address: bare.address, displayName: null }) }
      : { ok: false, reason: "invalid_address" };
  }
  if (
    open < 0 ||
    open !== value.lastIndexOf("<") ||
    close !== value.lastIndexOf(">") ||
    close !== value.length - 1 ||
    close < open
  ) {
    return { ok: false, reason: "invalid_format" };
  }
  const address = validateEmailAddress(value.slice(open + 1, close));
  if (!address.ok) {
    return { ok: false, reason: "invalid_address" };
  }
  let name = value.slice(0, open).trim();
  if (name.length === 0) {
    return { ok: true, mailbox: Object.freeze({ address: address.address, displayName: null }) };
  }
  if (name.startsWith('"') || name.endsWith('"')) {
    if (name.length < 2 || !name.startsWith('"') || !name.endsWith('"')) {
      return { ok: false, reason: "invalid_display_name" };
    }
    name = name.slice(1, -1);
  }
  const displayName = validateDisplayName(name);
  if (!displayName.ok) {
    return { ok: false, reason: "invalid_display_name" };
  }
  return {
    ok: true,
    mailbox: Object.freeze({ address: address.address, displayName: displayName.displayName }),
  };
}

/**
 * The mailbox as a provider writes it (`from`, `reply_to`): the bare address, or `"Display Name" <address>`. The parts
 * must already be in the form the checks above answer; anything else is a bug and throws (RangeError) instead of
 * producing a header.
 */
export function formatMailbox(mailbox: EmailAddress): string {
  const address = validateEmailAddress(mailbox.address);
  if (!address.ok || address.address !== mailbox.address) {
    throw new RangeError("formatMailbox needs a validated, normalized address");
  }
  if (mailbox.displayName === null) {
    return mailbox.address;
  }
  const name = validateDisplayName(mailbox.displayName);
  if (!name.ok || name.displayName !== mailbox.displayName) {
    throw new RangeError("formatMailbox needs a validated, normalized display name");
  }
  return `"${mailbox.displayName}" <${mailbox.address}>`;
}
