import { describe, expect, it } from "vitest";
import { NO_FILES, filesForSwitch, filesOf, missingFiles, withFiles } from "./message-state";

const dictionaries = { "dict.x": "x" };

describe("loaded lazy message files", () => {
  it("start empty in both languages", () => {
    expect(filesOf(NO_FILES, "uk")).toEqual([]);
    expect(filesOf(NO_FILES, "en")).toEqual([]);
    expect(missingFiles(NO_FILES, "uk", ["catalog-dictionaries"])).toEqual([
      "catalog-dictionaries",
    ]);
  });

  it("are added per language without changing the previous state", () => {
    const loaded = withFiles(NO_FILES, "uk", { "catalog-dictionaries": dictionaries });
    expect(NO_FILES.uk).toEqual({});
    expect(filesOf(loaded, "uk")).toEqual(["catalog-dictionaries"]);
    expect(missingFiles(loaded, "uk", ["catalog-dictionaries"])).toEqual([]);
    expect(missingFiles(loaded, "en", ["catalog-dictionaries"])).toEqual(["catalog-dictionaries"]);
  });

  it("a switch first loads, for the new language, every file the current language shows", () => {
    const ukOnly = withFiles(NO_FILES, "uk", { "catalog-dictionaries": dictionaries });
    expect(filesForSwitch(ukOnly, "uk", "en")).toEqual(["catalog-dictionaries"]);
    const both = withFiles(ukOnly, "en", { "catalog-dictionaries": dictionaries });
    expect(filesForSwitch(both, "uk", "en")).toEqual([]);
    // Nothing loaded in the current language: the switch loads nothing.
    expect(filesForSwitch(ukOnly, "en", "uk")).toEqual([]);
  });
});
