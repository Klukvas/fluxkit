/** The API's limit for media and logo URLs (`docs/api/catalog.md`). */
const MAX_LENGTH = 2048;

/**
 * A URL from data (product media, a brand logo) as a string that is safe to put into `href` or `src`, or `null`. Only an
 * absolute `http:` or `https:` URL with a host and without credentials passes: no `javascript:`, `data:`, `blob:`,
 * protocol-relative or relative value, no surrounding blanks or control characters. The API validates these URLs too; the
 * UI does not rely on that (plan, "Security (admin side)"). The answer is the parser's normalized form.
 */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value === "" || value.length > MAX_LENGTH) return null;
  if (value !== value.trim()) return null;
  for (const character of value) {
    const code = character.codePointAt(0) as number;
    if (code < 0x20 || code === 0x7f) return null;
  }
  if (!/^https?:\/\//i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "" || url.username !== "" || url.password !== "") return null;
  return url.href;
}
