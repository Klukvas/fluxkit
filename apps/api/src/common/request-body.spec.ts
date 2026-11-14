import { Body, Logger, Module, Patch } from "@nestjs/common";
import { MARKDOWN_LIMITS } from "@fluxkit/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AdminController } from "../auth/admin-controller.decorator.js";
import { startApp, type RunningApp } from "../test/app.js";
import { http } from "../test/http.js";
import {
  adminJsonBodyLimitBytes,
  DEFAULT_JSON_BODY_LIMIT_BYTES,
  isAdminContentJsonRequest,
} from "./json-body-limit.js";
import type { ProblemBody } from "./problem.filter.js";

const TWO_HUNDRED_KB = JSON.stringify({ padding: "x".repeat(200 * 1024) });
const MAX_UNITS = MARKDOWN_LIMITS.maxLength;

/** A test-only admin route that answers how many characters of body it received (catalog defaults: owner may PATCH). */
@AdminController("body-probe")
class BodyProbeController {
  @Patch()
  echo(@Body() body: { body?: Record<string, string> }): { units: Record<string, number> } {
    return {
      units: Object.fromEntries(
        Object.entries(body.body ?? {}).map(([locale, text]) => [locale, text.length]),
      ),
    };
  }
}

@Module({ controllers: [BodyProbeController] })
class BodyProbeModule {}

/** A two-locale content save: one full-length body per locale. */
function twoLocaleSave(text: string): string {
  return JSON.stringify({ body: { uk: text, en: text } });
}

describe("oversized and malformed request bodies", () => {
  let allowAll: RunningApp;
  let denyAll: RunningApp;

  beforeAll(async () => {
    allowAll = await startApp({
      extraFeatures: [{ name: "body-probe", module: BodyProbeModule }],
    });
    denyAll = await startApp({ adminAuthenticator: "production-default" });
  });

  afterAll(async () => {
    await allowAll.app.close();
    await denyAll.app.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["store", "/store/products"],
    ["customer accounts", "/store/account/register"],
    ["checkout", "/store/checkout"],
    ["admin sign-in", "/admin/auth/login"],
    ["admin sign-in, other case", "/ADMIN/Auth/login"],
  ])(
    "answers a 200 KB JSON body to %s with 413 problem+json and no error log (the 100 kB default)",
    async (_name, path) => {
      const error = vi.spyOn(Logger.prototype, "error");
      const result = await http<ProblemBody>(allowAll.baseUrl, "POST", path, {
        rawBody: TWO_HUNDRED_KB,
      });
      expect(result.status).toBe(413);
      expect(result.headers.get("content-type")).toContain("application/problem+json");
      expect(result.body).toMatchObject({ status: 413, code: "validation_failed" });
      expect(error).not.toHaveBeenCalled();
    },
  );

  it("parses an /admin body up to the admin limit before any guard runs: 401 below it, 413 above it, signed out", async () => {
    const limit = adminJsonBodyLimitBytes(2);
    const below = await http<ProblemBody>(denyAll.baseUrl, "POST", "/admin/brands", {
      rawBody: TWO_HUNDRED_KB,
    });
    expect(below.status).toBe(401);
    const above = await http<ProblemBody>(denyAll.baseUrl, "POST", "/admin/brands", {
      rawBody: JSON.stringify({ padding: "x".repeat(limit) }),
    });
    expect(above.status).toBe(413);
  });

  describe("the admin content limit (blog plan section 8: 40 000 UTF-16 units per content locale)", () => {
    it.each([
      ["Cyrillic (2 bytes per unit)", "ж".repeat(MAX_UNITS)],
      ["emoji (4 bytes per 2 units)", "😀".repeat(MAX_UNITS / 2)],
      ["CJK (3 bytes per unit)", "字".repeat(MAX_UNITS)],
    ])("accepts a two-locale save of full-length %s bodies", async (_name, text) => {
      const result = await http<{ units: Record<string, number> }>(
        allowAll.baseUrl,
        "PATCH",
        "/admin/body-probe",
        { rawBody: twoLocaleSave(text) },
      );
      expect(result.status).toBe(200);
      expect(result.body.units).toEqual({ uk: MAX_UNITS, en: MAX_UNITS });
    });

    it("accepts the worst JSON spelling: every unit as a \\uXXXX escape, in both locales", async () => {
      const escaped = "\\u0436".repeat(MAX_UNITS);
      const raw = `{"body": {"uk": "${escaped}", "en": "${escaped}"}}`;
      expect(raw.length).toBeGreaterThan(450_000);
      const result = await http<{ units: Record<string, number> }>(
        allowAll.baseUrl,
        "PATCH",
        "/admin/body-probe",
        { rawBody: raw },
      );
      expect(result.status).toBe(200);
      expect(result.body.units).toEqual({ uk: MAX_UNITS, en: MAX_UNITS });
    });

    it("still refuses a body above the admin limit with 413", async () => {
      const result = await http<ProblemBody>(allowAll.baseUrl, "PATCH", "/admin/body-probe", {
        rawBody: JSON.stringify({ padding: "x".repeat(adminJsonBodyLimitBytes(2)) }),
      });
      expect(result.status).toBe(413);
      expect(result.body).toMatchObject({ status: 413, code: "validation_failed" });
    });

    it("sizes the limit from the content locales and keeps the default at Express's 100 kB", () => {
      expect(DEFAULT_JSON_BODY_LIMIT_BYTES).toBe(102_400);
      expect(adminJsonBodyLimitBytes(2)).toBe(2 * 40_000 * 6 + 256 * 1024);
      expect(adminJsonBodyLimitBytes(2)).toBeLessThan(1024 * 1024);
      expect(adminJsonBodyLimitBytes(3)).toBeGreaterThan(adminJsonBodyLimitBytes(2));
    });

    it("applies only to JSON bodies of /admin routes outside /admin/auth", () => {
      const request = (url: string, contentType = "application/json") =>
        ({ url, headers: { "content-type": contentType } }) as Parameters<
          typeof isAdminContentJsonRequest
        >[0];
      expect(isAdminContentJsonRequest(request("/admin/blog/posts/1?x=1"))).toBe(true);
      expect(isAdminContentJsonRequest(request("/ADMIN/brands"))).toBe(true);
      expect(isAdminContentJsonRequest(request("/admin", "Application/JSON; charset=utf-8"))).toBe(
        true,
      );
      for (const url of [
        "/admin/auth/login",
        "/Admin/AUTH",
        "/admin-ui/x",
        "/administrator",
        "/store/account/register",
        "/webhooks/payments/fake",
      ]) {
        expect(isAdminContentJsonRequest(request(url)), url).toBe(false);
      }
      expect(isAdminContentJsonRequest(request("/admin/brands", "text/plain"))).toBe(false);
      expect(
        isAdminContentJsonRequest(request("/admin/media/uploads", "application/octet-stream")),
      ).toBe(false);
    });
  });

  it.each(["/store/products", "/admin/brands"])(
    "answers malformed JSON to %s with 400, no error log, no echo",
    async (path) => {
      const error = vi.spyOn(Logger.prototype, "error");
      const result = await http<ProblemBody>(allowAll.baseUrl, "POST", path, {
        rawBody: '{"name": SECRET_BODY_TEXT',
      });
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ status: 400, code: "validation_failed" });
      expect(JSON.stringify(result.body)).not.toContain("SECRET_BODY_TEXT");
      expect(error).not.toHaveBeenCalled();
    },
  );
});
