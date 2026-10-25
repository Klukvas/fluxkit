import type { ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  MAX_LISTED_ISSUES,
  SETTINGS_MAX_BYTES,
  parseSettingsText,
  settingsIssuesFromProblem,
  settingsToText,
} from "./provider-settings";

describe("parseSettingsText", () => {
  it("accepts a JSON object and round-trips it through the editor text", () => {
    const settings = {
      sender: { name: "Shop", phone: "+380501234567" },
      parcel: { weightGrams: 500 },
    };
    const text = settingsToText(settings);
    expect(text).toContain("\n  ");
    expect(parseSettingsText(text)).toEqual({ ok: true, settings });
    expect(parseSettingsText("{}")).toEqual({ ok: true, settings: {} });
  });

  it("refuses an empty text, text that is not JSON, and JSON that is not an object", () => {
    expect(parseSettingsText("  ")).toMatchObject({
      ok: false,
      issue: { key: "errors.reason.required" },
    });
    expect(parseSettingsText("{ nope")).toMatchObject({
      ok: false,
      issue: { key: "ship.settings.invalidJson" },
    });
    for (const text of ["[]", "[1]", "null", "12", '"x"', "true"]) {
      expect(parseSettingsText(text), text).toMatchObject({
        ok: false,
        issue: { key: "ship.reason.not_an_object" },
      });
    }
  });

  it("does not show the JSON engine's English message", () => {
    const result = parseSettingsText("{ nope");
    expect(JSON.stringify(result)).not.toMatch(/Unexpected|position|token/i);
  });

  it("refuses more than 16 KiB of JSON (counted in bytes of the compact form) and accepts exactly the limit", () => {
    expect(SETTINGS_MAX_BYTES).toBe(16384);
    // {"a":"…"} is 8 bytes of structure plus the value.
    const fits = JSON.stringify({ a: "x".repeat(SETTINGS_MAX_BYTES - 8) });
    expect(new TextEncoder().encode(fits).length).toBe(SETTINGS_MAX_BYTES);
    expect(parseSettingsText(fits).ok).toBe(true);
    const over = JSON.stringify({ a: "x".repeat(SETTINGS_MAX_BYTES - 7) });
    expect(parseSettingsText(over)).toMatchObject({
      ok: false,
      issue: { key: "ship.reason.too_large" },
    });
    // Multi-byte characters count by bytes, not characters.
    const wide = JSON.stringify({ a: "я".repeat(SETTINGS_MAX_BYTES / 2) });
    expect(parseSettingsText(wide).ok).toBe(false);
  });

  it("does not ask for or reformat credentials: a credential-like key is the server's to refuse", () => {
    expect(parseSettingsText('{"apiKey":"x"}').ok).toBe(true);
  });
});

describe("settingsIssuesFromProblem", () => {
  const problem = (errors: ProblemDetails["errors"]): ProblemDetails => ({
    type: "about:blank",
    title: "x",
    status: 400,
    code: "validation_failed",
    detail: "ENGLISH",
    ...(errors === undefined ? {} : { errors }),
  });

  it("keeps the path and gives each code its friendly reason, secret_not_allowed included", () => {
    expect(
      settingsIssuesFromProblem(
        problem([
          { path: "settings.sender.apiKey", code: "secret_not_allowed" },
          { path: "settings", code: "too_large" },
          { path: "settings.x", code: "brand_new" },
        ]),
      ),
    ).toEqual([
      { path: "settings.sender.apiKey", descriptor: { key: "ship.reason.secret_not_allowed" } },
      { path: "settings", descriptor: { key: "ship.reason.too_large" } },
      { path: "settings.x", descriptor: { key: "errors.generic", code: "brand_new" } },
    ]);
  });

  it("lists at most the bound and none for a problem without errors", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      path: `settings.k${String(i)}`,
      code: "invalid_key",
    }));
    expect(settingsIssuesFromProblem(problem(many))).toHaveLength(MAX_LISTED_ISSUES);
    expect(settingsIssuesFromProblem(problem(undefined))).toEqual([]);
  });
});
