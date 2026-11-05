/**
 * The order of the banner list (`PUT /admin/banners/order`: every id exactly once, in the new order). Two ways in: the
 * move up/down buttons (keyboard, the accessible path) and dragging a row (a pointer enhancement); both end in one of
 * these pure functions and one request.
 */

/** The ids with the item at `index` moved one place up (`-1`) or down (`1`); `null` at either end (nothing to send). */
export function moveBy<T>(items: readonly T[], index: number, delta: -1 | 1): T[] | null {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return null;
  const next = [...items];
  const [moved] = next.splice(index, 1) as [T];
  next.splice(target, 0, moved);
  return next;
}

/**
 * The items with the one at `from` dropped onto the place of the one at `to` (it takes that place; the others shift).
 * `null` when nothing changes or an index is outside the list.
 */
export function moveTo<T>(items: readonly T[], from: number, to: number): T[] | null {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return null;
  const next = [...items];
  const [moved] = next.splice(from, 1) as [T];
  next.splice(to, 0, moved);
  return next;
}
