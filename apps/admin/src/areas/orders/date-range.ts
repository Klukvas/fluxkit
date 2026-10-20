/**
 * The order list's date filter (plan, "i18n": local day boundaries to ISO strings with offset, `placedFrom` inclusive,
 * `placedTo` exclusive). The admin picks calendar days; a day is read in a time zone (the browser's: there is no shop time
 * zone setting, plan gap 18) and turned into the first instant of that day, written with the offset that applies at that
 * instant (not today's offset: a range across a daylight-saving change gets two offsets). The "to" day is included, so
 * `placedTo` is the first instant of the day after it. Pure: the zone is a parameter, so the tests cover DST edges.
 */

/** The API's window for `placedFrom` and `placedTo`: 2000-01-01 inclusive to 2200-01-01 exclusive (UTC). */
export const ORDER_FILTER_MIN_INSTANT = Date.UTC(2000, 0, 1);
export const ORDER_FILTER_MAX_INSTANT = Date.UTC(2200, 0, 1);

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

interface DayParts {
  year: number;
  month: number;
  day: number;
}

function partsOf(text: string): DayParts | null {
  const match = DAY_PATTERN.exec(text);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function dayText(parts: DayParts): string {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** A real calendar day `YYYY-MM-DD` (ASCII digits) from 2000 to 2199: what a date input gives and the URL keeps. */
export function isCalendarDay(text: string): boolean {
  const parts = partsOf(text);
  return parts !== null && parts.year >= 2000 && parts.year <= 2199;
}

/** The day after `day` (`YYYY-MM-DD`). */
export function nextDay(day: string): string {
  const parts = partsOf(day);
  if (parts === null) throw new RangeError(`Not a calendar day: ${day}`);
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + MS_PER_DAY);
  return dayText({
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  });
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    // Throws a RangeError for an unknown zone: a bug of the caller, never a user error.
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall clock of `instant` in `timeZone`, as if it were UTC (milliseconds), and its calendar day. */
function wallClock(instant: number, timeZone: string): { asUtc: number; day: string } {
  const values: Record<string, number> = {};
  for (const part of wallClockFormatter(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  const year = values.year ?? Number.NaN;
  const month = values.month ?? Number.NaN;
  const day = values.day ?? Number.NaN;
  const asUtc = Date.UTC(
    year,
    month - 1,
    day,
    values.hour ?? Number.NaN,
    values.minute ?? Number.NaN,
    values.second ?? Number.NaN,
  );
  if (Number.isNaN(asUtc)) throw new RangeError(`Cannot read the wall clock in ${timeZone}.`);
  return { asUtc, day: dayText({ year, month, day }) };
}

/** The zone's offset from UTC at `instant`, in whole minutes (east positive). */
function offsetMinutes(instant: number, timeZone: string): number {
  const whole = Math.floor(instant / 1000) * 1000;
  const minutes = (wallClock(whole, timeZone).asUtc - whole) / MS_PER_MINUTE;
  if (!Number.isInteger(minutes)) {
    throw new RangeError(`The offset of ${timeZone} is not a whole number of minutes.`);
  }
  return minutes;
}

function offsetText(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/** The first instant (milliseconds) of `day` in `timeZone`. */
function startOfDay(day: string, timeZone: string): number {
  const parts = partsOf(day);
  if (parts === null) throw new RangeError(`Not a calendar day: ${day}`);
  const midnightAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  // The offsets around that midnight (before and after a change on that day); each gives a candidate instant. The
  // earliest candidate whose wall clock is on `day` is its start: midnight itself, or the first instant after a gap when
  // the clock jumps over midnight.
  const offsets = new Set(
    [-MS_PER_DAY, 0, MS_PER_DAY].map((shift) => offsetMinutes(midnightAsUtc + shift, timeZone)),
  );
  const candidates = [...offsets]
    .map((minutes) => midnightAsUtc - minutes * MS_PER_MINUTE)
    .filter((instant) => wallClock(instant, timeZone).day === day)
    .sort((left, right) => left - right);
  const start = candidates[0];
  if (start === undefined) throw new RangeError(`Cannot find the start of ${day} in ${timeZone}.`);
  return start;
}

/**
 * The first instant of `day` in `timeZone` as `YYYY-MM-DDTHH:mm:ss±HH:MM` with the offset in force at that instant
 * (`2026-10-25T00:00:00+03:00`, `2026-10-26T00:00:00+02:00` in Kyiv). Where the clock jumps over midnight the day
 * starts later (`2026-09-06T01:00:00-03:00` in Santiago).
 */
export function startOfDayIso(day: string, timeZone: string): string {
  const instant = startOfDay(day, timeZone);
  const offset = offsetMinutes(instant, timeZone);
  const wall = new Date(instant + offset * MS_PER_MINUTE);
  return `${dayText({
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
  })}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}${offsetText(offset)}`;
}

export type DayRangeFailure = "invalid_day" | "end_before_start" | "out_of_range";

export type PlacedRange =
  | { ok: true; placedFrom?: string; placedTo?: string }
  | { ok: false; field: "from" | "to"; reason: DayRangeFailure };

function withinWindow(instant: number): boolean {
  return instant >= ORDER_FILTER_MIN_INSTANT && instant < ORDER_FILTER_MAX_INSTANT;
}

/**
 * `placedFrom` and `placedTo` of `GET /admin/orders` for the days `from` and `to` (each `""` for none), or why the API
 * would refuse them (nothing is sent then): a text that is not a day, an end before the start, an instant outside the
 * API's window. `from` includes its whole day; `to` includes its whole day too, so `placedTo` (exclusive) is the start of
 * the next day.
 */
export function placedRange(from: string, to: string, timeZone: string): PlacedRange {
  if (from !== "" && !isCalendarDay(from)) {
    return { ok: false, field: "from", reason: "invalid_day" };
  }
  if (to !== "" && !isCalendarDay(to)) return { ok: false, field: "to", reason: "invalid_day" };
  if (from !== "" && to !== "" && from > to) {
    return { ok: false, field: "to", reason: "end_before_start" };
  }
  const result: { ok: true; placedFrom?: string; placedTo?: string } = { ok: true };
  if (from !== "") {
    if (!withinWindow(startOfDay(from, timeZone))) {
      return { ok: false, field: "from", reason: "out_of_range" };
    }
    result.placedFrom = startOfDayIso(from, timeZone);
  }
  if (to !== "") {
    const end = nextDay(to);
    if (!withinWindow(startOfDay(end, timeZone))) {
      return { ok: false, field: "to", reason: "out_of_range" };
    }
    result.placedTo = startOfDayIso(end, timeZone);
  }
  return result;
}

/** The browser's time zone (IANA name). */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
