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

describe("assertCsrfSafe messages by scope", () => {
  function messageOf(call: () => void): string {
    try {
      call();
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error("expected a throw");
  }

  it("names the admin by default (unchanged) and the store when asked", () => {
    expect(messageOf(() => assertCsrfSafe(request("POST")))).toBe(
      "State-changing admin requests must send the header X-Fluxkit-CSRF: 1.",
    );
    expect(messageOf(() => assertCsrfSafe(request("POST"), "store"))).toBe(
      "State-changing store requests must send the header X-Fluxkit-CSRF: 1.",
    );
    expect(
      messageOf(() => assertCsrfSafe(request("POST", { ...OK, "content-length": "2" }), "store")),
    ).toBe("State-changing store requests with a body must use Content-Type: application/json.");
  });

  it("applies the same rules to the store: exempt safe methods, header and JSON required", () => {
    expect(() => assertCsrfSafe(request("GET"), "store")).not.toThrow();
    expect(() => assertCsrfSafe(request("DELETE", OK), "store")).not.toThrow();
    expect(() => assertCsrfSafe(request("PATCH"), "store")).toThrowError(
      expect.objectContaining({ code: "forbidden" }) as Error,
    );
  });
});

describe("the binary upload exception (ADR 0028 decision 4)", () => {
  const BINARY = { acceptsBinaryUpload: true } as const;
  const body = (contentType?: string): Record<string, string> => ({
    ...OK,
    "content-length": "10",
    ...(contentType === undefined ? {} : { "content-type": contentType }),
  });

  it("accepts application/octet-stream only with the option, compared like the JSON type", () => {
    for (const contentType of [
      "application/octet-stream",
      "Application/Octet-Stream",
      "application/octet-stream; foo=bar",
      " application/octet-stream ",
    ]) {
      expect(
        () => assertCsrfSafe(request("POST", body(contentType)), "admin", BINARY),
        contentType,
      ).not.toThrow();
      expect(() => assertCsrfSafe(request("POST", body(contentType))), contentType).toThrowError(
        expect.objectContaining({ code: "forbidden" }) as Error,
      );
    }
  });

  it("refuses every other content type on the upload route, JSON included", () => {
    for (const contentType of [
      "multipart/form-data; boundary=x",
      "text/plain",
      "application/x-www-form-urlencoded",
      "image/jpeg",
      "image/png",
      "application/json",
      "application/octet-streamx",
      "application/octet",
      "octet-stream",
      undefined,
    ]) {
      expect(
        () => assertCsrfSafe(request("POST", body(contentType)), "admin", BINARY),
        String(contentType),
      ).toThrowError(expect.objectContaining({ code: "forbidden" }) as Error);
    }
  });

  it("treats a chunked body as a body on the upload route too", () => {
    expect(() =>
      assertCsrfSafe(
        request("POST", { ...OK, "transfer-encoding": "chunked", "content-type": "text/plain" }),
        "admin",
        BINARY,
      ),
    ).toThrowError(expect.objectContaining({ code: "forbidden" }) as Error);
  });

  it("still requires the CSRF header with an octet-stream body", () => {
    expect(() =>
      assertCsrfSafe(
        request("POST", { "content-length": "10", "content-type": "application/octet-stream" }),
        "admin",
        BINARY,
      ),
    ).toThrowError(expect.objectContaining({ code: "forbidden" }) as Error);
    expect(() =>
      assertCsrfSafe(
        request("POST", {
          "x-fluxkit-csrf": "true",
          "content-length": "10",
          "content-type": "application/octet-stream",
        }),
        "admin",
        BINARY,
      ),
    ).toThrowError(expect.objectContaining({ code: "forbidden" }) as Error);
  });

  it("says which content type the upload route needs", () => {
    let message = "";
    try {
      assertCsrfSafe(request("POST", body("image/png")), "admin", BINARY);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(
      "This upload route needs Content-Type: application/octet-stream with the header X-Fluxkit-CSRF: 1.",
    );
  });

  it("is off by default and when the option is false", () => {
    expect(() =>
      assertCsrfSafe(request("POST", body("application/octet-stream")), "admin", {
        acceptsBinaryUpload: false,
      }),
    ).toThrowError(expect.objectContaining({ code: "forbidden" }) as Error);
    expect(() =>
      assertCsrfSafe(request("POST", body("application/octet-stream")), "store"),
    ).toThrowError(expect.objectContaining({ code: "forbidden" }) as Error);
  });
});
