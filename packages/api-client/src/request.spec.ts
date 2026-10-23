import { describe, expect, it } from "vitest";
import { InvalidRequestError } from "./errors.js";
import { buildRequest, type HttpMethod, type RequestInput } from "./request.js";

function build(overrides: Partial<RequestInput> = {}) {
  return buildRequest({ baseUrl: "", method: "GET", path: "/store/cart", ...overrides });
}

describe("buildRequest headers", () => {
  it("sends no CSRF header and no content type on GET and HEAD", () => {
    for (const method of ["GET", "HEAD"] as const) {
      const { init } = build({ method });
      expect(init.method).toBe(method);
      expect(init.headers.has("X-Fluxkit-CSRF")).toBe(false);
      expect(init.headers.has("Content-Type")).toBe(false);
      expect(init.body).toBeUndefined();
    }
  });

  it("sends X-Fluxkit-CSRF: 1 on every state-changing method, with or without a body", () => {
    const methods: HttpMethod[] = ["POST", "PUT", "PATCH", "DELETE"];
    for (const method of methods) {
      expect(build({ method }).init.headers.get("X-Fluxkit-CSRF")).toBe("1");
      expect(build({ method, body: { a: 1 } }).init.headers.get("X-Fluxkit-CSRF")).toBe("1");
    }
  });

  it("sends a JSON content type only when there is a body", () => {
    const withBody = build({ method: "POST", body: { quantity: 2 } });
    expect(withBody.init.headers.get("Content-Type")).toBe("application/json");
    expect(withBody.init.body).toBe('{"quantity":2}');

    const withoutBody = build({ method: "POST" });
    expect(withoutBody.init.headers.has("Content-Type")).toBe(false);
    expect(withoutBody.init.body).toBeUndefined();
  });

  it("refuses a body on GET and HEAD instead of dropping it", () => {
    expect(() => build({ method: "GET", body: {} })).toThrow(InvalidRequestError);
    expect(() => build({ method: "HEAD", body: {} })).toThrow(InvalidRequestError);
  });

  it("does not let a caller header override the CSRF header or the content type", () => {
    const { init } = build({
      method: "POST",
      body: {},
      headers: { "x-fluxkit-csrf": "0", "CONTENT-TYPE": "text/plain", "Idempotency-Key": "k-1" },
    });
    expect(init.headers.get("X-Fluxkit-CSRF")).toBe("1");
    expect(init.headers.get("Content-Type")).toBe("application/json");
    expect(init.headers.get("Idempotency-Key")).toBe("k-1");
  });

  it("asks for JSON and sends cookies to the same origin only", () => {
    const { init } = build();
    expect(init.headers.get("Accept")).toBe("application/json, application/problem+json");
    expect(init.credentials).toBe("same-origin");
  });

  it("passes the abort signal and extra fetch options but never lets them replace the request itself", () => {
    const controller = new AbortController();
    const { init } = build({
      method: "POST",
      body: { a: 1 },
      signal: controller.signal,
      fetchOptions: {
        next: { revalidate: 60 },
        method: "GET",
        credentials: "include",
        body: "evil",
        headers: { "X-Fluxkit-CSRF": "0" },
      },
    });
    expect(init.signal).toBe(controller.signal);
    expect((init as unknown as Record<string, unknown>).next).toEqual({ revalidate: 60 });
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBe('{"a":1}');
    expect(init.headers.get("X-Fluxkit-CSRF")).toBe("1");
  });
});

describe("buildRequest raw (binary) body", () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const rawBody = { bytes, contentType: "application/octet-stream" } as const;

  it("passes the bytes through untouched with an octet-stream content type and the CSRF header", () => {
    const { init } = build({ method: "POST", path: "/admin/media/uploads", rawBody });
    expect(init.body).toBe(bytes);
    expect(init.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(init.headers.get("X-Fluxkit-CSRF")).toBe("1");
    expect(init.credentials).toBe("same-origin");
  });

  it("accepts a Blob and an ArrayBuffer and never sets Content-Length (fetch computes it)", () => {
    const blob = new Blob([bytes], { type: "image/jpeg" });
    const buffer = new ArrayBuffer(4);
    for (const given of [blob, buffer]) {
      const { init } = build({
        method: "POST",
        rawBody: { bytes: given, contentType: "application/octet-stream" },
      });
      expect(init.body).toBe(given);
      expect(init.headers.get("Content-Type")).toBe("application/octet-stream");
      expect(init.headers.has("Content-Length")).toBe(false);
    }
  });

  it("does not let a caller header replace the content type, the CSRF header or Content-Length", () => {
    const { init } = build({
      method: "POST",
      rawBody,
      headers: {
        "content-type": "application/json",
        "x-fluxkit-csrf": "0",
        "Content-Length": "999",
      },
    });
    expect(init.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(init.headers.get("X-Fluxkit-CSRF")).toBe("1");
    expect(init.headers.has("Content-Length")).toBe(false);
  });

  it("refuses a raw body together with a JSON body, and on GET and HEAD", () => {
    expect(() => build({ method: "POST", body: {}, rawBody })).toThrow(InvalidRequestError);
    expect(() => build({ method: "GET", rawBody })).toThrow(InvalidRequestError);
    expect(() => build({ method: "HEAD", rawBody })).toThrow(InvalidRequestError);
  });

  it("keeps the JSON path unchanged when there is no raw body", () => {
    const { init } = build({ method: "POST", body: { a: 1 } });
    expect(init.headers.get("Content-Type")).toBe("application/json");
    expect(init.body).toBe('{"a":1}');
  });

  it("passes the abort signal", () => {
    const controller = new AbortController();
    const { init } = build({ method: "POST", rawBody, signal: controller.signal });
    expect(init.signal).toBe(controller.signal);
  });
});

describe("buildRequest URL", () => {
  it("is relative for an empty base URL (the browser, one origin)", () => {
    expect(build().url).toBe("/store/cart");
  });

  it("joins an absolute origin and ignores a trailing slash", () => {
    expect(build({ baseUrl: "http://api.internal:3000" }).url).toBe(
      "http://api.internal:3000/store/cart",
    );
    expect(build({ baseUrl: "https://api.internal/" }).url).toBe("https://api.internal/store/cart");
  });

  it("rejects a base URL that is not empty or an http(s) origin", () => {
    for (const baseUrl of [
      "api.internal",
      "ftp://api",
      "http://api/store",
      "http://api?x=1",
      " ",
    ]) {
      expect(() => build({ baseUrl }), baseUrl).toThrow(InvalidRequestError);
    }
  });

  it("encodes path parameters as single segments", () => {
    const { url } = build({
      path: "/store/products/{slug}",
      pathParams: { slug: "a/b c?d#e%f ü" },
    });
    expect(url).toBe("/store/products/a%2Fb%20c%3Fd%23e%25f%20%C3%BC");
  });

  it("fills several path parameters", () => {
    const { url } = build({
      path: "/store/{a}/x/{b}",
      pathParams: { a: "1", b: "2" },
    });
    expect(url).toBe("/store/1/x/2");
  });

  it("rejects a missing, empty or dot-segment path parameter", () => {
    expect(() => build({ path: "/store/products/{slug}" })).toThrow(InvalidRequestError);
    expect(() => build({ path: "/store/products/{slug}", pathParams: { slug: "" } })).toThrow(
      InvalidRequestError,
    );
    for (const slug of [".", ".."]) {
      expect(() => build({ path: "/store/products/{slug}", pathParams: { slug } }), slug).toThrow(
        InvalidRequestError,
      );
    }
  });

  it("builds a query string, skips undefined values and encodes keys and values", () => {
    const { url } = build({
      path: "/store/products",
      query: { brand: "a&b=c d", category: undefined, limit: 20, offset: 0, "k#": "é+/" },
    });
    expect(url).toBe("/store/products?brand=a%26b%3Dc%20d&limit=20&offset=0&k%23=%C3%A9%2B%2F");
  });

  it("adds no question mark for an empty query", () => {
    expect(build({ query: {} }).url).toBe("/store/cart");
    expect(build({ query: { locale: undefined } }).url).toBe("/store/cart");
  });
});
