import { describe, expect, it } from "vitest";
import type { Translator } from "@fluxkit/ui";
import { dateHint, dateInputEcho } from "./date-input-echo";

describe("dateInputEcho (the chosen date in the UI language, under a native date field)", () => {
  it("writes a date field's value in words of the UI language, whatever the browser's own format", () => {
    expect(dateInputEcho("2026-12-01", "uk")).toBe("1 грудня 2026 р.");
    expect(dateInputEcho("2026-12-01", "en")).toBe("December 1, 2026");
  });

  it("keeps the wall-clock time of a datetime-local value (no time zone shift)", () => {
    expect(dateInputEcho("2026-12-01T09:05", "en")).toMatch(/^December 1, 2026(,| at) 09:05$/);
    expect(dateInputEcho("2026-12-01T23:30", "uk")).toMatch(/^1 грудня 2026 р\.(,| о) 23:30$/);
  });

  it("says nothing for an empty or unreadable value (the field shows its own error)", () => {
    expect(dateInputEcho("", "uk")).toBeNull();
    expect(dateInputEcho("2026-13-40", "uk")).toBeNull();
    expect(dateInputEcho("tomorrow", "en")).toBeNull();
  });
});

describe("dateHint (the help text under a native date field)", () => {
  const t = ((key: string, values?: Record<string, unknown>) =>
    values === undefined ? `§${key}` : `§${key}(${String(values["date"])})`) as Translator;

  it("always names the expected format, also before a date is chosen (UX round 2: the browser drew mm/dd/yyyy)", () => {
    expect(dateHint(t, "", "uk")).toBe("§common.dateFormat");
    expect(dateHint(t, "", "uk", "datetime")).toBe("§common.dateTimeFormat");
  });

  it("adds the chosen date in words once there is one", () => {
    expect(dateHint(t, "2026-12-01", "uk")).toBe(
      "§common.dateFormat §common.dateChosen(1 грудня 2026 р.)",
    );
  });

  it("says nothing without a UI language", () => {
    expect(dateHint(t, "2026-12-01", undefined)).toBeUndefined();
  });
});
