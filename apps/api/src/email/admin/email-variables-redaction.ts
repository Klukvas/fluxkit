/**
 * What the admin sees of a message's frozen `variables` (ADR 0031 decision 8, email review F3). Redaction is opt-in per
 * key: a template lists the top-level keys whose values may be shown (`EmailTemplate.displayVariables`), and every other
 * value is `[redacted]`, whatever its name (a feature's one-time code or magic link stays hidden even under a key such as
 * `code` or `href`). A template that lists nothing, or is not registered any more, shows no value. On top of that,
 * every value of an account mail (`customer.*`) stays hidden even if an override lists it: its only member is the id of
 * the token row, the input of the token's derivation, which no screen needs.
 * Keys stay visible so an operator sees the shape; texts are cut so a hostile or huge value cannot flood the answer.
 */

export const REDACTED = "[redacted]";

/** Longest text shown, in UTF-16 units (order mail texts are cut to 100 code points when they are enqueued). */
export const VARIABLE_TEXT_LIMIT = 200;

/** Templates whose variables are never shown. */
function hidesAllValues(templateKey: string): boolean {
  return templateKey.startsWith("customer.");
}

/** A value of a displayable key: texts cut, nesting bounded. */
function shown(value: unknown, depth: number): unknown {
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
    return value.map((entry) => shown(entry, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, entry]) => [name, shown(entry, depth + 1)]),
  );
}

/**
 * `displayVariables`: the template's allowlist (`undefined` when the template does not declare one or is not
 * registered any more).
 */
export function redactEmailVariables(
  templateKey: string,
  variables: unknown,
  displayVariables: readonly string[] | undefined,
): Record<string, unknown> {
  if (typeof variables !== "object" || variables === null || Array.isArray(variables)) {
    return {};
  }
  const displayable = new Set(hidesAllValues(templateKey) ? [] : (displayVariables ?? []));
  return Object.fromEntries(
    Object.entries(variables).map(([name, entry]) => [
      name,
      displayable.has(name) ? shown(entry, 1) : REDACTED,
    ]),
  );
}
