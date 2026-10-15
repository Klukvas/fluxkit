import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";
import { translatePostgresError } from "./postgres-errors.js";
import {
  PROBLEM_STATUS,
  PROBLEM_TITLE,
  ProblemException,
  type FieldError,
  type ProblemCode,
  type ProblemExtensions,
} from "./problem.js";

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
}

const CODE_BY_HTTP_STATUS: Readonly<Record<number, ProblemCode>> = {
  400: "validation_failed",
  401: "unauthorized",
  404: "not_found",
  409: "conflict",
};

const GENERIC_DETAIL: Readonly<Record<number, string>> = {
  401: "Authentication is required.",
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
): ProblemBody {
  return {
    type: "about:blank",
    title: PROBLEM_TITLE[code],
    status,
    code,
    detail,
    ...(errors === undefined ? {} : { errors }),
    ...extensions,
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
      );
    }
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      const status = exception.getStatus();
      // Statuses without a dedicated code (413, 415, ...) are request-format problems: keep the status.
      const code = CODE_BY_HTTP_STATUS[status] ?? "validation_failed";
      return buildProblemBody(code, status, GENERIC_DETAIL[status] ?? DEFAULT_CLIENT_DETAIL);
    }
    // Only method and path are logged: query strings and bodies may contain personal data or secrets.
    this.logger.error(
      `Unhandled error on ${request.method} ${request.path}: ${describeError(exception)}`,
      exception instanceof Error ? exception.stack : undefined,
    );
    return buildProblemBody(
      "internal_error",
      PROBLEM_STATUS.internal_error,
      "An unexpected error occurred. Please try again later.",
    );
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (cause: ${error.cause.message})` : "";
    return `${error.name}: ${error.message}${cause}`;
  }
  return String(error);
}
