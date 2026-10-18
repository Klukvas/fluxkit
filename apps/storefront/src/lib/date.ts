export interface DateFormatOptions {
  /** IANA zone. Omitted: the runtime's zone (the shopper's browser, or the server's for server-rendered text). */
  timeZone?: string;
}

function toDate(value: string | Date): Date {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Cannot format an invalid date.");
  }
  return date;
}

function format(
  value: string | Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
  zone: DateFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, {
    ...options,
    ...(zone.timeZone === undefined ? {} : { timeZone: zone.timeZone }),
  }).format(toDate(value));
}

/** Calendar date, for example "18 жовтня 2026 р." or "October 18, 2026". An invalid date throws. */
export function formatDate(
  value: string | Date,
  locale: string,
  zone: DateFormatOptions = {},
): string {
  return format(value, locale, { dateStyle: "long" }, zone);
}

/** Date and time, for example the expiry of an unpaid order. An invalid date throws. */
export function formatDateTime(
  value: string | Date,
  locale: string,
  zone: DateFormatOptions = {},
): string {
  return format(value, locale, { dateStyle: "long", timeStyle: "short" }, zone);
}
