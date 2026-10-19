import { describe, expect, it } from "vitest";
import { nextTabIndex } from "./tab-navigation";

const enabled = [false, false, false, false];

describe("nextTabIndex", () => {
  it("moves right and left with the arrow keys", () => {
    expect(nextTabIndex(1, "ArrowRight", enabled)).toBe(2);
    expect(nextTabIndex(1, "ArrowLeft", enabled)).toBe(0);
  });

  it("wraps around at both ends", () => {
    expect(nextTabIndex(3, "ArrowRight", enabled)).toBe(0);
    expect(nextTabIndex(0, "ArrowLeft", enabled)).toBe(3);
  });

  it("jumps to the first and last tab with Home and End", () => {
    expect(nextTabIndex(2, "Home", enabled)).toBe(0);
    expect(nextTabIndex(1, "End", enabled)).toBe(3);
  });

  it("skips disabled tabs, also across the wrap", () => {
    const disabled = [false, true, true, false];
    expect(nextTabIndex(0, "ArrowRight", disabled)).toBe(3);
    expect(nextTabIndex(3, "ArrowLeft", disabled)).toBe(0);
    expect(nextTabIndex(3, "ArrowRight", disabled)).toBe(0);
  });

  it("lands on an enabled tab for Home and End when the ends are disabled", () => {
    const disabled = [true, false, false, true];
    expect(nextTabIndex(2, "Home", disabled)).toBe(1);
    expect(nextTabIndex(1, "End", disabled)).toBe(2);
  });

  it("stays on the only enabled tab", () => {
    expect(nextTabIndex(2, "ArrowRight", [true, true, false, true])).toBe(2);
    expect(nextTabIndex(2, "ArrowLeft", [true, true, false, true])).toBe(2);
  });

  it("moves from a disabled current tab to an enabled one", () => {
    expect(nextTabIndex(1, "ArrowRight", [false, true, false])).toBe(2);
  });

  it("returns null for keys that do not navigate", () => {
    expect(nextTabIndex(1, "Enter", enabled)).toBeNull();
    expect(nextTabIndex(1, "ArrowDown", enabled)).toBeNull();
    expect(nextTabIndex(1, "a", enabled)).toBeNull();
  });

  it("returns null when no tab is enabled or there are no tabs", () => {
    expect(nextTabIndex(0, "ArrowRight", [true, true])).toBeNull();
    expect(nextTabIndex(0, "Home", [])).toBeNull();
  });
});
