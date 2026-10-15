import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../common/problem.filter.js";
import { startApp, type RunningApp } from "../test/app.js";
import { http } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import { SOME_ID } from "../test/routes.js";

describe("admin CSRF protection and CORS", () => {
  let signedIn: RunningApp;
  let anonymous: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    signedIn = await startApp();
    anonymous = await startApp({ adminAuthenticator: "production-default" });
  });

  afterAll(async () => {
    await signedIn.app.close();
    await anonymous.app.close();
  });

  it("rejects POST, PUT, PATCH and DELETE without the header with 403 forbidden", async () => {
    for (const [method, path] of [
      ["POST", "/admin/brands"],
      ["PUT", `/admin/products/${SOME_ID}/categories`],
      ["PATCH", `/admin/brands/${SOME_ID}`],
      ["DELETE", `/admin/brands/${SOME_ID}`],
    ] as const) {
      const result = await http<ProblemBody>(signedIn.baseUrl, method, path, {
        body: method === "DELETE" ? undefined : {},
        csrf: false,
      });
      expect(result.status, `${method} ${path}`).toBe(403);
      expect(result.headers.get("content-type")).toContain("application/problem+json");
      expect(result.body).toMatchObject({ code: "forbidden", status: 403 });
      expect(result.body.detail).toContain("X-Fluxkit-CSRF");
    }
  });

  it.each(["0", "2", "true", "yes", ""])("rejects the header value %j", async (value) => {
    const result = await http<ProblemBody>(signedIn.baseUrl, "POST", "/admin/brands", {
      body: {},
      headers: { "x-fluxkit-csrf": value },
    });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: "forbidden" });
  });

  it.each([
    ["text/plain", "text/plain"],
    ["form-urlencoded", "application/x-www-form-urlencoded"],
    ["multipart", "multipart/form-data; boundary=x"],
    ["no content type", null],
  ])("rejects a body sent as %s", async (_name, contentType) => {
    const result = await http<ProblemBody>(signedIn.baseUrl, "POST", "/admin/brands", {
      rawBody: '{"code":"x"}',
      contentType,
    });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: "forbidden" });
    expect(result.body.detail).toContain("application/json");
  });

  it("does not create anything when rejected", async () => {
    const before = await http<{ total: number }>(signedIn.baseUrl, "GET", "/admin/brands");
    await http(signedIn.baseUrl, "POST", "/admin/brands", {
      rawBody: JSON.stringify({ name: { uk: "csrf-spec-nope", en: "csrf-spec-nope" } }),
      csrf: false,
    });
    const after = await http<{ total: number }>(signedIn.baseUrl, "GET", "/admin/brands");
    expect(after.body.total).toBe(before.body.total);
  });

  it("exempts GET and HEAD", async () => {
    expect((await http(signedIn.baseUrl, "GET", "/admin/brands", { csrf: false })).status).toBe(
      200,
    );
    const head = await fetch(`${signedIn.baseUrl}/admin/brands`, { method: "HEAD" });
    expect(head.status).toBe(200);
  });

  it("lets a request with the header and JSON through to validation", async () => {
    const result = await http<ProblemBody>(signedIn.baseUrl, "POST", "/admin/brands", { body: {} });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: "validation_failed" });
  });

  it("accepts a JSON content type with a charset and any case", async () => {
    for (const contentType of ["application/json; charset=utf-8", "Application/JSON"]) {
      const result = await http<ProblemBody>(signedIn.baseUrl, "POST", "/admin/brands", {
        rawBody: "{}",
        contentType,
      });
      expect(result.status, contentType).toBe(400);
    }
  });

  it("accepts a bodiless state-changing request with the header (lifecycle actions)", async () => {
    const result = await http<ProblemBody>(
      signedIn.baseUrl,
      "POST",
      `/admin/products/${SOME_ID}/publish`,
    );
    expect(result.status).toBe(404);
  });

  it("checks CSRF before authentication: anonymous without header is 403, with header 401", async () => {
    const without = await http<ProblemBody>(anonymous.baseUrl, "POST", "/admin/brands", {
      body: {},
      csrf: false,
    });
    expect(without.status).toBe(403);
    expect(without.body).toMatchObject({ code: "forbidden" });
    const withHeader = await http<ProblemBody>(anonymous.baseUrl, "POST", "/admin/brands", {
      body: {},
    });
    expect(withHeader.status).toBe(401);
  });

  it("does not require the header outside /admin", async () => {
    const result = await http(signedIn.baseUrl, "POST", "/store/products", {
      csrf: false,
      body: {},
    });
    expect(result.status).not.toBe(403);
  });

  it("sends no CORS headers on any admin response, nor on a preflight", async () => {
    const origin = "https://evil.example";
    const responses = [
      await fetch(`${signedIn.baseUrl}/admin/brands`, { headers: { origin } }),
      await fetch(`${anonymous.baseUrl}/admin/brands`, { headers: { origin } }),
      await fetch(`${signedIn.baseUrl}/admin/brands`, {
        method: "POST",
        headers: { origin, "content-type": "text/plain" },
        body: "x",
      }),
      await fetch(`${signedIn.baseUrl}/admin/brands`, {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "x-fluxkit-csrf,content-type",
        },
      }),
    ];
    expect(responses.map((response) => response.status)).toEqual(
      expect.arrayContaining([200, 401, 403]),
    );
    for (const response of responses) {
      const corsHeaders = [...response.headers.keys()].filter((name) =>
        name.toLowerCase().startsWith("access-control-"),
      );
      expect(corsHeaders, `${response.status}`).toEqual([]);
    }
  });
});
