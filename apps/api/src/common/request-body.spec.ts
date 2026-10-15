import { Logger } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startApp, type RunningApp } from "../test/app.js";
import { http } from "../test/http.js";
import type { ProblemBody } from "./problem.filter.js";

const TWO_HUNDRED_KB = JSON.stringify({ padding: "x".repeat(200 * 1024) });

describe("oversized and malformed request bodies", () => {
  let allowAll: RunningApp;
  let denyAll: RunningApp;

  beforeAll(async () => {
    allowAll = await startApp();
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
    ["admin (allow-all authenticator)", "/admin/brands"],
  ])(
    "answers a 200 KB JSON body to %s with 413 problem+json and no error log",
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

  it("answers an unauthenticated oversized /admin body with 413: the body is parsed before any guard runs", async () => {
    const result = await http<ProblemBody>(denyAll.baseUrl, "POST", "/admin/brands", {
      rawBody: TWO_HUNDRED_KB,
    });
    expect(result.status).toBe(413);
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
