import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  type ArgumentsHost,
} from "@nestjs/common";
import { DrizzleQueryError } from "drizzle-orm";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProblemDetailsFilter, type ProblemBody } from "./problem.filter.js";
import {
  PROBLEM_CODES,
  PROBLEM_STATUS,
  conflict,
  forbidden,
  inUse,
  invalidTransition,
  notFound,
  ruleViolation,
  unauthorized,
  validationFailed,
} from "./problem.js";

interface Captured {
  status: number;
  contentType: string;
  body: unknown;
}

function run(
  exception: unknown,
  request: { method: string; path: string } = { method: "POST", path: "/admin/brands" },
): Captured {
  const captured: Captured = { status: 0, contentType: "", body: undefined };
  const response = {
    status(status: number) {
      captured.status = status;
      return response;
    },
    type(contentType: string) {
      captured.contentType = contentType;
      return response;
    },
    json(body: unknown) {
      captured.body = body;
      return response;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  new ProblemDetailsFilter().catch(exception, host);
  return captured;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProblemDetailsFilter", () => {
  it("answers every code with application/problem+json and the status of the code", () => {
    const samples = {
      validation_failed: validationFailed([{ path: "name.uk", code: "required" }]),
      unauthorized: unauthorized(),
      forbidden: forbidden(),
      not_found: notFound("Brand"),
      conflict: conflict("Taken.", { field: "slug", constraint: "brand_slug_key" }),
      in_use: inUse("Used.", { constraint: "product_brand_id_fkey" }),
      invalid_transition: invalidTransition("Cannot publish.", "no_default_variant"),
      rule_violation: ruleViolation("Not allowed.", "product_type_change_forbidden"),
    } as const;
    for (const [code, exception] of Object.entries(samples)) {
      const result = run(exception);
      const body = result.body as ProblemBody;
      expect(result.contentType).toBe("application/problem+json");
      expect(result.status).toBe(PROBLEM_STATUS[code as keyof typeof PROBLEM_STATUS]);
      expect(body).toMatchObject({ type: "about:blank", status: result.status, code });
      expect(typeof body.title).toBe("string");
      expect(typeof body.detail).toBe("string");
    }
  });

  it("covers every documented problem code", () => {
    expect([...PROBLEM_CODES].sort()).toEqual(
      [
        "conflict",
        "forbidden",
        "in_use",
        "internal_error",
        "invalid_transition",
        "not_found",
        "rule_violation",
        "unauthorized",
        "validation_failed",
      ].sort(),
    );
  });

  it("answers forbidden with 403 and keeps the caller's detail", () => {
    const result = run(forbidden("Your role may not do this."));
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({
      status: 403,
      code: "forbidden",
      title: "Forbidden",
      detail: "Your role may not do this.",
    });
  });

  it("maps a framework 403 to forbidden without leaking its message", () => {
    const result = run(new ForbiddenException("secret guard internals"));
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: "forbidden" });
    expect(JSON.stringify(result.body)).not.toContain("secret guard internals");
  });

  it("includes errors[] and the extension members when given", () => {
    const { body } = run(validationFailed([{ path: "attributes.size", code: "required" }]));
    expect(body).toMatchObject({
      code: "validation_failed",
      errors: [{ path: "attributes.size", code: "required" }],
    });
    expect(
      run(conflict("Taken.", { field: "slug", constraint: "brand_slug_key" })).body,
    ).toMatchObject({
      field: "slug",
      constraint: "brand_slug_key",
    });
    expect(run(ruleViolation("No.", "some_rule")).body).toMatchObject({ rule: "some_rule" });
  });

  it("maps framework HTTP errors without leaking their messages", () => {
    const missing = run(new NotFoundException("Cannot GET /nope"));
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: "not_found" });
    expect(JSON.stringify(missing.body)).not.toContain("Cannot GET");

    const malformed = run(new BadRequestException("Unexpected token } in JSON at position 5"));
    expect(malformed.status).toBe(400);
    expect(malformed.body).toMatchObject({ code: "validation_failed" });
    expect(JSON.stringify(malformed.body)).not.toContain("position 5");

    const tooLarge = run(new PayloadTooLargeException());
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body).toMatchObject({ code: "validation_failed", status: 413 });
  });

  it("logs unexpected errors in full and answers a bare internal_error", () => {
    const logged = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const failure = new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2");
    const result = run(failure);
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ code: "internal_error", status: 500 });
    expect(JSON.stringify(result.body)).not.toMatch(/ECONNREFUSED|hunter2|10\.0\.0\.5|stack/);
    expect(logged).toHaveBeenCalledTimes(1);
    const [message, stack] = logged.mock.calls[0] ?? [];
    expect(String(message)).toContain("ECONNREFUSED");
    expect(String(message)).toContain("POST /admin/brands");
    // Only our own frames: the stack header repeats the message and is left out.
    expect(String(stack)).toMatch(/^\s+at /);
    expect(String(stack)).not.toContain("ECONNREFUSED");
  });

  it("treats non-Error throwables as internal errors too", () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    expect(run("boom").body).toMatchObject({ code: "internal_error" });
  });

  it("translates database constraint errors by constraint name", () => {
    const duplicate = new pg.DatabaseError(
      "duplicate key value violates unique constraint",
      0,
      "error",
    );
    duplicate.code = "23505";
    duplicate.constraint = "brand_slug_key";
    const result = run(new Error("Failed query", { cause: duplicate }));
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      code: "conflict",
      field: "slug",
      constraint: "brand_slug_key",
    });
    expect(JSON.stringify(result.body)).not.toContain("duplicate key value");
  });

  it("keeps the documented body of an explicit 5xx HttpException (GET /health)", () => {
    const result = run(
      new ServiceUnavailableException({ status: "error", database: "unreachable" }),
    );
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ status: "error", database: "unreachable" });
  });
});

describe("ProblemDetailsFilter logging", () => {
  function databaseError(): DrizzleQueryError {
    const cause = new pg.DatabaseError('syntax error at or near "SECRET_TOKEN"', 0, "error");
    cause.code = "42601";
    cause.table = "brand";
    cause.column = "name";
    cause.constraint = "brand_name_check";
    return new DrizzleQueryError(
      "insert into brand (name) values ($1) /* SQL_TEXT_MARKER */",
      ["PARAM_VALUE_MARKER"],
      cause,
    );
  }

  function everythingLogged(spy: { mock: { calls: unknown[][] } }): string {
    return spy.mock.calls.flat().map(String).join("\n");
  }

  it("logs a database error without SQL text, bound parameters or the driver message", () => {
    const logged = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const result = run(databaseError());
    expect(result.status).toBe(500);
    expect(logged).toHaveBeenCalledTimes(1);
    const text = everythingLogged(logged);
    expect(text).toContain("DrizzleQueryError");
    expect(text).toContain("42601");
    expect(text).toContain("brand_name_check");
    expect(text).toContain("POST /admin/brands");
    expect(text).not.toMatch(
      /SQL_TEXT_MARKER|PARAM_VALUE_MARKER|SECRET_TOKEN|insert into|Failed query/,
    );
  });

  it("escapes control characters in the request line and in logged messages", () => {
    const logged = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    run(new Error("line one\nFORGED LOG LINE\u0000"), {
      method: "GET\r",
      path: "/store/products/a\nFORGED\u0000\u007f",
    });
    run(databaseError(), { method: "GET", path: "/x\nFORGED\u0000" });
    expect(logged).toHaveBeenCalledTimes(2);
    for (const [message, stack] of logged.mock.calls) {
      expect(
        Array.from(String(message)).some(
          (c) => c.charCodeAt(0) <= 0x1f || c.charCodeAt(0) === 0x7f,
        ),
      ).toBe(false);
      const lines = String(stack ?? "").split("\n");
      expect(lines.every((line) => line === "" || /^\s+at /.test(line))).toBe(true);
    }
    expect(everythingLogged(logged)).toContain("FORGED");
  });

  it.each([
    ["entity.too.large", 413],
    ["entity.parse.failed", 400],
    ["charset.unsupported", 415],
  ])(
    "maps body-parser error %s to a %i problem and logs a warning, not an error",
    (type, status) => {
      const error = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      const parserError = Object.assign(new SyntaxError("Unexpected token in SECRET_BODY"), {
        type,
        status,
        statusCode: status,
        expose: true,
        body: "SECRET_BODY",
      });
      const result = run(parserError);
      expect(result.status).toBe(status);
      expect(result.contentType).toBe("application/problem+json");
      expect(result.body).toMatchObject({ status, code: "validation_failed" });
      expect(JSON.stringify(result.body)).not.toContain("SECRET_BODY");
      expect(error).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(everythingLogged(warn)).not.toContain("SECRET_BODY");
      expect(everythingLogged(warn)).toContain(type);
    },
  );

  it("keeps a status-carrying 5xx error an internal error", () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    expect(run(Object.assign(new Error("upstream"), { status: 502 })).status).toBe(500);
  });
});
