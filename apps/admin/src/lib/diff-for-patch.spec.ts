import { describe, expect, it } from "vitest";
import { diffForPatch, jsonEqual } from "./diff-for-patch";

describe("jsonEqual", () => {
  it("compares JSON values deeply, ignoring the key order of objects but not the order of arrays", () => {
    expect(jsonEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(jsonEqual(null, null)).toBe(true);
    expect(jsonEqual(null, undefined)).toBe(false);
    expect(jsonEqual("1", 1)).toBe(false);
    expect(jsonEqual({}, [])).toBe(false);
    expect(jsonEqual({ a: null }, { a: {} })).toBe(false);
  });
});

describe("diffForPatch", () => {
  const original = {
    name: { uk: "Колір", en: "Color" },
    unit: null as string | null,
    isInternal: false,
    tags: ["a", "b"],
    validation: { min_length: 1 },
  };

  it("sends nothing when nothing changed", () => {
    expect(diffForPatch(original, structuredClone(original))).toEqual({});
  });

  it("sends only the changed fields, never the unchanged ones", () => {
    expect(diffForPatch(original, { ...original, isInternal: true })).toEqual({ isInternal: true });
    const patch = diffForPatch(original, { ...original, isInternal: true, unit: "kg" });
    expect(Object.keys(patch).sort()).toEqual(["isInternal", "unit"]);
  });

  it("replaces a locale map as a whole when any locale changed (the API replaces maps)", () => {
    expect(diffForPatch(original, { ...original, name: { uk: "Колір", en: "Colour" } })).toEqual({
      name: { uk: "Колір", en: "Colour" },
    });
    expect(diffForPatch(original, { ...original, name: { uk: "Колір" } })).toEqual({
      name: { uk: "Колір" },
    });
  });

  it("replaces an array as a whole, in order", () => {
    expect(diffForPatch(original, { ...original, tags: ["b", "a"] })).toEqual({ tags: ["b", "a"] });
    expect(diffForPatch(original, { ...original, tags: [] })).toEqual({ tags: [] });
  });

  it("sends null to clear a field, and nothing when it was null already", () => {
    expect(diffForPatch({ ...original, unit: "kg" }, { ...original, unit: null })).toEqual({
      unit: null,
    });
    expect(diffForPatch(original, { ...original, unit: null })).toEqual({});
  });

  it("treats a field absent from the next value as unchanged and ignores undefined", () => {
    const withoutFlag: Record<string, unknown> = { ...original };
    delete withoutFlag["isInternal"];
    expect(diffForPatch(original, withoutFlag)).toEqual({});
    expect(diffForPatch(original, { ...original, unit: undefined })).toEqual({});
  });

  it("sends a field that did not exist before", () => {
    expect(diffForPatch({}, { logoUrl: "https://example.com/a.png" })).toEqual({
      logoUrl: "https://example.com/a.png",
    });
  });

  it("does not merge nested objects: a changed nested key sends the whole object", () => {
    expect(
      diffForPatch(
        { validation: { min_length: 1, max_length: 5 } },
        { validation: { min_length: 1, max_length: 6 } },
      ),
    ).toEqual({ validation: { min_length: 1, max_length: 6 } });
  });

  it("does not alias the input: changing the result leaves the next value alone", () => {
    const next = { ...original, name: { uk: "Інше" } };
    const patch = diffForPatch(original, next);
    (patch.name as Record<string, string>)["uk"] = "Змінено";
    expect(next.name.uk).toBe("Інше");
  });
});
