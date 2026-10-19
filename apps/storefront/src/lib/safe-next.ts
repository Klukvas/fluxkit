import type { Locale } from "@fluxkit/ui";

/**
 * The `next` parameter of the login page says where to go after signing in. It comes from the URL, so it is untrusted: a
 * value that leaves the storefront (`//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:...`, any encoded form of
 * those) would turn the login page into an open redirect, or worse, an XSS through `router.replace("javascript:...")`.
 * Only a path inside the CURRENT locale of this storefront passes; anything else falls back to the account page.
 */

const MAX_LENGTH = 1024;
const MAX_DECODE_ROUNDS = 3;
/** Pages the visitor must never be sent back to: a redirect loop. */
const AUTH_PAGES = ["/account/login", "/account/register"] as const;

function fallback(locale: Locale): string {
  return `/${locale}/account`;
}

/** True for a control character (a browser strips tabs and newlines from a URL, which can hide a second slash) or a space. */
function hasControlOrSpace(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) as number;
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** The text after zero to three rounds of percent-decoding; `null` when any round is malformed. */
function decodedForms(text: string): string[] | null {
  const forms = [text];
  let current = text;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (next === current) return forms;
    forms.push(next);
    current = next;
  }
  return forms;
}

function isDangerous(form: string): boolean {
  return (
    form.includes("\\") ||
    form.includes("//") ||
    form.includes("#") ||
    hasControlOrSpace(form) ||
    form.split(/[/?]/).some((segment) => segment === "..")
  );
}

/**
 * Whether `parsed` (the candidate, resolved by the URL parser) is the login or register page. The parser resolves dot
 * segments, so `/uk/account/./login` is the login page; the segments may also be percent-encoded (`%6Cogin`), and Next serves
 * a trailing slash as the same page, so the pathname is decoded and its trailing slashes dropped before it is compared.
 */
function isAuthPage(parsed: URL, locale: Locale): boolean {
  const pathnames = decodedForms(parsed.pathname) ?? [parsed.pathname];
  return pathnames.some((pathname) =>
    AUTH_PAGES.some((page) => pathname.replace(/\/+$/, "") === `/${locale}${page}`),
  );
}

/**
 * The path to go to after sign-in: `value` when it is a safe path of `locale`'s storefront, else the account page.
 * Accepts only `/{locale}/...` (no scheme, no host, no backslash, no `//`, no dot segments, no fragment, no control
 * character, in the text or in any percent-decoded form of it) and never the login or register page itself.
 */
export function safeNextPath(value: string | string[] | null | undefined, locale: Locale): string {
  if (typeof value !== "string" || value === "" || value.length > MAX_LENGTH) {
    return fallback(locale);
  }
  if (!value.startsWith(`/${locale}/`)) return fallback(locale);
  const forms = decodedForms(value);
  if (forms === null || forms.some(isDangerous)) return fallback(locale);
  // The string rules above leave no way for the URL parser to change the origin or leave `/{locale}/` (a leading `/{locale}/`,
  // no `//`, `\`, control character, dot segment or fragment in any decoded form); `safe-next.spec.ts` proves it on generated
  // values, parsing every answer. The parser is used here to resolve `.` segments for the auth page check.
  let parsed: URL;
  try {
    parsed = new URL(value, "http://storefront.invalid");
  } catch {
    return fallback(locale);
  }
  if (isAuthPage(parsed, locale)) return fallback(locale);
  return value;
}

/**
 * The login or register page of `locale`, carrying `next` only when it is a safe path (so a link never carries something
 * `safeNextPath` would refuse). `value` may be the visitor's current path or the `next` the page itself received.
 */
export function authHref(
  locale: Locale,
  page: "login" | "register",
  value: string | null | undefined,
): string {
  const base = `/${locale}/account/${page}`;
  if (value === null || value === undefined) return base;
  return safeNextPath(value, locale) === value ? `${base}?next=${encodeURIComponent(value)}` : base;
}

/** The path and query string of the page the visitor is on (`location.pathname + location.search`), as one `next` candidate. */
export function currentPath(pathname: string, search: string): string {
  return search === "" || search === "?" ? pathname : `${pathname}${search}`;
}

/** Where a protected page sends a visitor without a session: the login page, coming back to `currentPath` afterwards. */
export function loginHref(locale: Locale, currentPath: string): string {
  return authHref(locale, "login", currentPath);
}
