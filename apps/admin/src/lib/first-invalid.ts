/** The part of a DOM element that `firstInvalidControl` uses (an `Element` fits), so the rule runs without a DOM in tests. */
export interface InvalidSearchRoot {
  querySelector(selector: string): InvalidSearchRoot | null;
  matches(selector: string): boolean;
}

/** A native control marked invalid (`aria-invalid`), or a group without a native field (a picture slot) marked by the form. */
export const INVALID_SELECTOR = '[aria-invalid="true"], [data-invalid="true"]';
const CONTROL_SELECTOR =
  'input:not([type="hidden"]):not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * The first field of `root` marked invalid, in document order, to focus after a refused save (the browser scrolls it into
 * view). A marked group is not focusable itself: its first enabled control is focused (the group itself when it has none).
 * `null` when nothing is marked; the caller then focuses the error summary.
 */
export function firstInvalidControl(root: InvalidSearchRoot): InvalidSearchRoot | null {
  const marked = root.querySelector(INVALID_SELECTOR);
  if (marked === null) return null;
  if (!marked.matches('[data-invalid="true"]')) return marked;
  return marked.querySelector(CONTROL_SELECTOR) ?? marked;
}
