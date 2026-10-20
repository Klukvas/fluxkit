/**
 * Request bodies of PATCH routes (plan, "Routing, data and state"): only what the admin changed. Two admins who edit
 * different fields of one resource do not overwrite each other; the same field stays last-write-wins (the API has no
 * version, owner answer 13). Generic on purpose: every editor of a later step builds its body through it.
 */

/** Deep equality of JSON values: object key order does not matter, array order does. `undefined` is not `null`. */
export function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => jsonEqual(item, right[index]))
    );
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        jsonEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    )
  );
}

/**
 * The fields of `next` whose value differs from `original`, as a PATCH body. Rules:
 * - an unchanged field is left out, so is a field whose value in `next` is `undefined` or that `next` does not have;
 * - a changed locale map, array or other object is sent whole (the API replaces maps and arrays, it never merges them);
 * - `null` is a value: it clears a nullable field, and is left out when the field was `null` already;
 * - the result shares nothing with `next`.
 */
export function diffForPatch<Next extends Record<string, unknown>>(
  original: Record<string, unknown>,
  next: Next,
): Partial<Next> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    if (Object.hasOwn(original, key) && jsonEqual(original[key], value)) continue;
    patch[key] = structuredClone(value);
  }
  return patch as Partial<Next>;
}
