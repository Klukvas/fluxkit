/**
 * The API's rule for the free texts of the order actions (a payment reference, a cancellation reason): trimmed, 1 to
 * `max` characters (UTF-16 code units, as the API counts), no control characters other than tab, line feed and carriage
 * return (`apps/api/src/orders/admin/admin-orders.schemas.ts`, copied: apps may not import each other). The form checks it
 * before sending; the API stays the authority.
 */

export type TextIssue = "required" | "too_long" | "invalid_characters";

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const allowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    if (!allowedWhitespace && (code <= 0x1f || (code >= 0x7f && code <= 0x9f))) return true;
  }
  return false;
}

export function checkActionText(
  text: string,
  max: number,
): { ok: true; value: string } | { ok: false; issue: TextIssue } {
  const value = text.trim();
  if (value === "") return { ok: false, issue: "required" };
  if (value.length > max) return { ok: false, issue: "too_long" };
  if (hasControlCharacter(value)) return { ok: false, issue: "invalid_characters" };
  return { ok: true, value };
}
