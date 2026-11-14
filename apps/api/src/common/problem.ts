/*
 * The problem codes, the body members and `ProblemException` live in `@fluxkit/api-kit` (ADR 0049), so a feature package
 * throws the same class the global problem filter recognises. They are re-exported here unchanged, so no import of this
 * file changes; the factory functions below stay with the API.
 */
import { ProblemException, type FieldError, type ProblemExtensions } from "@fluxkit/api-kit";

export {
  ProblemException,
  type FieldError,
  type ProblemCode,
  type ProblemExtensions,
  type ProblemInit,
} from "@fluxkit/api-kit";
export { PROBLEM_CODES, PROBLEM_STATUS, PROBLEM_TITLE } from "@fluxkit/api-kit/internal";

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

/** The cart ships goods and the shop has an active shipping method, but the checkout names none (ADR 0029 decision 4). */
export function shippingMethodRequired(): ProblemException {
  return new ProblemException({
    code: "shipping_method_required",
    detail: "Choose a shipping method.",
  });
}

/** The checkout names a shipping method for a cart that ships nothing (digital goods only). */
export function shippingNotApplicable(): ProblemException {
  return new ProblemException({
    code: "shipping_not_applicable",
    detail: "This cart ships nothing, so it takes no shipping method.",
  });
}

/**
 * Only the shipping price or the method's availability changed since the shopper saw it; `shipping` is the method's fresh
 * option as `GET /store/shipping/options` returns it, or `{methodCode, available: false, reason}` when it is not offered.
 */
export function shippingChanged(shipping: unknown): ProblemException {
  return new ProblemException({
    code: "shipping_changed",
    detail: "The shipping changed since you saw it. Check it and try again.",
    members: { shipping },
  });
}

/** The carrier could not be reached and nothing usable is cached; only this method or lookup fails. */
export function shippingProviderUnavailable(retryAfterSeconds: number): ProblemException {
  return new ProblemException({
    code: "shipping_provider_unavailable",
    detail:
      "The delivery service cannot be reached right now. Try again later or choose another method.",
    headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });
}

/**
 * The payment provider refused, did not answer or could not be read (ADR 0032 decisions 6 and 18). `Retry-After` says
 * when asking again makes sense; `payment` (a documented member of the store create route) tells the shopper whether a
 * new attempt is allowed at all: after a lost create answer it is not, until the attempt is closed.
 */
export function paymentProviderUnavailable(
  retryAfterSeconds: number,
  payment?: Readonly<Record<string, unknown>>,
): ProblemException {
  return new ProblemException({
    code: "payment_provider_unavailable",
    detail: "The payment service cannot be reached right now. Try again later.",
    headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
    ...(payment === undefined ? {} : { members: { payment } }),
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
