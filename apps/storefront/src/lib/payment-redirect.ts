/**
 * Where the browser may be sent to pay (ADR 0032 decision 6, "Storefront": the CSP has `form-action 'self'`, so the shopper
 * reaches the provider by a navigation (the location's `assign`), never a form POST).
 *
 * The address comes from the API's answer only (`redirectUrl` of the create route, or of the order's latest attempt), never
 * from a query string, a fragment or storage, and is checked here before the browser leaves: an absolute `https` URL with a
 * host and no credentials, short, without whitespace or control characters. Anything else (http, `javascript:`, `data:`, a
 * relative or protocol-relative address, a backslash trick) is refused and the page shows its "technical problem" message.
 * This is the ONE module of the storefront that may assign the browser location (a source guard checks it).
 */

const MAX_URL_LENGTH = 2048;
const HTTPS_PREFIX = /^https:\/\/[^\s\\/]/i;

/**
 * True when the text holds whitespace or a C0/C1 control character. A tab or newline is silently dropped by the URL parser,
 * which would let a different address through than the one that was read.
 */
function hasBlankOrControl(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || /\s/.test(char)) return true;
  }
  return false;
}

/** The normalized URL when `raw` is a safe provider page, else `null`. */
export function providerRedirectUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LENGTH) return null;
  if (hasBlankOrControl(raw) || !HTTPS_PREFIX.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Not a URL at all: refused like any other unsafe value, the caller shows the technical-problem message.
    return null;
  }
  if (url.protocol !== "https:" || url.hostname === "") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url.href;
}

/** The slice of `window` the navigation uses, so a test can pass a fake. */
export interface NavigationWindow {
  location: { assign(url: string): void };
}

/** Navigates to the provider's page when `raw` is safe; returns whether it did. Nothing else ever assigns the location. */
export function goToProvider(win: NavigationWindow, raw: unknown): boolean {
  const url = providerRedirectUrl(raw);
  if (url === null) return false;
  win.location.assign(url);
  return true;
}
