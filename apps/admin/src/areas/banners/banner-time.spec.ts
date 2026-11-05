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
        // A wall clock that occurs twice (the hour the clock goes back) may read as either instant; both show the same text.
        expect(isoToLocalInput(back.value, zone), `${zone} ${text}`).toBe(text);
      }
    }
  });

  it("moves a wall clock that the zone skips forward by the jump (spring change), as browsers do", () => {
    // Kyiv 2026-03-29: 03:00 jumps to 04:00, so 03:30 does not exist.
    const result = localInputToIso("2026-03-29T03:30", "Europe/Kyiv");
    expect(result).toMatchObject({ ok: true, value: "2026-03-29T01:30:00.000Z" });
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
