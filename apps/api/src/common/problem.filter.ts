import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from "@nestjs/common";
import { DrizzleQueryError } from "drizzle-orm";
import type { Request, Response } from "express";
import pg from "pg";
import { markAdminResponseUncacheable } from "./admin-path.js";
import { errorCode, innermostCause } from "./error-summary.js";
import { translatePostgresError } from "./postgres-errors.js";
import {
  PROBLEM_STATUS,
  PROBLEM_TITLE,
  ProblemException,
  type FieldError,
  type ProblemCode,
  type ProblemExtensions,
} from "./problem.js";
import {
  markStoreAccountResponseUncacheable,
  markStoreCartResponseUncacheable,
  markStoreOrderResponseUncacheable,
  markStoreShippingResponseUncacheable,
} from "./store-path.js";

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/** The response body: RFC 9457 members plus `code`, `errors` and the extension members. */
export interface ProblemBody {
  type: "about:blank";
  title: string;
  status: number;
  code: ProblemCode;
  detail: string;
  errors?: readonly FieldError[];
  field?: string;
  constraint?: string;
  rule?: string;
  /** Members of the codes that document them: `cart` of `cart_changed`. */
  [member: string]: unknown;
}

const CODE_BY_HTTP_STATUS: Readonly<Record<number, ProblemCode>> = {
  400: "validation_failed",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  429: "too_many_requests",
};

const GENERIC_DETAIL: Readonly<Record<number, string>> = {
  401: "Authentication is required.",
  403: "You do not have permission to do this.",
  404: "The requested resource was not found.",
  409: "The request conflicts with the current state.",
  413: "The request body is too large.",
};
const DEFAULT_CLIENT_DETAIL = "The request could not be understood.";

export function buildProblemBody(
  code: ProblemCode,
  status: number,
  detail: string,
  errors?: readonly FieldError[],
  extensions: ProblemExtensions = {},
  members: Readonly<Record<string, unknown>> = {},
): ProblemBody {
  return {
    type: "about:blank",
    title: PROBLEM_TITLE[code],
    status,
    code,
    detail,
    ...(errors === undefined ? {} : { errors }),
    ...extensions,
    ...members,
  };
}

/**
 * Every error leaves the API as `application/problem+json`. Known problems are passed through; framework HTTP
 * errors (unknown route, malformed JSON) get a generic message; database constraint errors are translated by
 * constraint name; anything else is logged in full and answered with a bare `internal_error`.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger("ProblemDetails");

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    markAdminResponseUncacheable(request, response);
    markStoreAccountResponseUncacheable(request, response);
    markStoreCartResponseUncacheable(request, response);
    markStoreOrderResponseUncacheable(request, response);
    markStoreShippingResponseUncacheable(request, response);
    if (
      exception instanceof HttpException &&
      !(exception instanceof ProblemException) &&
      exception.getStatus() >= 500
    ) {
      // An explicit 5xx HttpException (GET /health answers 503 with its documented body) was written by a developer
      // on purpose and logs its own cause, so its status and body are kept. Unexpected errors never reach this branch.
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    const body = this.toBody(translatePostgresError(exception), request);
    if (exception instanceof ProblemException) {
      for (const [name, value] of Object.entries(exception.headers)) {
        response.setHeader(name, value);
      }
    }
    response.status(body.status).type(PROBLEM_CONTENT_TYPE).json(body);
  }

  private toBody(exception: unknown, request: Request): ProblemBody {
    if (exception instanceof ProblemException) {
      return buildProblemBody(
        exception.code,
        exception.getStatus(),
        exception.detail,
        exception.errors,
        exception.extensions,
        exception.members,
      );
    }
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      const status = exception.getStatus();
      // Statuses without a dedicated code (413, 415, ...) are request-format problems: keep the status.
      const code = CODE_BY_HTTP_STATUS[status] ?? "validation_failed";
      return buildProblemBody(code, status, GENERIC_DETAIL[status] ?? DEFAULT_CLIENT_DETAIL);
    }
    const requestLine = `${escapeControlCharacters(String(request.method))} ${escapeControlCharacters(String(request.path))}`;
    const clientError = clientErrorOf(exception);
    if (clientError !== undefined) {
      // Body-parser errors (too large, malformed JSON, unsupported charset): the caller's mistake, not ours.
      // Never log the message or body: it may echo what the client sent.
      this.logger.warn(
        `Rejected request ${requestLine}: ${clientError.status} ${clientError.type ?? "client_error"}`,
      );
      return buildProblemBody(
        CODE_BY_HTTP_STATUS[clientError.status] ?? "validation_failed",
        clientError.status,
        GENERIC_DETAIL[clientError.status] ?? DEFAULT_CLIENT_DETAIL,
      );
    }
    // Only method and path are logged (control characters escaped): query strings and bodies may contain personal
    // data or secrets, and the text of a database error embeds the SQL and its bound parameters.
    this.logger.error(
      `Unhandled error on ${requestLine}: ${describeError(exception)}`,
      stackFramesOf(exception),
    );
    return buildProblemBody(
      "internal_error",
      PROBLEM_STATUS.internal_error,
      "An unexpected error occurred. Please try again later.",
    );
  }
}

/** Drizzle wraps the driver error in a `DrizzleQueryError` (cause chain); the wrapper's message holds SQL and params. */
function findDatabaseError(error: unknown): pg.DatabaseError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (current instanceof pg.DatabaseError) {
      return current;
    }
    current = current.cause;
  }
  return undefined;
}

const MAX_CAUSE_DEPTH = 10;

/**
 * Drizzle's `DrizzleQueryError` message is `Failed query: <sql> params: <values>`, so it can hold emails and password
 * hashes whatever the cause is (network loss, pool timeout, a driver error that is not a `pg.DatabaseError`).
 * Recognized by class, by that message prefix and by the `query`/`params` properties it carries.
 */
function isQueryError(error: unknown): boolean {
  if (error instanceof DrizzleQueryError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.startsWith("Failed query:") || ("query" in error && "params" in error);
}

function chainHasQueryError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (isQueryError(current)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

/** Replaces C0/C1 control characters and line separators so user-influenced text cannot forge log lines. */
function escapeControlCharacters(text: string): string {
  return Array.from(text, (character) =>
    isControlCharacter(character.charCodeAt(0))
      ? `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
      : character,
  ).join("");
}

function isControlCharacter(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

/** Only our own call frames: the first stack line repeats the message, which may carry SQL or user input. */
function stackFramesOf(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.stack === undefined) {
    return undefined;
  }
  return error.stack
    .split("\n")
    .filter((line) => /^\s+at /.test(line))
    .join("\n");
}

function describeError(error: unknown): string {
  const databaseError = findDatabaseError(error);
  if (databaseError !== undefined) {
    // Name, SQLSTATE and the object names are enough to diagnose; the message embeds query text and parameters.
    const parts = [
      `${error instanceof Error ? error.constructor.name : "DatabaseError"} (database error)`,
      `sqlstate=${databaseError.code ?? "unknown"}`,
      ...(["constraint", "table", "column"] as const).flatMap((field) => {
        const value = databaseError[field];
        return value === undefined ? [] : [`${field}=${value}`];
      }),
    ];
    return escapeControlCharacters(parts.join(" "));
  }
  if (error instanceof Error && chainHasQueryError(error)) {
    // No message at all: it embeds the SQL and its bound parameters. Class names and a code are enough to diagnose.
    const innermost = innermostCause(error);
    const code = errorCode(innermost);
    const parts = [
      `${error.constructor.name} (query error)`,
      `cause=${innermost.name}`,
      ...(code === undefined ? [] : [`code=${code}`]),
    ];
    return escapeControlCharacters(parts.join(" "));
  }
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (cause: ${error.cause.message})` : "";
    return escapeControlCharacters(`${error.name}: ${error.message}${cause}`);
  }
  return escapeControlCharacters(String(error));
}

interface ClientError {
  status: number;
  type: string | undefined;
}

/** Errors that carry their own 4xx status without being Nest exceptions: `body-parser` (via `http-errors`). */
function clientErrorOf(error: unknown): ClientError | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const { status, statusCode, type } = error as {
    status?: unknown;
    statusCode?: unknown;
    type?: unknown;
  };
  for (const candidate of [status, statusCode]) {
    if (
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate >= 400 &&
      candidate < 500
    ) {
      return {
        status: candidate,
        type: typeof type === "string" ? escapeControlCharacters(type) : undefined,
      };
    }
  }
  return undefined;
}
