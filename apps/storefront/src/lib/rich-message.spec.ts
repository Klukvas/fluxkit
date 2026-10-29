import { describe, expect, it } from "vitest";
import { slotValues, splitMessage } from "./rich-message";

describe("splitMessage", () => {
  it("splits a translated sentence around its slots, keeping the text in between in order", () => {
    expect(
      splitMessage("By ordering you accept the {terms}. See the {privacy}.", ["terms", "privacy"]),
    ).toEqual([
      { kind: "text", text: "By ordering you accept the " },
      { kind: "slot", name: "terms" },
      { kind: "text", text: ". See the " },
      { kind: "slot", name: "privacy" },
      { kind: "text", text: "." },
    ]);
  });

  it("allows the slots in either order (languages differ) and a slot at either end", () => {
    expect(splitMessage("{privacy} and {terms}", ["terms", "privacy"])).toEqual([
      { kind: "slot", name: "privacy" },
      { kind: "text", text: " and " },
      { kind: "slot", name: "terms" },
    ]);
  });

  it("returns the whole text when it has no slot, and nothing for an empty text", () => {
    expect(splitMessage("Plain sentence.", ["terms"])).toEqual([
      { kind: "text", text: "Plain sentence." },
    ]);
    expect(splitMessage("", ["terms"])).toEqual([]);
  });

  it("leaves a brace that is not one of the slots as text", () => {
    expect(splitMessage("a {other} b {terms}", ["terms"])).toEqual([
      { kind: "text", text: "a {other} b " },
      { kind: "slot", name: "terms" },
    ]);
  });
});

describe("slotValues", () => {
  it("gives each slot its own braces back, so the translator keeps them for splitMessage", () => {
    expect(slotValues(["terms", "privacy"])).toEqual({ terms: "{terms}", privacy: "{privacy}" });
  });
});
