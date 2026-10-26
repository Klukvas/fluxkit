/**
 * What the admin sees of a message's frozen `variables` (ADR 0031 decision 8). The outbox keeps minimal data only, but
 * two kinds of value still stay out of the admin API:
 *  - every value of an account mail (`customer.*`): its only member is the id of the token row, the input of the token's
 *    derivation, which no screen needs;
 *  - the value of any key that names a secret or a link, in any template (a feature's template may add one): a name that contains
 *    `token`, `secret`, `passw`, `apikey`, `link`, `url`, `credential` or `authorization`.
 * Keys stay visible so an operator sees the shape; texts are cut so a hostile or huge value cannot flood the answer.
 */

export const REDACTED = "[redacted]";

/** Longest text shown, in UTF-16 units (order mail texts are cut to 100 code points when they are enqueued). */
export const VARIABLE_TEXT_LIMIT = 200;

const SECRET_KEY = /token|secret|passw|api_?key|link|url|credential|authorization/i;

/** Templates whose variables are never shown. */
function hidesAllValues(templateKey: string): boolean {
  return templateKey.startsWith("customer.");
}

function redact(value: unknown, key: string | undefined, hideAll: boolean, depth: number): unknown {
  if (hideAll || (key !== undefined && SECRET_KEY.test(key))) {
    return REDACTED;
  }
  if (typeof value === "string") {
    return value.length > VARIABLE_TEXT_LIMIT ? `${value.slice(0, VARIABLE_TEXT_LIMIT)}…` : value;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (depth >= 6) {
    return REDACTED;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, undefined, false, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, entry]) => [name, redact(entry, name, false, depth + 1)]),
  );
}

export function redactEmailVariables(
  templateKey: string,
  variables: unknown,
): Record<string, unknown> {
  if (typeof variables !== "object" || variables === null || Array.isArray(variables)) {
    return {};
  }
  const hideAll = hidesAllValues(templateKey);
  return Object.fromEntries(
    Object.entries(variables).map(([name, entry]) => [name, redact(entry, name, hideAll, 1)]),
  );
}
