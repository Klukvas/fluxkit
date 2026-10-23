import { HttpException } from "@nestjs/common";

/** Machine-readable error codes of the admin API. Public contract: see docs/plans/2026-10-15-catalog-api-design.md. */
export const PROBLEM_CODES = [
  "validation_failed",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "in_use",
  "invalid_transition",
  "rule_violation",
  "too_many_requests",
  "internal_error",
  // Checkout (plan 2026-10-17, docs/api/orders.md).
  "cart_empty",
  "cart_changed",
  "checkout_refused",
  "idempotency_key_reused",
  "too_many_open_orders",
  "service_unavailable",
  // Media upload (ADR 0028, docs/api/media.md).
  "storage_unavailable",
  "uploads_disabled",
] as const;

export type ProblemCode = (typeof PROBLEM_CODES)[number];

export const PROBLEM_STATUS: Readonly<Record<ProblemCode, number>> = {
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  in_use: 409,
  invalid_transition: 409,
  rule_violation: 409,
  too_many_requests: 429,
  internal_error: 500,
  cart_empty: 409,
  cart_changed: 409,
  checkout_refused: 409,
  idempotency_key_reused: 409,
  too_many_open_orders: 409,
  service_unavailable: 503,
  storage_unavailable: 503,
  uploads_disabled: 503,
};

export const PROBLEM_TITLE: Readonly<Record<ProblemCode, string>> = {
  validation_failed: "Validation failed",
  unauthorized: "Authentication required",
  forbidden: "Forbidden",
  not_found: "Not found",
  conflict: "Conflict",
  in_use: "Resource is in use",
  invalid_transition: "Invalid state transition",
  rule_violation: "Business rule violated",
  too_many_requests: "Too many requests",
  internal_error: "Internal server error",
  cart_empty: "The cart is empty",
  cart_changed: "The cart changed",
  checkout_refused: "Checkout refused",
  idempotency_key_reused: "Idempotency key reused",
  too_many_open_orders: "Too many unpaid orders",
  service_unavailable: "Service unavailable",
  storage_unavailable: "Storage unavailable",
  uploads_disabled: "Uploads are switched off",
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
  /** Extra response headers (`Retry-After` of a 429). Never put secrets or internals here. */
  headers?: Readonly<Record<string, string>>;
  /** Extra JSON members of the body for a code that documents them (`cart` of `cart_changed`). Never put internals here. */
  members?: Readonly<Record<string, unknown>>;
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
  readonly headers: Readonly<Record<string, string>>;
  readonly members: Readonly<Record<string, unknown>>;

  constructor(init: ProblemInit) {
    super(init.detail, init.status ?? PROBLEM_STATUS[init.code]);
    this.code = init.code;
    this.detail = init.detail;
    this.errors = init.errors;
    this.extensions = init.extensions ?? {};
    this.headers = init.headers ?? {};
    this.members = init.members ?? {};
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

/** Signed in (or a public route) but not allowed: the role lacks the permission, or the CSRF header is missing. */
export function forbidden(detail = "You do not have permission to do this."): ProblemException {
  return new ProblemException({ code: "forbidden", detail });
}

/** `retryAfterSeconds` is sent as `Retry-After` (rounded up to a whole second, at least 1). */
export function tooManyRequests(detail: string, retryAfterSeconds: number): ProblemException {
  return new ProblemException({
    code: "too_many_requests",
    detail,
    headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });
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

/** The cart has no line to order (also: a parallel checkout of the same cart already emptied it). */
export function cartEmpty(): ProblemException {
  return new ProblemException({ code: "cart_empty", detail: "The cart is empty." });
}

/** What the shopper agreed to is no longer true; `cart` is the fresh cart as `GET /store/cart` shows it. */
export function cartChanged(cart: unknown): ProblemException {
  return new ProblemException({
    code: "cart_changed",
    detail: "The cart changed since you saw it. Check it and try again.",
    members: { cart },
  });
}

/** Lines that cannot be ordered, one error per line: `path` is `lines.<index in the cart>`. */
export function checkoutRefused(errors: readonly FieldError[]): ProblemException {
  return new ProblemException({
    code: "checkout_refused",
    detail: "Some lines cannot be ordered right now.",
    errors,
  });
}

export function idempotencyKeyReused(): ProblemException {
  return new ProblemException({
    code: "idempotency_key_reused",
    detail: "This Idempotency-Key was already used for a different request.",
  });
}

/**
 * The customer or the guest email already holds the most unpaid orders allowed (`MAX_OPEN_ORDERS`, ADR 0024). The text
 * names no order, number or address: it is the answer to the shopper's own request and nothing more.
 */
export function tooManyOpenOrders(): ProblemException {
  return new ProblemException({
    code: "too_many_open_orders",
    detail:
      "There are too many unpaid orders already. Pay or cancel one of them, or wait until it expires, and try again.",
  });
}

/** A transient failure the caller may retry (a database deadlock that survived its retry). */
export function serviceUnavailable(retryAfterSeconds = 1): ProblemException {
  return new ProblemException({
    code: "service_unavailable",
    detail: "The service is busy. Please try again.",
    headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });
}
