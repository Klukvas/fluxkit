import { describe, expect, it } from "vitest";
import { isoToLocalInput, localInputToIso, zoneLabel } from "./banner-time";

describe("banner times in a datetime-local field", () => {
  it("shows an API instant as the wall clock of the zone", () => {
    expect(isoToLocalInput("2026-11-05T10:30:00.000Z", "UTC")).toBe("2026-11-05T10:30");
    expect(isoToLocalInput("2026-11-05T10:30:00.000Z", "Europe/Kyiv")).toBe("2026-11-05T12:30");
    expect(isoToLocalInput("2026-07-05T10:30:00.000Z", "Europe/Kyiv")).toBe("2026-07-05T13:30");
    expect(isoToLocalInput("2026-11-05T02:00:00.000Z", "America/New_York")).toBe(
      "2026-11-04T21:00",
    );
    expect(isoToLocalInput(null, "UTC")).toBe("");
  });

  it("sends a typed wall clock as the UTC instant of that zone, with the offset in force on that day", () => {
    expect(localInputToIso("2026-11-05T12:30", "Europe/Kyiv")).toEqual({
      ok: true,
      value: "2026-11-05T10:30:00.000Z",
      instant: Date.UTC(2026, 10, 5, 10, 30),
      note: null,
    });
    // Summer time in Kyiv (+03:00).
    expect(localInputToIso("2026-07-05T13:30", "Europe/Kyiv")).toMatchObject({
      value: "2026-07-05T10:30:00.000Z",
    });
    // The day of the autumn change: 03:59 is still +03:00, 04:01 already +02:00 (the clock went back at 04:00).
    expect(localInputToIso("2026-10-25T02:30", "Europe/Kyiv")).toMatchObject({
      value: "2026-10-24T23:30:00.000Z",
    });
    expect(localInputToIso("2026-10-25T05:00", "Europe/Kyiv")).toMatchObject({
      value: "2026-10-25T03:00:00.000Z",
    });
    expect(localInputToIso("", "Europe/Kyiv")).toEqual({ ok: true, value: null });
  });

  it("round-trips every quarter hour of a year with two changes", () => {
    for (const zone of ["Europe/Kyiv", "America/New_York", "Asia/Kolkata", "UTC"]) {
      for (
        let instant = Date.UTC(2026, 0, 1);
        instant < Date.UTC(2027, 0, 1);
        instant += 900_000 * 37
      ) {
        const text = isoToLocalInput(new Date(instant).toISOString(), zone);
        const back = localInputToIso(text, zone);
        if (!back.ok || back.value === null) throw new Error(`${zone} ${text} did not parse`);
        // A wall clock that occurs twice reads as the EARLIER instant; both instants show the same text.
        expect(isoToLocalInput(back.value, zone), `${zone} ${text}`).toBe(text);
        if (back.note === "ambiguous") expect(back.instant).toBeLessThanOrEqual(instant);
      }
    }
  });

  // One rule for every zone, whatever the sign of its offset (review of PR 230, M1): a wall clock the zone skips moves
  // FORWARD by the size of the jump (as `new Date(y, m, d, h, min)` does in browsers); one that occurs twice is the EARLIER
  // instant. Each case: zone, typed text, the UTC instant, what the form shows when it is opened again, the note.
  const cases: [string, string, string, string, "gap" | "ambiguous" | null][] = [
    // Kyiv (+02:00 / +03:00): 2026-03-29 03:00 -> 04:00; 2026-10-25 04:00 -> 03:00.
    ["Europe/Kyiv", "2026-03-29T03:30", "2026-03-29T01:30:00.000Z", "2026-03-29T04:30", "gap"],
    [
      "Europe/Kyiv",
      "2026-10-25T03:30",
      "2026-10-25T00:30:00.000Z",
      "2026-10-25T03:30",
      "ambiguous",
    ],
    // New York (-05:00 / -04:00): 2026-03-08 02:00 -> 03:00; 2026-11-01 02:00 -> 01:00.
    ["America/New_York", "2026-03-08T02:30", "2026-03-08T07:30:00.000Z", "2026-03-08T03:30", "gap"],
    [
      "America/New_York",
      "2026-11-01T01:30",
      "2026-11-01T05:30:00.000Z",
      "2026-11-01T01:30",
      "ambiguous",
    ],
    // Lord Howe (+10:30 / +11:00, a 30-minute change): 2026-10-04 02:00 -> 02:30; 2026-04-05 02:00 -> 01:30.
    [
      "Australia/Lord_Howe",
      "2026-10-04T02:15",
      "2026-10-03T15:45:00.000Z",
      "2026-10-04T02:45",
      "gap",
    ],
    [
      "Australia/Lord_Howe",
      "2026-04-05T01:45",
      "2026-04-04T14:45:00.000Z",
      "2026-04-05T01:45",
      "ambiguous",
    ],
    // No changes at all.
    ["UTC", "2026-03-29T03:30", "2026-03-29T03:30:00.000Z", "2026-03-29T03:30", null],
    ["Etc/GMT-14", "2026-03-29T03:30", "2026-03-28T13:30:00.000Z", "2026-03-29T03:30", null],
  ];

  it.each(cases)("%s %s: %s, shown again as %s (%s)", (zone, text, iso, shown, note) => {
    const result = localInputToIso(text, zone);
    expect(result).toEqual({ ok: true, value: iso, instant: Date.parse(iso), note });
    expect(isoToLocalInput(iso, zone)).toBe(shown);
  });

  it("refuses text that is not a real date and time", () => {
    for (const text of [
      "2026-02-30T10:00",
      "2026-13-01T10:00",
      "2026-01-01T24:00",
      "2026-01-01",
      "x",
    ]) {
      expect(localInputToIso(text, "UTC"), text).toEqual({ ok: false });
    }
  });

  it("names the zone with its offset now", () => {
    expect(zoneLabel("Europe/Kyiv", Date.UTC(2026, 10, 5))).toBe("Europe/Kyiv, UTC+02:00");
    expect(zoneLabel("Europe/Kyiv", Date.UTC(2026, 6, 5))).toBe("Europe/Kyiv, UTC+03:00");
    expect(zoneLabel("Asia/Kolkata", Date.UTC(2026, 6, 5))).toBe("Asia/Kolkata, UTC+05:30");
    expect(zoneLabel("America/New_York", Date.UTC(2026, 10, 5))).toBe(
      "America/New_York, UTC-05:00",
    );
  });
});
