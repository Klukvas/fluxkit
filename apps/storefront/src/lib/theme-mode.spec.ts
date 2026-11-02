import { themeModes } from "@fluxkit/theme";
import { describe, expect, it } from "vitest";
import { themeConfig } from "../config/theme";
import {
  parseThemeMode,
  resolveThemeMode,
  safeThemeReturnPath,
  storefrontThemeModes,
  THEME_COOKIE,
  themeCookie,
} from "./theme-mode";

describe("theme mode", () => {
  it("knows exactly the modes of @fluxkit/theme", () => {
    expect([...storefrontThemeModes]).toEqual([...themeModes]);
  });

  it("parses the three modes and nothing else", () => {
    expect(parseThemeMode("light")).toBe("light");
    expect(parseThemeMode("dark")).toBe("dark");
    expect(parseThemeMode("system")).toBe("system");
    for (const value of ["", "Dark", "dark ", "auto", "<script>", undefined, null]) {
      expect(parseThemeMode(value), String(value)).toBeNull();
    }
  });

  it("uses the stored choice while the switch is shown, else the configured default", () => {
    const shown = { defaultMode: "system", showToggle: true } as const;
    expect(resolveThemeMode("dark", shown)).toBe("dark");
    expect(resolveThemeMode("light", shown)).toBe("light");
    expect(resolveThemeMode(undefined, shown)).toBe("system");
    expect(resolveThemeMode("purple", shown)).toBe("system");
    const hidden = { defaultMode: "light", showToggle: false } as const;
    expect(resolveThemeMode("dark", hidden)).toBe("light");
  });

  it("defaults to the system mode with the switch shown (owner to confirm)", () => {
    expect(themeConfig).toEqual({ defaultMode: "system", showToggle: true });
  });

  it("writes a first-party preference cookie for the whole site, a year long, Secure on https", () => {
    expect(themeCookie("dark", { secure: false })).toBe(
      `${THEME_COOKIE}=dark; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
    expect(themeCookie("system", { secure: true })).toBe(
      `${THEME_COOKIE}=system; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    );
    expect(THEME_COOKIE).toBe("fluxkit_theme");
  });
});

describe("safeThemeReturnPath", () => {
  it("keeps a path of this storefront under a locale", () => {
    for (const path of [
      "/uk",
      "/en",
      "/uk/catalog",
      "/en/p/demo-t-shirt",
      "/uk/c/%D0%BE%D0%B4%D1%8F%D0%B3",
    ]) {
      expect(safeThemeReturnPath(path), path).toBe(path);
    }
  });

  it("sends anything else to the default locale's home page (no open redirect)", () => {
    for (const value of [
      "//evil.example",
      "/uk//evil.example",
      "https://evil.example/uk",
      "/\\evil.example",
      "/uk/%5Cevil",
      "/%2F%2Fevil.example",
      "/de/catalog",
      "/uk/catalog?x=1",
      "/uk/a b",
      "/uk/%E0%A4%A",
      "javascript:alert(1)",
      "",
      "/",
      `/uk/${"a".repeat(1100)}`,
      42,
      undefined,
    ]) {
      expect(safeThemeReturnPath(value), String(value)).toBe("/uk");
    }
  });
});
