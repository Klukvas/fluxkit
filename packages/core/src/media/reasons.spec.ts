import { describe, expect, it } from "vitest";
import { MEDIA_PROBLEM_CODES, MEDIA_VALIDATION_REASONS } from "./reasons.js";

describe("media reason codes (ADR 0028 decision 3 and 5)", () => {
  it("lists exactly the validation reasons of the ADR", () => {
    expect([...MEDIA_VALIDATION_REASONS].sort()).toEqual(
      [
        "animated_not_supported",
        "corrupt_image",
        "dimensions_too_large",
        "empty_file",
        "file_too_large",
        "length_required",
        "processing_timeout",
        "too_many_pixels",
        "unsupported_type",
        "upload_not_found",
      ].sort(),
    );
  });

  it("lists exactly the new problem codes of the ADR", () => {
    expect([...MEDIA_PROBLEM_CODES].sort()).toEqual(["storage_unavailable", "uploads_disabled"]);
  });

  it("has unique snake_case codes, no overlap between the two lists, and is frozen", () => {
    const all = [...MEDIA_VALIDATION_REASONS, ...MEDIA_PROBLEM_CODES];
    expect(new Set(all).size).toBe(all.length);
    for (const code of all) {
      expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
    expect(Object.isFrozen(MEDIA_VALIDATION_REASONS)).toBe(true);
    expect(Object.isFrozen(MEDIA_PROBLEM_CODES)).toBe(true);
  });
});
