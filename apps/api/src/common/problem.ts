import { HttpException } from "@nestjs/common";

/** Machine-readable error codes of the admin API. Public contract: see docs/plans/2026-10-15-catalog-api-design.md. */
export const PROBLEM_CODES = [
  "validation_failed",
  "unauthorized",
  "not_found",
  "conflict",
  "in_use",
  "invalid_transition",
  "rule_violation",
  "internal_error",
] as const;

export type ProblemCode = (typeof PROBLEM_CODES)[number];

export const PROBLEM_STATUS: Readonly<Record<ProblemCode, number>> = {
  validation_failed: 400,
  unauthorized: 401,
  not_found: 404,
  conflict: 409,
  in_use: 409,
  invalid_transition: 409,
  rule_violation: 409,
  internal_error: 500,
};

export const PROBLEM_TITLE: Readonly<Record<ProblemCode, string>> = {
  validation_failed: "Validation failed",
  unauthorized: "Authentication required",
  not_found: "Not found",
  conflict: "Conflict",
  in_use: "Resource is in use",
  invalid_transition: "Invalid state transition",
  rule_violation: "Business rule violated",
  internal_error: "Internal server error",
};

/** One problem with a request field. `path` is dotted (`name.uk`, `attributes.size`); empty for the whole body. */
export interface FieldError {
  path: string;
  code: string;
  message?: string;
}

/** Extra members of the problem body (`field`, `constraint`, `rule`). Never put internals (SQL, stack traces) here. */
export type ProblemExtensions = Readonly<Partial<Record<"field" | "constraint" | "rule", string>>>;

export interface ProblemInit {
  code: ProblemCode;
  detail: string;
  errors?: readonly FieldError[];
  extensions?: ProblemExtensions;
  /** Only for client errors that have no dedicated code (e.g. 413); defaults to the status of `code`. */
  status?: number;
}

/**
 * Throw this (or one of the factory functions below) from services and controllers. The problem filter turns it
 * into an `application/problem+json` response; nothing else decides the shape of an error body.
 */
export class ProblemException extends HttpException {
  readonly code: ProblemCode;
  readonly detail: string;
  readonly errors: readonly FieldError[] | undefined;
  readonly extensions: ProblemExtensions;

  constructor(init: ProblemInit) {
    super(init.detail, init.status ?? PROBLEM_STATUS[init.code]);
    this.code = init.code;
    this.detail = init.detail;
    this.errors = init.errors;
    this.extensions = init.extensions ?? {};
  }
}

export function validationFailed(
  errors: readonly FieldError[],
  detail = "The request is not valid.",
): ProblemException {
  return new ProblemException({ code: "validation_failed", detail, errors });
}

export function unauthorized(detail = "Authentication is required."): ProblemException {
  return new ProblemException({ code: "unauthorized", detail });
}

export function notFound(resource: string): ProblemException {
  return new ProblemException({ code: "not_found", detail: `${resource} was not found.` });
}

export function conflict(detail: string, extensions?: ProblemExtensions): ProblemException {
  return new ProblemException({ code: "conflict", detail, extensions });
}

export function inUse(detail: string, extensions?: ProblemExtensions): ProblemException {
  return new ProblemException({ code: "in_use", detail, extensions });
}

export function invalidTransition(detail: string, rule?: string): ProblemException {
  return new ProblemException({
    code: "invalid_transition",
    detail,
    extensions: rule === undefined ? undefined : { rule },
  });
}

export function ruleViolation(detail: string, rule: string): ProblemException {
  return new ProblemException({ code: "rule_violation", detail, extensions: { rule } });
}
