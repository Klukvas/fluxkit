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
  // Shipping at checkout (ADR 0029 decision 4, docs/api/shipping.md).
  "shipping_method_required",
  "shipping_not_applicable",
  "shipping_changed",
  "shipping_provider_unavailable",
  // Online payments (ADR 0032 decision 18, docs/api/payments.md).
  "payment_provider_unavailable",
  // Catalog search (ADR 0034 decision 10, docs/api/search.md).
  "search_unavailable",
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
  shipping_method_required: 400,
  shipping_not_applicable: 400,
  shipping_changed: 409,
  shipping_provider_unavailable: 503,
  payment_provider_unavailable: 503,
  search_unavailable: 503,
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
  shipping_method_required: "A shipping method is required",
  shipping_not_applicable: "Nothing to ship",
  shipping_changed: "The shipping changed",
  shipping_provider_unavailable: "Shipping provider unavailable",
  payment_provider_unavailable: "Payment provider unavailable",
  search_unavailable: "Search unavailable",
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
