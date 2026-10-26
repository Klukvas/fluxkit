/*
 * HTML escaping for mail templates (ADR 0031 decision 14). Every variable printed into a mail's HTML passes `escapeHtml`;
 * template authors write markup with the `html` tagged template, which escapes every interpolated value by default.
 * Markup from elsewhere enters only through the explicit, grep-able `unsafeRawHtml` marker. Pure and synchronous: the same
 * input always gives the same bytes (Resend refuses a changed body under the same idempotency key, R4).
 */

const ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
});

const SPECIAL = /[&<>"']/g;

/**
 * `&`, `<`, `>`, `"` and `'` as character references, in one pass (so `&` is never escaped twice); safe in text and in a
 * quoted attribute value. It does not make a URL safe: links come from configuration only. A non-string is a template
 * bug (TypeError), never printed as `undefined`.
 */
export function escapeHtml(value: string): string {
  if (typeof value !== "string") {
    throw new TypeError("escapeHtml takes a string");
  }
  return value.replace(SPECIAL, (character) => ESCAPES[character] ?? character);
}

/** Module-private: only `html` and `unsafeRawHtml` can make a `SafeHtml`. */
const CONSTRUCTION_KEY = Symbol("SafeHtml");

/**
 * Markup that is safe to insert as is: built by `html` or marked by `unsafeRawHtml`. The private field makes it
 * unforgeable: an object with the same shape or a copy of one is not a `SafeHtml`, and the constructor refuses callers
 * outside this module.
 */
export class SafeHtml {
  readonly #markup: string;

  constructor(key: symbol, markup: string) {
    if (key !== CONSTRUCTION_KEY) {
      throw new TypeError("SafeHtml is made by html or unsafeRawHtml only");
    }
    this.#markup = markup;
  }

  static isSafeHtml(value: unknown): value is SafeHtml {
    return typeof value === "object" && value !== null && #markup in value;
  }

  toString(): string {
    return this.#markup;
  }
}

/** Whether `value` is markup built by `html` or marked by `unsafeRawHtml`. */
export function isSafeHtml(value: unknown): value is SafeHtml {
  return SafeHtml.isSafeHtml(value);
}

/** A value `html` accepts: text and finite numbers are escaped, `SafeHtml` is inserted, arrays are joined. */
export type HtmlValue = string | number | SafeHtml | readonly HtmlValue[];

function render(value: unknown): string {
  if (typeof value === "string") {
    return escapeHtml(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (SafeHtml.isSafeHtml(value)) {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(render).join("");
  }
  throw new TypeError(
    `html cannot print ${value === null ? "null" : typeof value}: format it into text first`,
  );
}

/**
 * The tagged template of mail markup: ``html`<td>${title}</td>` `` escapes `title`. Accepts strings, finite numbers,
 * `SafeHtml` and arrays of them; anything else (`undefined`, `null`, booleans, NaN, objects, dates) is a template bug and
 * throws a TypeError instead of printing `undefined` or `[object Object]`.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  const part = (index: number): string => {
    const text = strings[index];
    if (typeof text !== "string") {
      // An invalid escape sequence in a tagged template has no cooked text.
      throw new TypeError("html template text has an invalid escape sequence");
    }
    return text;
  };
  let markup = part(0);
  for (let index = 0; index < values.length; index += 1) {
    markup += render(values[index]) + part(index + 1);
  }
  return new SafeHtml(CONSTRUCTION_KEY, markup);
}

/**
 * The ONE way to insert markup that was not built by `html`: the caller vouches that `trusted` is safe (a fixed snippet
 * of the template itself, never a variable). Named so a review or a lint rule can find every use.
 */
export function unsafeRawHtml(trusted: string): SafeHtml {
  if (typeof trusted !== "string") {
    throw new TypeError("unsafeRawHtml takes a string");
  }
  return new SafeHtml(CONSTRUCTION_KEY, trusted);
}
