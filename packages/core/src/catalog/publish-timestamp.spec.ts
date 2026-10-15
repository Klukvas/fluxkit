import { describe, expect, it } from "vitest";
import { nextPublishedAt } from "./publish-timestamp.js";

describe("nextPublishedAt", () => {
  it("sets the timestamp on the first publish", () => {
    expect(nextPublishedAt(null, "2026-10-15T10:00:00.000Z")).toBe("2026-10-15T10:00:00.000Z");
  });

  it("never changes an existing timestamp", () => {
    expect(nextPublishedAt("2026-01-01T00:00:00.000Z", "2026-10-15T10:00:00.000Z")).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("keeps an existing timestamp even if now is earlier", () => {
    expect(nextPublishedAt("2026-06-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z")).toBe(
      "2026-06-01T00:00:00.000Z",
    );
  });

  it("refuses an invalid now when it would be stored", () => {
    expect(() => nextPublishedAt(null, "yesterday")).toThrow(RangeError);
  });

  it("does not look at now when a timestamp exists", () => {
    expect(nextPublishedAt("2026-01-01T00:00:00.000Z", "not a date")).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("is deterministic", () => {
    expect(nextPublishedAt(null, "2026-10-15T10:00:00.000Z")).toBe(
      nextPublishedAt(null, "2026-10-15T10:00:00.000Z"),
    );
  });
});
