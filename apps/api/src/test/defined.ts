/** TEST ONLY. Narrows a value a spec has just created and must find; a miss is a bug in the spec's setup, so it throws. */
export function defined<T>(value: T | undefined | null, what = "value"): T {
  if (value === undefined || value === null) {
    throw new Error(`Test setup bug: ${what} is missing`);
  }
  return value;
}
