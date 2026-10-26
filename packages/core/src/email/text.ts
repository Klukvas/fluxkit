/* Internal text helpers of the email rules (not re-exported from the barrel). */

/**
 * Length in code points, so an emoji counts once (a lone surrogate counts as one). Stops counting past `limit`, so a
 * huge string costs little.
 */
export function codePointLengthUpTo(value: string, limit: number): number {
  let count = 0;
  let index = 0;
  while (index < value.length && count <= limit) {
    const code = value.charCodeAt(index);
    const next = value.charCodeAt(index + 1);
    const pair = code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
    index += pair ? 2 : 1;
    count += 1;
  }
  return count;
}
