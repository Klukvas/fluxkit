import { describe, expect, it } from "vitest";
import type { StorageLike } from "../i18n/locale-preference";
import {
  readSidebarCollapsed,
  SIDEBAR_STORAGE_KEY,
  storeSidebarCollapsed,
} from "./sidebar-preference";

const denied = (): never => {
  throw new Error("Storage denied");
};
const storage = (value: string | null): StorageLike => ({
  getItem: () => value,
  setItem: () => undefined,
});

describe("sidebar preference", () => {
  it.each([null, "", "false", "1", "TRUE", "invalid"])(
    "expands for missing or invalid %s",
    (value) => {
      expect(readSidebarCollapsed(() => storage(value))).toBe(false);
    },
  );
  it("reads and writes the exact boolean codec", () => {
    let saved: string | null = null;
    const store: StorageLike = {
      getItem: (key) => {
        expect(key).toBe(SIDEBAR_STORAGE_KEY);
        return saved;
      },
      setItem: (key, value) => {
        expect(key).toBe(SIDEBAR_STORAGE_KEY);
        saved = value;
      },
    };
    for (const collapsed of [true, false]) {
      expect(storeSidebarCollapsed(collapsed, () => store)).toBe(true);
      expect(saved).toBe(String(collapsed));
      expect(readSidebarCollapsed(() => store)).toBe(collapsed);
    }
  });
  it("expands when accessor or read throws, and reports failed writes", () => {
    expect(readSidebarCollapsed(denied)).toBe(false);
    expect(readSidebarCollapsed(() => ({ getItem: denied, setItem: denied }))).toBe(false);
    expect(storeSidebarCollapsed(true, denied)).toBe(false);
    expect(storeSidebarCollapsed(true, () => ({ getItem: denied, setItem: denied }))).toBe(false);
  });
});
