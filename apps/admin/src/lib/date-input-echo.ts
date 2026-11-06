import type { Translator } from "@fluxkit/ui";

const VALUE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

/**
 * The value of a native `date` or `datetime-local` field written out in the UI language (`1 грудня 2026 р.`). The browser
 * draws those fields in ITS language and format (an English browser shows mm/dd/yyyy in the Ukrainian admin) and a page
 * cannot change that, so the field's hint repeats the chosen date unambiguously. The wall-clock value is formatted as
 * UTC, so no time zone moves the day or the hour. `null` for an empty or impossible value.
 */
export function dateInputEcho(value: string, locale: string): string | null {
  const match = VALUE.exec(value);
  if (match === null) return null;
  const [year, month, day, hour, minute] = match.slice(1).map((part) => Number(part ?? "0")) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const instant = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (instant.getUTCMonth() !== month - 1 || instant.getUTCDate() !== day) return null;
  const withTime = match[4] !== undefined;
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}),
  }).format(instant);
}

/** The hint of a native date field: "Chosen: 1 грудня 2026 р." while it holds a date; none without a locale or a date. */
export function dateHint(
  t: Translator,
  value: string,
  locale: string | undefined,
): string | undefined {
  if (locale === undefined) return undefined;
  const date = dateInputEcho(value, locale);
  return date === null ? undefined : t("common.dateChosen", { date });
}
