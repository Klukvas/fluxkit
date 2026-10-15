/** An empty text map carries no information: store it as "no value". */
export function emptyToNull(
  text: Record<string, string> | null | undefined,
): Record<string, string> | null {
  return text === undefined || text === null || Object.keys(text).length === 0 ? null : text;
}
