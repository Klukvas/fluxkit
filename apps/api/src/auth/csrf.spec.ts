import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { assertCsrfSafe } from "./csrf.js";

function request(method: string, headers: Record<string, string> = {}): Request {
  return {
    method,
    get: (name: string) => headers[name.toLowerCase()],
    headers,
  } as unknown as Request;
}

const OK = { "x-fluxkit-csrf": "1" };

describe("assertCsrfSafe", () => {
  it.each(["GET", "HEAD", "OPTIONS", "get"])("exempts %s", (method) => {
    expect(() => assertCsrfSafe(request(method))).not.toThrow();
    expect(() =>
      assertCsrfSafe(request(method, { "content-length": "5", "content-type": "text/plain" })),
    ).not.toThrow();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "post", "PROPFIND"])(
    "requires the header on %s",
    (method) => {
      expect(() => assertCsrfSafe(request(method))).toThrowError(
        expect.objectContaining({ code: "forbidden" }) as Error,
      );
      expect(() => assertCsrfSafe(request(method, OK))).not.toThrow();
    },
  );

  it.each(["0", "2", "true", "", " 1", "1, 1", "yes"])("rejects the header value %j", (value) => {
    expect(() => assertCsrfSafe(request("POST", { "x-fluxkit-csrf": value }))).toThrowError(
      expect.objectContaining({ code: "forbidden" }) as Error,
    );
  });

  it("requires application/json when there is a body", () => {
    for (const contentType of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
      "application/jsonp",
      "application/json-patch+json",
      undefined,
    ]) {
      const headers: Record<string, string> = { ...OK, "content-length": "10" };
      if (contentType !== undefined) headers["content-type"] = contentType;
      expect(() => assertCsrfSafe(request("POST", headers)), String(contentType)).toThrowError(
        expect.objectContaining({ code: "forbidden" }) as Error,
      );
    }
  });

  it("treats a chunked body as a body", () => {
    expect(() =>
      assertCsrfSafe(request("POST", { ...OK, "transfer-encoding": "chunked" })),
    ).toThrowError(expect.objectContaining({ code: "forbidden" }) as Error);
  });

  it("accepts application/json with parameters and any case", () => {
    for (const contentType of [
      "application/json",
      "application/json; charset=utf-8",
      "Application/JSON",
    ]) {
      expect(() =>
        assertCsrfSafe(
          request("PATCH", { ...OK, "content-length": "2", "content-type": contentType }),
        ),
      ).not.toThrow();
    }
  });

  it("does not demand a content type for an empty body", () => {
    expect(() => assertCsrfSafe(request("DELETE", { ...OK, "content-length": "0" }))).not.toThrow();
    expect(() =>
      assertCsrfSafe(request("POST", { ...OK, "content-type": "text/plain" })),
    ).not.toThrow();
  });
});
