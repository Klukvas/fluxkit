import {
  CODE_PATTERN as coreCode,
  SLUG_PATTERN as coreSlug,
  TEXT_LIMITS,
  VALUE_CODE_PATTERN as coreValueCode,
} from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  CODE_PATTERN,
  CODE_PATTERN_SOURCE,
  POSITION_MAX,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
  SLUG_PATTERN_SOURCE,
  URL_MAX_LENGTH,
  VALUE_CODE_PATTERN,
  VALUE_CODE_PATTERN_SOURCE,
  hasIssues,
  parsePosition,
} from "./form-rules";

describe("rules copied from core", () => {
  it("are the same patterns and limits as core's (core is a dev dependency of the admin, not in the bundle)", () => {
    expect(CODE_PATTERN.source).toBe(coreCode.source);
    expect(VALUE_CODE_PATTERN.source).toBe(coreValueCode.source);
    expect(SLUG_PATTERN.source).toBe(coreSlug.source);
    expect(SLUG_MAX_LENGTH).toBe(TEXT_LIMITS.slug);
    expect(URL_MAX_LENGTH).toBe(TEXT_LIMITS.url);
  });

  it("have native pattern strings that mean the same as the anchored regular expressions", () => {
    for (const [source, regex] of [
      [CODE_PATTERN_SOURCE, CODE_PATTERN],
      [VALUE_CODE_PATTERN_SOURCE, VALUE_CODE_PATTERN],
      [SLUG_PATTERN_SOURCE, SLUG_PATTERN],
    ] as const) {
      const native = new RegExp(`^(?:${source})$`, "v");
      for (const sample of [
        "a",
        "a1",
        "1a",
        "a_b",
        "a-b",
        "-a",
        "A",
        "a b",
        "",
        "a--b",
        "x".repeat(65),
      ]) {
        expect(native.test(sample), `${source} ${sample}`).toBe(regex.test(sample));
      }
    }
  });
});

describe("parsePosition", () => {
  it("accepts empty (the API picks) and whole numbers up to the API's bound", () => {
    expect(parsePosition("")).toEqual({ ok: true, value: undefined });
    expect(parsePosition(" 3 ")).toEqual({ ok: true, value: 3 });
    expect(parsePosition("0")).toEqual({ ok: true, value: 0 });
    expect(parsePosition(String(POSITION_MAX))).toEqual({ ok: true, value: POSITION_MAX });
  });

  it("refuses everything else", () => {
    for (const text of ["-1", "1.5", "abc", "1e3", String(POSITION_MAX + 1), "99999999"]) {
      expect(parsePosition(text), text).toEqual({ ok: false });
    }
  });
});

describe("hasIssues", () => {
  it("is true only when some field has a message", () => {
    expect(hasIssues({})).toBe(false);
    expect(hasIssues({ code: undefined })).toBe(false);
    expect(hasIssues({ code: { key: "x" } })).toBe(true);
  });
});
