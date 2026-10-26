/**
 * An ISO 8601 instant as `YYYY-MM-DD HH:mm UTC` for a mail. Built from the text by fixed rules, not by `Intl`, so the
 * bytes never depend on the server's time zone or ICU data (a stored mail must render the same on every attempt), and
 * the time zone is stated, because the shop's own zone is not configuration. A malformed value is a bug (RangeError).
 */
export function formatUtcDateTime(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  if (match === null || Number.isNaN(Date.parse(iso))) {
    throw new RangeError("An order mail time must be an ISO 8601 instant");
  }
  const instant = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(instant.getUTCFullYear()).padStart(4, "0")}-${pad(instant.getUTCMonth() + 1)}-${pad(instant.getUTCDate())} ${pad(instant.getUTCHours())}:${pad(instant.getUTCMinutes())} UTC`;
}
