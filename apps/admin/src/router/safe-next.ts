import { PATHS } from "./paths";

/**
 * The `next` parameter of the sign-in page says where to go after signing in. It comes from the URL, so it is untrusted:
 * a value that leaves the SPA (`//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:...`, any encoded form of those)
 * would make the sign-in page an open redirect. Only a path of this SPA (relative to the base path) passes; anything else
 * falls back to the start page. Rules copied from the storefront's `lib/safe-next.ts` (apps may not import each other).
 */

const FALLBACK = PATHS.home;
const MAX_LENGTH = 1024;
const MAX_DECODE_ROUNDS = 3;

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
  const path = form.split("?")[0] as string;
  return (
    !form.startsWith("/") ||
    form.includes("\\") ||
    form.includes("//") ||
    form.includes("#") ||
    hasControlOrSpace(form) ||
    path.split("/").some((segment) => segment === ".." || segment === ".") ||
    // No SPA route starts with /admin: the API prefix, and the SPA's own base path (it would be doubled).
    /^\/admin/i.test(path) ||
    path.replace(/\/+$/, "").toLowerCase() === PATHS.login
  );
}

/**
 * The path to go to after sign-in: `value` when it is a safe path of this SPA, else the start page. Accepts only `/...`
 * (no scheme, no host, no backslash, no `//`, no dot segment, no fragment, no control character, nothing starting with
 * `/admin`, never the sign-in page), checked in the text and in every percent-decoded form of it.
 */
export function safeNextPath(value: string | string[] | null | undefined): string {
  if (typeof value !== "string" || value === "" || value.length > MAX_LENGTH) return FALLBACK;
  const forms = decodedForms(value);
  if (forms === null || forms.some(isDangerous)) return FALLBACK;
  return value;
}

/** The path and query string of the current page (`location.pathname + location.search`, relative to the base path). */
export function currentRelativePath(pathname: string, search: string): string {
  return search === "" || search === "?" ? pathname : `${pathname}${search}`;
}

/** The sign-in page, carrying `next` only when it is a safe path other than the start page. */
export function loginPath(next: string | null | undefined): string {
  if (next === null || next === undefined) return PATHS.login;
  const safe = safeNextPath(next);
  return safe === next && safe !== FALLBACK
    ? `${PATHS.login}?next=${encodeURIComponent(safe)}`
    : PATHS.login;
}
