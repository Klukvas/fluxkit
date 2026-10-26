/*
 * Email variables of the API (ADR 0031 decision 12): `EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_REPLY_TO`. This package does not
 * depend on `@fluxkit/core`, so the mailbox rules of core `parseMailbox` (`packages/core/src/email/address.ts`) are repeated
 * here and a spec in `apps/api` (`email-mailbox-parity.spec.ts`) runs both on the same corpus and asserts they agree.
 * No message of this file contains a value, only the variable name and a reason code.
 */

/** The values `EMAIL_PROVIDER` accepts. `none` (the default) loads no provider. */
export const EMAIL_PROVIDER_CHOICES = Object.freeze(["none", "resend", "fake"] as const);

export type EmailProviderChoice = (typeof EMAIL_PROVIDER_CHOICES)[number];

/** Default of `EMAIL_PROVIDER`: no mail leaves the system (ADR 0031 decision 11). */
export const DEFAULT_EMAIL_PROVIDER: EmailProviderChoice = "none";

/**
 * Provider choices that exist for tests only (`packages/providers/_fake-email`: it keeps mail in memory and delivers
 * nothing). `loadEnv` refuses them when `NODE_ENV` is production, so a shop can never "send" its password-reset mail to a
 * test mailbox.
 */
export const TEST_ONLY_EMAIL_PROVIDERS: readonly string[] = Object.freeze(["fake"]);

/** One mailbox as `EMAIL_FROM` and `EMAIL_REPLY_TO` read: the normalized address and an optional display name. */
export interface EmailMailbox {
  readonly address: string;
  readonly displayName: string | null;
}

/** Longest `EMAIL_FROM` / `EMAIL_REPLY_TO` in code points (core `EMAIL_LIMITS.mailboxMaxLength`). */
const MAILBOX_MAX_LENGTH = 200;
const DISPLAY_NAME_MAX_LENGTH = 100;
const ADDRESS_MAX_LENGTH = 254;
const LOCAL_PART_MAX_LENGTH = 64;
const DOMAIN_LABEL_MAX_LENGTH = 63;

const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const NON_ASCII = /[^ -~]/;
const NAME_FORBIDDEN = /["<>\\]/;

function isUnsafeAt(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) {
    return true;
  }
  if (
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  ) {
    return true;
  }
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = value.charCodeAt(index + 1);
    return !(next >= 0xdc00 && next <= 0xdfff);
  }
  if (code >= 0xdc00 && code <= 0xdfff) {
    const previous = index > 0 ? value.charCodeAt(index - 1) : 0;
    return !(previous >= 0xd800 && previous <= 0xdbff);
  }
  return false;
}

/** A control, line separator, bidi control or lone surrogate: nothing that may end or reorder a header line. */
function hasHeaderUnsafeCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (isUnsafeAt(value, index)) {
      return true;
    }
  }
  return false;
}

function codePointLength(value: string): number {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    const next = value.charCodeAt(index + 1);
    index += code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? 2 : 1;
    count += 1;
  }
  return count;
}

function validateAddress(input: string): string | undefined {
  const trimmed = input.replace(/^ +| +$/g, "");
  if (
    trimmed.length === 0 ||
    trimmed.length > ADDRESS_MAX_LENGTH ||
    hasHeaderUnsafeCharacter(input) ||
    NON_ASCII.test(trimmed)
  ) {
    return undefined;
  }
  const address = trimmed.toLowerCase();
  const at = address.indexOf("@");
  if (at < 0 || at !== address.lastIndexOf("@")) {
    return undefined;
  }
  const local = address.slice(0, at);
  const labels = address.slice(at + 1).split(".");
  const topLevel = labels[labels.length - 1] ?? "";
  if (
    local.length === 0 ||
    local.length > LOCAL_PART_MAX_LENGTH ||
    !LOCAL_PART.test(local) ||
    labels.length < 2 ||
    labels.some((label) => label.length > DOMAIN_LABEL_MAX_LENGTH || !DOMAIN_LABEL.test(label)) ||
    /^[0-9]+$/.test(topLevel)
  ) {
    return undefined;
  }
  return address;
}

function validateDisplayName(input: string): string | undefined {
  if (hasHeaderUnsafeCharacter(input) || NAME_FORBIDDEN.test(input)) {
    return undefined;
  }
  if (input.length > DISPLAY_NAME_MAX_LENGTH * 8) {
    return undefined;
  }
  const name = input.normalize("NFC").trim();
  if (name.length === 0 || codePointLength(name) > DISPLAY_NAME_MAX_LENGTH) {
    return undefined;
  }
  return name;
}

/**
 * Reads one mailbox: a bare address, or `Display Name <address>` with the name optionally in double quotes. The same
 * rules as core `parseMailbox` (at most 200 code points, no header-unsafe character, exactly one `<` and one `>` with the
 * `>` last, an ASCII dot-atom address, a display name without `" < > \`). Answers `undefined` for anything else; the
 * caller names the variable, never the value.
 */
export function parseMailboxVariable(input: string): EmailMailbox | undefined {
  if (codePointLength(input) > MAILBOX_MAX_LENGTH || hasHeaderUnsafeCharacter(input)) {
    return undefined;
  }
  const value = input.trim();
  if (value.length === 0) {
    return undefined;
  }
  const open = value.indexOf("<");
  const close = value.indexOf(">");
  if (open < 0 && close < 0) {
    const bare = validateAddress(value);
    return bare === undefined ? undefined : { address: bare, displayName: null };
  }
  if (
    open < 0 ||
    open !== value.lastIndexOf("<") ||
    close !== value.lastIndexOf(">") ||
    close !== value.length - 1 ||
    close < open
  ) {
    return undefined;
  }
  const address = validateAddress(value.slice(open + 1, close));
  if (address === undefined) {
    return undefined;
  }
  let name = value.slice(0, open).trim();
  if (name.length === 0) {
    return { address, displayName: null };
  }
  if (name.startsWith('"') || name.endsWith('"')) {
    if (name.length < 2 || !name.startsWith('"') || !name.endsWith('"')) {
      return undefined;
    }
    name = name.slice(1, -1);
  }
  const displayName = validateDisplayName(name);
  return displayName === undefined ? undefined : { address, displayName };
}
