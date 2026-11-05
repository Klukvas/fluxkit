/**
 * The start and end of a banner in a `datetime-local` field. The API stores UTC instants; the admin types the wall clock of
 * a time zone (the browser's: the shop has no time zone setting, plan D2 "Dates") and the form shows which zone that is.
 * Pure: the zone is a parameter, so the tests cover offsets and daylight-saving changes.
 */

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const MS_PER_MINUTE = 60_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (found === undefined) {
    // Throws a RangeError for an unknown zone: a bug of the caller, never a user error.
    found = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: number, timeZone: string): WallClock {
  const values: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year ?? Number.NaN,
    month: values.month ?? Number.NaN,
    day: values.day ?? Number.NaN,
    hour: values.hour ?? Number.NaN,
    minute: values.minute ?? Number.NaN,
    second: values.second ?? Number.NaN,
  };
}

function asUtc(clock: WallClock): number {
  return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
}

/** The zone's offset from UTC at `instant`, in milliseconds (east positive). */
function offsetAt(instant: number, timeZone: string): number {
  const whole = Math.floor(instant / 1000) * 1000;
  return asUtc(wallClock(whole, timeZone)) - whole;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/** The `datetime-local` value (`YYYY-MM-DDTHH:mm`) of an API instant in `timeZone`; `""` for none. */
export function isoToLocalInput(iso: string | null, timeZone: string): string {
  if (iso === null) return "";
  const instant = Date.parse(iso);
  if (Number.isNaN(instant)) throw new RangeError(`Not an instant: ${iso}`);
  const clock = wallClock(instant, timeZone);
  return `${pad(clock.year, 4)}-${pad(clock.month)}-${pad(clock.day)}T${pad(clock.hour)}:${pad(clock.minute)}`;
}

export type LocalInputResult =
  { ok: true; value: null } | { ok: true; value: string; instant: number } | { ok: false };

/**
 * The UTC instant (`...Z`) of a typed `datetime-local` value in `timeZone`; `""` is no bound. A wall-clock time that the
 * zone skips (the hour a daylight-saving change jumps over) moves forward by the jump, as browsers do.
 */
export function localInputToIso(text: string, timeZone: string): LocalInputResult {
  if (text === "") return { ok: true, value: null };
  const match = LOCAL_INPUT.exec(text);
  if (match === null) return { ok: false };
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return { ok: false };
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wall);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return { ok: false };
  // Two steps: the offset near the wall clock, then the offset at the instant that gives (it differs across a change).
  const first = wall - offsetAt(wall, timeZone);
  const instant = wall - offsetAt(first, timeZone);
  return { ok: true, value: new Date(instant).toISOString(), instant };
}

/** The zone and its current offset for the hint next to the date fields (`Europe/Kyiv, UTC+02:00`). */
export function zoneLabel(timeZone: string, now: number): string {
  const minutes = offsetAt(now, timeZone) / MS_PER_MINUTE;
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${timeZone}, UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}
