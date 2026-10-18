import { describe, expect, expectTypeOf, it } from "vitest";
import { InvalidResponseError } from "./errors.js";
import { parseResponse, type OperationResponseSpec, type StoreResult } from "./response.js";
import type { Cart } from "./types.js";

const spec: OperationResponseSpec = { successStatuses: [200], context: "GET /store/cart" };

function respond(status: number, body: string | null, contentType: string | null, headers = {}) {
  const init: Record<string, string> = { ...headers };
  if (contentType !== null) init["Content-Type"] = contentType;
  return new Response(body, { status, headers: init });
}

function problem(status: number, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "about:blank",
    title: "Conflict",
    status,
    code: "conflict",
    detail: "Nope.",
    ...extra,
  });
}

describe("parseResponse success", () => {
  it("returns the parsed JSON of a documented success status", async () => {
    const result = await parseResponse(spec, respond(200, '{"a":1}', "application/json"));
    expect(result).toEqual({ ok: true, status: 200, data: { a: 1 } });
  });

  it("accepts a charset parameter and any letter case in the content type", async () => {
    const result = await parseResponse(spec, respond(200, "{}", "Application/JSON; charset=utf-8"));
    expect(result.ok).toBe(true);
  });

  it("handles 204 without a body and without a content type", async () => {
    const result = await parseResponse(
      { successStatuses: [204], context: "POST /store/account/logout" },
      respond(204, null, null),
    );
    expect(result).toEqual({ ok: true, status: 204, data: undefined });
  });

  it("keeps the exact success status (200 or 201)", async () => {
    const both: OperationResponseSpec = {
      successStatuses: [200, 201],
      context: "POST /store/checkout",
    };
    expect((await parseResponse(both, respond(201, "{}", "application/json"))).status).toBe(201);
    expect((await parseResponse(both, respond(200, "{}", "application/json"))).status).toBe(200);
  });

  it("throws when a success status is not documented for the operation", async () => {
    await expect(parseResponse(spec, respond(202, "{}", "application/json"))).rejects.toThrow(
      InvalidResponseError,
    );
    await expect(parseResponse(spec, respond(204, null, null))).rejects.toThrow(
      InvalidResponseError,
    );
  });

  it("throws on a success body that is not JSON content", async () => {
    await expect(parseResponse(spec, respond(200, "<html></html>", "text/html"))).rejects.toThrow(
      InvalidResponseError,
    );
    await expect(parseResponse(spec, respond(200, "{}", null))).rejects.toThrow(
      InvalidResponseError,
    );
    await expect(
      parseResponse(spec, respond(200, "{}", "application/problem+json")),
    ).rejects.toThrow(InvalidResponseError);
  });

  it("throws on invalid JSON declared as JSON", async () => {
    await expect(parseResponse(spec, respond(200, "{oops", "application/json"))).rejects.toThrow(
      InvalidResponseError,
    );
    await expect(parseResponse(spec, respond(200, "", "application/json"))).rejects.toThrow(
      InvalidResponseError,
    );
  });

  it("throws when the JSON is not an object", async () => {
    for (const body of ["null", "[]", '"text"', "5"]) {
      await expect(
        parseResponse(spec, respond(200, body, "application/json")),
        body,
      ).rejects.toThrow(InvalidResponseError);
    }
  });
});

describe("parseResponse problems", () => {
  it("parses application/problem+json into a failure result", async () => {
    const result = await parseResponse(
      spec,
      respond(
        400,
        problem(400, {
          code: "validation_failed",
          errors: [{ path: "email", code: "invalid", message: "Bad" }],
          rule: "r1",
        }),
        "application/problem+json",
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe(400);
    expect(result.problem.code).toBe("validation_failed");
    expect(result.problem.errors).toEqual([{ path: "email", code: "invalid", message: "Bad" }]);
    expect(result.problem.rule).toBe("r1");
    expect(result.retryAfter).toBeNull();
  });

  it("carries the typed cart of cart_changed", async () => {
    const cart: Cart = {
      lines: [],
      subtotal: { amount: 0, currency: "UAH" },
      total: { amount: 0, currency: "UAH" },
      itemCount: 0,
      purchasable: true,
      requiresShipping: false,
      notices: [],
    };
    const result = await parseResponse(
      spec,
      respond(409, problem(409, { code: "cart_changed", cart }), "application/problem+json"),
    );
    if (result.ok) throw new Error("unreachable");
    expect(result.problem.cart).toEqual(cart);
    expectTypeOf(result.problem.cart).toEqualTypeOf<Cart | undefined>();
  });

  it("returns the Retry-After header value of a 429 and a 503", async () => {
    for (const status of [429, 503]) {
      const result = await parseResponse(
        spec,
        respond(
          status,
          problem(status, { code: "too_many_requests" }),
          "application/problem+json",
          {
            "Retry-After": "17",
          },
        ),
      );
      if (result.ok) throw new Error("unreachable");
      expect(result.retryAfter).toBe("17");
    }
  });

  it("returns null for a missing Retry-After", async () => {
    const result = await parseResponse(
      spec,
      respond(429, problem(429), "application/problem+json"),
    );
    if (result.ok) throw new Error("unreachable");
    expect(result.retryAfter).toBeNull();
  });

  it("accepts a charset on the problem content type", async () => {
    const result = await parseResponse(
      spec,
      respond(404, problem(404), "application/problem+json; charset=utf-8"),
    );
    expect(result.ok).toBe(false);
  });

  it("throws on an error status with a non-problem body (a proxy error page, plain JSON, nothing)", async () => {
    await expect(
      parseResponse(spec, respond(502, "<html>Bad Gateway</html>", "text/html")),
    ).rejects.toThrow(InvalidResponseError);
    await expect(
      parseResponse(spec, respond(500, problem(500), "application/json")),
    ).rejects.toThrow(InvalidResponseError);
    await expect(parseResponse(spec, respond(404, null, null))).rejects.toThrow(
      InvalidResponseError,
    );
  });

  it("throws on a problem body that is not valid JSON or lacks the required members", async () => {
    await expect(
      parseResponse(spec, respond(400, "{oops", "application/problem+json")),
    ).rejects.toThrow(InvalidResponseError);
    for (const body of [
      "[]",
      '{"status":400}',
      JSON.stringify({ type: "x", title: "t", status: 400, detail: "d" }),
      JSON.stringify({ type: "x", title: "t", status: 400, code: "c", detail: "d", errors: "no" }),
      JSON.stringify({ type: "x", title: "t", status: 400, code: "c", detail: "d", cart: 1 }),
    ]) {
      await expect(
        parseResponse(spec, respond(400, body, "application/problem+json")),
        body,
      ).rejects.toThrow(InvalidResponseError);
    }
  });

  it("throws on a redirect or an informational status", async () => {
    await expect(parseResponse(spec, respond(302, null, null))).rejects.toThrow(
      InvalidResponseError,
    );
  });

  it("does not put the response body in the error message", async () => {
    try {
      await parseResponse(spec, respond(200, "secret-token-123", "text/plain"));
      expect.unreachable("expected a throw");
    } catch (error) {
      expect(String(error)).not.toContain("secret-token-123");
    }
  });
});

describe("StoreResult", () => {
  it("narrows on ok", () => {
    const result = { ok: true, status: 200, data: 1 } as StoreResult<number>;
    if (result.ok) expectTypeOf(result.data).toEqualTypeOf<number>();
    else expectTypeOf(result.problem.code).toBeString();
  });
});
