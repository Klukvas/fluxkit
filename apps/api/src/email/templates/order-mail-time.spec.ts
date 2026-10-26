import { describe, expect, it } from "vitest";
import { formatUtcDateTime } from "./order-mail-time.js";

describe("formatUtcDateTime", () => {
  it("prints the UTC date and minute whatever the offset of the input", () => {
    expect(formatUtcDateTime("2030-01-01T12:00:00.000Z")).toBe("2030-01-01 12:00 UTC");
    expect(formatUtcDateTime("2030-03-31T23:59:59.999Z")).toBe("2030-03-31 23:59 UTC");
    expect(formatUtcDateTime("2030-01-01T02:30:00+03:00")).toBe("2029-12-31 23:30 UTC");
  });

  it("refuses text that is not an instant", () => {
    for (const text of ["", "tomorrow", "2030-13-01T00:00:00Z", "<script>"]) {
      expect(() => formatUtcDateTime(text)).toThrow(RangeError);
    }
  });
});
