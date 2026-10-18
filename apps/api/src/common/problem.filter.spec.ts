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
  cartChanged,
  cartEmpty,
  checkoutRefused,
  conflict,
  forbidden,
  idempotencyKeyReused,
  inUse,
  invalidTransition,
  notFound,
  ruleViolation,
  serviceUnavailable,
  tooManyOpenOrders,
  tooManyRequests,
  unauthorized,
  validationFailed,
} from "./problem.js";

interface Captured {
  status: number;
  contentType: string;
  body: unknown;
  headers: Record<string, string>;
}

function run(
  exception: unknown,
  request: { method: string; path: string } = { method: "POST", path: "/admin/brands" },
): Captured {
  const captured: Captured = { status: 0, contentType: "", body: undefined, headers: {} };
  const response = {
    setHeader(name: string, value: string) {
      captured.headers[name] = value;
      return response;
    },
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
      too_many_requests: tooManyRequests("Slow down.", 30),
      cart_empty: cartEmpty(),
      cart_changed: cartChanged({ lines: [] }),
      checkout_refused: checkoutRefused([{ path: "lines.0", code: "insufficient_stock" }]),
      idempotency_key_reused: idempotencyKeyReused(),
      too_many_open_orders: tooManyOpenOrders(),
      service_unavailable: serviceUnavailable(),
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

  it("puts the fresh cart of cart_changed into the body, and the lines of checkout_refused into errors", () => {
    const changed = run(cartChanged({ lines: [{ sku: "A" }], subtotal: { amount: 5 } }));
    expect(changed.status).toBe(409);
    expect(changed.body).toMatchObject({
      code: "cart_changed",
      cart: { lines: [{ sku: "A" }], subtotal: { amount: 5 } },
    });
    const refused = run(
      checkoutRefused([
        { path: "lines.1", code: "insufficient_stock" },
        { path: "lines.3", code: "variant_not_sellable" },
      ]),
    );
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      code: "checkout_refused",
      errors: [
        { path: "lines.1", code: "insufficient_stock" },
        { path: "lines.3", code: "variant_not_sellable" },
      ],
    });
  });

  it("answers service_unavailable with 503 and a Retry-After header", () => {
    const result = run(serviceUnavailable(2.2));
    expect(result.status).toBe(503);
    expect(result.contentType).toBe("application/problem+json");
    expect(result.headers["Retry-After"]).toBe("3");
    expect(result.body).toMatchObject({ code: "service_unavailable", status: 503 });
  });

  it("covers every documented problem code", () => {
    expect([...PROBLEM_CODES].sort()).toEqual(
      [
        "cart_changed",
        "cart_empty",
        "checkout_refused",
        "conflict",
        "forbidden",
        "in_use",
        "idempotency_key_reused",
        "internal_error",
        "invalid_transition",
        "not_found",
        "rule_violation",
        "service_unavailable",
        "too_many_open_orders",
        "too_many_requests",
        "unauthorized",
        "validation_failed",
      ].sort(),
    );
  });

  it("answers too_many_requests with 429 and a Retry-After header in whole seconds", () => {
    const result = run(tooManyRequests("Too many login attempts.", 42));
    expect(result.status).toBe(429);
    expect(result.contentType).toBe("application/problem+json");
    expect(result.headers).toEqual({ "Retry-After": "42", "Cache-Control": "no-store" });
    expect(result.body).toEqual({
      type: "about:blank",
      title: "Too many requests",
      status: 429,
      code: "too_many_requests",
      detail: "Too many login attempts.",
    });
  });

  it("sends no extra headers for other problems except no-store on /admin", () => {
    expect(run(forbidden(), { method: "GET", path: "/store/products" }).headers).toEqual({});
    expect(run(forbidden()).headers).toEqual({ "Cache-Control": "no-store" });
  });

  it("marks admin errors no-store whatever their kind, case-insensitively, and nothing else", () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const cases: [string, unknown][] = [
      ["/admin/x", unauthorized()],
      ["/ADMIN/x", new NotFoundException()],
      ["/admin", new Error("boom")],
      ["/admin/", new BadRequestException()],
    ];
    for (const [path, error] of cases) {
      expect(run(error, { method: "GET", path }).headers["Cache-Control"], path).toBe("no-store");
    }
    for (const path of ["/store/x", "/health", "/administrator", "/"]) {
      expect(run(new Error("boom"), { method: "GET", path }).headers, path).toEqual({});
    }
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

  describe("a query error whose cause is not a pg.DatabaseError (network loss, pool timeout)", () => {
    const HASH = "scrypt$32768$8$1$c2FsdA$aGFzaA";
    const SQL_TEXT = 'select "id", "password_hash" from "admin_user" where "email" = $1';

    function loggedFor(error: unknown): string {
      const logged = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      expect(run(error, { method: "POST", path: "/admin/auth/login" }).status).toBe(500);
      expect(logged).toHaveBeenCalledTimes(1);
      return [...logged.mock.calls.flat().map(String)].join("\n");
    }

    function expectRedacted(text: string): void {
      expect(text).not.toContain("victim@example.com");
      expect(text).not.toContain(HASH);
      expect(text).not.toContain("Failed query");
      expect(text).not.toContain("admin_user");
      expect(text).not.toMatch(/select |params/i);
      expect(text).toContain("POST /admin/auth/login");
    }

    it("logs neither SQL, email nor hash for a DrizzleQueryError over a plain Error", () => {
      const cause = new Error("Connection terminated unexpectedly");
      const text = loggedFor(new DrizzleQueryError(SQL_TEXT, ["victim@example.com", HASH], cause));
      expectRedacted(text);
      expect(text).toContain("DrizzleQueryError");
      expect(text).toContain("Error");
    });

    it("logs the innermost cause name and code", () => {
      const network = Object.assign(new Error("read ECONNRESET victim@example.com"), {
        code: "ECONNRESET",
      });
      const text = loggedFor(
        new DrizzleQueryError(SQL_TEXT, ["victim@example.com", HASH], network),
      );
      expectRedacted(text);
      expect(text).toContain("ECONNRESET");
    });

    it("recognizes a wrapper by its message even when it is not a DrizzleQueryError", () => {
      const text = loggedFor(
        new Error(`Failed query: ${SQL_TEXT}\nparams: victim@example.com,${HASH}`),
      );
      expectRedacted(text);
    });

    it("recognizes an error that carries query and params properties", () => {
      const text = loggedFor(
        Object.assign(new Error("something went wrong for victim@example.com"), {
          query: SQL_TEXT,
          params: ["victim@example.com", HASH],
        }),
      );
      expectRedacted(text);
    });
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
