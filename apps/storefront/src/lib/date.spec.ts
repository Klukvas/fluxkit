import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./date";

function plain(text: string): string {
  return text.replace(/[  ]/g, " ");
}

describe("formatDate / formatDateTime", () => {
  const iso = "2026-10-18T21:05:00.000Z";

  it("formats the calendar date in the locale and time zone given", () => {
    expect(formatDate(iso, "en", { timeZone: "UTC" })).toBe("October 18, 2026");
    expect(formatDate(iso, "uk", { timeZone: "UTC" })).toBe("18 жовтня 2026 р.");
  });

  it("moves the calendar day with the time zone (never silently UTC)", () => {
    expect(formatDate(iso, "en", { timeZone: "Europe/Kyiv" })).toBe("October 19, 2026");
  });

  it("formats date and time", () => {
    expect(plain(formatDateTime(iso, "en", { timeZone: "UTC" }))).toBe(
      "October 18, 2026 at 9:05 PM",
    );
    expect(plain(formatDateTime(iso, "uk", { timeZone: "Europe/Kyiv" }))).toMatch(
      /^19 жовтня 2026 р\. о 00:05$/,
    );
  });

  it("accepts a Date", () => {
    expect(formatDate(new Date(iso), "en", { timeZone: "UTC" })).toBe("October 18, 2026");
  });

  it("throws for an invalid date instead of printing 'Invalid Date'", () => {
    expect(() => formatDate("not a date", "en")).toThrow(RangeError);
    expect(() => formatDateTime(new Date(Number.NaN), "uk")).toThrow(RangeError);
  });
});
