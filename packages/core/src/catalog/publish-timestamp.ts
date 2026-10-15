/**
 * `product.published_at` is the time of the first publish (ADR 0006 section 6): set once, then
 * never cleared or moved, even if the product returns to draft and is published again. `now` is a
 * parameter so the rule stays pure.
 */
export function nextPublishedAt(current: string | null, nowIso: string): string {
  if (current !== null) {
    return current;
  }
  if (Number.isNaN(Date.parse(nowIso))) {
    throw new RangeError(`Invalid timestamp for published_at: "${nowIso}"`);
  }
  return nowIso;
}
