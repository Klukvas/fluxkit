/** The longest wait the UI names; anything longer is not a sign-in throttle the API sends (its window is 10 minutes). */
const MAX_SECONDS = 24 * 60 * 60;

/**
 * Whole minutes (rounded up) of a `429` answer's `Retry-After` header, which the API sends as seconds. `null` when the
 * header is missing or is not a plausible number of seconds: the message then names no wait instead of a wrong one.
 */
export function retryAfterMinutes(header: string | null): number | null {
  if (header === null || !/^\d{1,6}$/.test(header)) return null;
  const seconds = Number(header);
  if (seconds <= 0 || seconds > MAX_SECONDS) return null;
  return Math.ceil(seconds / 60);
}
