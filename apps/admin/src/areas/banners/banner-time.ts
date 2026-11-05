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

/** `gap`: the zone skips that wall clock (clocks go forward); `ambiguous`: it occurs twice (clocks go back). */
export type LocalTimeNote = "gap" | "ambiguous";

export type LocalInputResult =
  | { ok: true; value: null }
  | { ok: true; value: string; instant: number; note: LocalTimeNote | null }
  | { ok: false };

const MS_PER_DAY = 86_400_000;

/**
 * The UTC instant (`...Z`) of a typed `datetime-local` value in `timeZone`; `""` is no bound. One rule for every zone,
 * whatever the sign of its offset:
 * - the offsets in force a day before, at and a day after the wall clock are the candidates; every candidate instant whose
 *   wall clock in the zone is the typed one is a reading of it;
 * - two readings (the hour the clocks go back): the EARLIER instant (`note: "ambiguous"`);
 * - no reading (the hour the clocks jump over): the offset in force BEFORE the change, which moves the time forward by
 *   the size of the jump, as `new Date(y, m, d, h, min)` does in browsers (`note: "gap"`).
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
  const offsets = new Set(
    [-MS_PER_DAY, 0, MS_PER_DAY].map((shift) => offsetAt(wall + shift, timeZone)),
  );
  const readings = [...offsets]
    .map((offset) => wall - offset)
    .filter((instant) => asUtc(wallClock(instant, timeZone)) === wall)
    .sort((left, right) => left - right);
  const earliest = readings[0];
  const [instant, note]: [number, LocalTimeNote | null] =
    earliest === undefined
      ? [wall - offsetAt(wall - MS_PER_DAY, timeZone), "gap"]
      : [earliest, readings.length > 1 ? "ambiguous" : null];
  return { ok: true, value: new Date(instant).toISOString(), instant, note };
}

/** The zone and its current offset for the hint next to the date fields (`Europe/Kyiv, UTC+02:00`). */
export function zoneLabel(timeZone: string, now: number): string {
  return `${timeZone}, ${offsetLabel(now, timeZone)}`;
}

/** The zone's offset at `instant` as text (`UTC+03:00`): which of two equal wall clocks is meant. */
export function offsetLabel(instant: number, timeZone: string): string {
  const minutes = offsetAt(instant, timeZone) / MS_PER_MINUTE;
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}
