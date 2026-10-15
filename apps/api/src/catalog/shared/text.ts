import { hasJsonbUnsafeCharacters } from "@fluxkit/core";

/**
 * Zod refinement for free-text columns: Postgres refuses NUL (HTTP 500) and the driver silently turns unpaired
 * UTF-16 surrogates into U+FFFD. Both are client errors, so reject them with a field error (HTTP 400).
 */
export const isDatabaseSafeText = (text: string): boolean => !hasJsonbUnsafeCharacters(text);

export const UNSAFE_TEXT_MESSAGE = "Must not contain NUL characters or unpaired surrogates.";

/** An empty text map carries no information: store it as "no value". */
export function emptyToNull(
  text: Record<string, string> | null | undefined,
): Record<string, string> | null {
  return text === undefined || text === null || Object.keys(text).length === 0 ? null : text;
}
