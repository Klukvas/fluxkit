import { describe, expect, it } from "vitest";
import {
  ORDER_FILTER_MAX_INSTANT,
  ORDER_FILTER_MIN_INSTANT,
  isCalendarDay,
  nextDay,
  placedRange,
  startOfDayIso,
} from "./date-range";

/** The shape the API's `z.iso.datetime({ offset: true })` gets from us: seconds and a numeric offset, never `Z` or ms. */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

describe("calendar days (the value of a date input and of `from`/`to` in the URL)", () => {
  it("accepts real days of the API's window only", () => {
    for (const day of ["2026-10-20", "2024-02-29", "2000-01-01", "2199-12-31"]) {
      expect(isCalendarDay(day), day).toBe(true);
    }
    for (const day of [
      "",
      "2026-02-29",
      "2026-13-01",
      "2026-00-10",
      "2026-04-31",
      "2026-1-1",
      "26-10-20",
      "2026-10-20T00:00",
      " 2026-10-20",
      "1999-12-31",
      "2200-01-01",
      "٢٠٢٦-١٠-٢٠",
    ]) {
      expect(isCalendarDay(day), day).toBe(false);
    }
  });

  it("knows the next day across months, years and leap days", () => {
    expect(nextDay("2026-10-20")).toBe("2026-10-21");
    expect(nextDay("2026-10-31")).toBe("2026-11-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(nextDay("2024-02-28")).toBe("2024-02-29");
    expect(nextDay("2024-02-29")).toBe("2024-03-01");
    expect(nextDay("2026-02-28")).toBe("2026-03-01");
  });
});

describe("start of a local day as an ISO instant with the zone's offset", () => {
  it("writes the offset that applies at that midnight, not today's", () => {
    // Kyiv: summer time (+03:00) ends on 2026-10-25 at 04:00; that day still starts at +03:00, the next at +02:00.
    expect(startOfDayIso("2026-10-24", "Europe/Kyiv")).toBe("2026-10-24T00:00:00+03:00");
    expect(startOfDayIso("2026-10-25", "Europe/Kyiv")).toBe("2026-10-25T00:00:00+03:00");
    expect(startOfDayIso("2026-10-26", "Europe/Kyiv")).toBe("2026-10-26T00:00:00+02:00");
    // Summer time starts on 2026-03-29 at 03:00.
    expect(startOfDayIso("2026-03-29", "Europe/Kyiv")).toBe("2026-03-29T00:00:00+02:00");
    expect(startOfDayIso("2026-03-30", "Europe/Kyiv")).toBe("2026-03-30T00:00:00+03:00");
    expect(startOfDayIso("2026-01-15", "UTC")).toBe("2026-01-15T00:00:00+00:00");
    expect(startOfDayIso("2026-07-01", "America/New_York")).toBe("2026-07-01T00:00:00-04:00");
    expect(startOfDayIso("2026-12-01", "America/New_York")).toBe("2026-12-01T00:00:00-05:00");
  });

  it("handles offsets with minutes on both sides of UTC", () => {
    expect(startOfDayIso("2026-10-20", "Asia/Kolkata")).toBe("2026-10-20T00:00:00+05:30");
    expect(startOfDayIso("2026-10-20", "Asia/Kathmandu")).toBe("2026-10-20T00:00:00+05:45");
    expect(startOfDayIso("2026-01-20", "America/St_Johns")).toBe("2026-01-20T00:00:00-03:30");
    expect(startOfDayIso("2026-07-20", "America/St_Johns")).toBe("2026-07-20T00:00:00-02:30");
  });

  it("starts a day without a midnight (the clock jumps from 00:00 to 01:00) at its first instant", () => {
    // Santiago de Chile: summer time starts on 2026-09-06 at 00:00, which becomes 01:00 (-04:00 to -03:00).
    const start = startOfDayIso("2026-09-06", "America/Santiago");
    expect(start).toBe("2026-09-06T01:00:00-03:00");
    expect(new Date(start).toISOString()).toBe("2026-09-06T04:00:00.000Z");
    // The instant one second before belongs to the previous day.
    expect(startOfDayIso("2026-09-05", "America/Santiago")).toBe("2026-09-05T00:00:00-04:00");
  });

  it("starts a day after a repeated hour (the clock goes back from 24:00 to 23:00) at its one midnight", () => {
    // Santiago: summer time ends on 2026-04-05 at 00:00, which becomes 23:00 of the 4th again (-03:00 to -04:00).
    const start = startOfDayIso("2026-04-05", "America/Santiago");
    expect(start).toBe("2026-04-05T00:00:00-04:00");
    expect(new Date(start).toISOString()).toBe("2026-04-05T04:00:00.000Z");
    expect(startOfDayIso("2026-04-04", "America/Santiago")).toBe("2026-04-04T00:00:00-03:00");
  });

  it("always writes the shape the API accepts, and the text is the instant it names", () => {
    const zones = ["UTC", "Europe/Kyiv", "America/Santiago", "Asia/Kathmandu", "Pacific/Chatham"];
    for (const zone of zones) {
      for (const day of ["2026-01-01", "2026-03-29", "2026-09-06", "2026-10-25", "2099-06-30"]) {
        const iso = startOfDayIso(day, zone);
        expect(iso, `${zone} ${day}`).toMatch(ISO_WITH_OFFSET);
        expect(iso.slice(0, 10), `${zone} ${day}`).toBe(day);
        const local = new Intl.DateTimeFormat("en-CA", {
          timeZone: zone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(iso));
        expect(local, `${zone} ${day}`).toBe(day);
        // One second earlier is the day before in that zone: nothing of the day is cut off.
        const before = new Intl.DateTimeFormat("en-CA", {
          timeZone: zone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(new Date(iso).getTime() - 1000));
        expect(before, `${zone} ${day}`).not.toBe(day);
      }
    }
  });

  it("refuses what is not a day or not a zone (a bug in the caller)", () => {
    expect(() => startOfDayIso("2026-02-30", "UTC")).toThrow(RangeError);
    expect(() => startOfDayIso("2026-10-20", "Mars/Olympus")).toThrow(RangeError);
  });
});

describe("placed range of the order list: from inclusive, to exclusive", () => {
  it("sends nothing for an empty range", () => {
    expect(placedRange("", "", "Europe/Kyiv")).toEqual({ ok: true });
  });

  it("starts at the first instant of the from day (inclusive)", () => {
    expect(placedRange("2026-10-20", "", "Europe/Kyiv")).toEqual({
      ok: true,
      placedFrom: "2026-10-20T00:00:00+03:00",
    });
  });

  it("ends at the start of the day AFTER the to day (exclusive), so the whole to day is included", () => {
    expect(placedRange("", "2026-10-20", "Europe/Kyiv")).toEqual({
      ok: true,
      placedTo: "2026-10-21T00:00:00+03:00",
    });
    // The to day is the last day of summer time: the next day starts with the winter offset.
    expect(placedRange("2026-10-25", "2026-10-25", "Europe/Kyiv")).toEqual({
      ok: true,
      placedFrom: "2026-10-25T00:00:00+03:00",
      placedTo: "2026-10-26T00:00:00+02:00",
    });
    expect(placedRange("2026-09-05", "2026-09-05", "America/Santiago")).toEqual({
      ok: true,
      placedFrom: "2026-09-05T00:00:00-04:00",
      placedTo: "2026-09-06T01:00:00-03:00",
    });
  });

  it("allows one day (from equal to to) and refuses an end before the start", () => {
    expect(placedRange("2026-10-20", "2026-10-20", "UTC")).toEqual({
      ok: true,
      placedFrom: "2026-10-20T00:00:00+00:00",
      placedTo: "2026-10-21T00:00:00+00:00",
    });
    expect(placedRange("2026-10-21", "2026-10-20", "UTC")).toEqual({
      ok: false,
      field: "to",
      reason: "end_before_start",
    });
  });

  it("refuses text that is not a day, on the field that holds it", () => {
    expect(placedRange("2026-02-30", "", "UTC")).toEqual({
      ok: false,
      field: "from",
      reason: "invalid_day",
    });
    expect(placedRange("", "yesterday", "UTC")).toEqual({
      ok: false,
      field: "to",
      reason: "invalid_day",
    });
  });

  it("refuses instants outside the API's window (2000-01-01 inclusive to 2200-01-01 exclusive)", () => {
    expect(ORDER_FILTER_MIN_INSTANT).toBe(Date.UTC(2000, 0, 1));
    expect(ORDER_FILTER_MAX_INSTANT).toBe(Date.UTC(2200, 0, 1));
    // Midnight of 2000-01-01 in Kyiv is 1999-12-31T22:00Z: before the window.
    expect(placedRange("2000-01-01", "", "Europe/Kyiv")).toEqual({
      ok: false,
      field: "from",
      reason: "out_of_range",
    });
    expect(placedRange("2000-01-01", "", "America/New_York")).toEqual({
      ok: true,
      placedFrom: "2000-01-01T00:00:00-05:00",
    });
    // The day after 2199-12-31 starts at the window's end, which the API excludes.
    expect(placedRange("", "2199-12-31", "UTC")).toEqual({
      ok: false,
      field: "to",
      reason: "out_of_range",
    });
    expect(placedRange("", "2199-12-30", "UTC")).toEqual({
      ok: true,
      placedTo: "2199-12-31T00:00:00+00:00",
    });
  });
});
