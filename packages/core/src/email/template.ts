import { sanitizeSubject } from "./header.js";
import { isSafeHtml, type SafeHtml } from "./html.js";
import {
  EMAIL_LOCALE_PATTERN,
  EMAIL_TEMPLATE_KEY_MAX_LENGTH,
  EMAIL_TEMPLATE_KEY_PATTERN,
} from "./limits.js";

/*
 * The mail template contract (ADR 0031 decision 14; public once listed in `docs/contracts/email-templates.md`). Built-in
 * templates live in `apps/api/src/email/templates/`; a feature or plugin registers more, or overrides a built-in, with a
 * Nest provider marked `EMAIL_TEMPLATE_METADATA`. Rendering is pure, deterministic and synchronous: the same stored
 * input gives the same bytes, because the provider refuses a changed body under the same idempotency key (R4).
 */

/** What a template is about: account mails (reset, verification, test) or order mails. Sent as the provider tag. */
export const EMAIL_TEMPLATE_CATEGORIES = Object.freeze(["account", "order"] as const);

export type EmailTemplateCategory = (typeof EMAIL_TEMPLATE_CATEGORIES)[number];

/** The built-in template keys of v1 (decision 14). A feature may register more keys. */
export const EMAIL_TEMPLATE_KEYS = Object.freeze([
  "customer.password_reset",
  "customer.password_changed",
  "customer.verify_email",
  "order.placed",
  "order.paid",
  "order.cancelled",
  "order.expired",
  "shipment.created",
  "admin.test",
] as const);

export type BuiltInEmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

/** Metadata key on a template provider class (`SetMetadata`); the API discovers templates by it at startup. */
export const EMAIL_TEMPLATE_METADATA = "fluxkit:email-template";

export interface EmailTemplateMetadata {
  readonly key: string;
  /** `true` replaces the built-in (or earlier) template of the same key; without it a duplicate key stops startup. */
  readonly override: boolean;
}

/** Whether `key` is a template key (`EMAIL_TEMPLATE_KEY_PATTERN`, at most `EMAIL_TEMPLATE_KEY_MAX_LENGTH`). */
export function isEmailTemplateKey(key: unknown): key is string {
  return (
    typeof key === "string" &&
    key.length <= EMAIL_TEMPLATE_KEY_MAX_LENGTH &&
    EMAIL_TEMPLATE_KEY_PATTERN.test(key)
  );
}

/** The value for `SetMetadata(EMAIL_TEMPLATE_METADATA, ...)`. A malformed key is a bug (RangeError). */
export function emailTemplateMetadata(
  key: string,
  options: { readonly override?: boolean } = {},
): EmailTemplateMetadata {
  if (!isEmailTemplateKey(key)) {
    throw new RangeError(`Not an email template key: ${String(key)}`);
  }
  return Object.freeze({ key, override: options.override === true });
}

/**
 * The validator of a template's variables. A zod schema satisfies it (`z.object({...}).strict()`); core asks for the
 * method only, so a template package chooses its zod version.
 */
export interface EmailVariablesSchema<V> {
  safeParse(
    input: unknown,
  ): { readonly success: true; readonly data: V } | { readonly success: false };
}

/** The resolved, email-safe design values (`emailTheme` of `@fluxkit/theme`): inline styles, no CSS variables. */
export interface EmailTheme {
  readonly color: {
    readonly background: string;
    readonly foreground: string;
    readonly muted: string;
    readonly mutedForeground: string;
    readonly border: string;
    readonly primary: string;
    readonly primaryForeground: string;
    readonly danger: string;
    readonly success: string;
    readonly warning: string;
  };
  readonly font: { readonly sans: string; readonly mono: string };
  readonly radius: { readonly sm: string; readonly md: string; readonly lg: string };
  readonly space: {
    readonly xs: string;
    readonly sm: string;
    readonly md: string;
    readonly lg: string;
    readonly xl: string;
  };
  readonly fontSize: { readonly small: string; readonly body: string; readonly heading: string };
  readonly lineHeight: string;
  /** Width of the content table in pixels (a number: the `width` attribute of a table). */
  readonly contentWidth: number;
}

/** The mail's translated texts: message key to text, already resolved for `locale` (requested, default, first). */
export type EmailMessages = Readonly<Record<string, string>>;

/**
 * Links a template may print, built by the API from `STOREFRONT_PUBLIC_URL`, fixed paths and encoded segments only
 * (never from a request's `Host`). A bearer token travels in the fragment of `action` only.
 */
export interface EmailLinks {
  /** The storefront home in the mail's locale. */
  readonly storefront: string;
  /** The one link the mail is about (reset, verify, the order), `null` when it has none. */
  readonly action: string | null;
}

export interface EmailRenderContext {
  /** `EMAIL_LOCALE_PATTERN`. */
  readonly locale: string;
  readonly messages: EmailMessages;
  readonly theme: EmailTheme;
  readonly links: EmailLinks;
  /** The display name of `EMAIL_FROM`, or `null` without one. */
  readonly shopName: string | null;
}

/** What `render` answers. `html` is markup built with the `html` tag: a template cannot hand back a concatenated string. */
export interface EmailRenderOutput {
  /** Passed through `sanitizeSubject` by the API before sending. */
  readonly subject: string;
  readonly html: SafeHtml;
  /** The mandatory plain-text part. */
  readonly text: string;
}

export interface EmailTemplate<V> {
  readonly key: string;
  /** Raised whenever the output for the same variables changes; stored with each mail (`template_version`). */
  readonly version: number;
  readonly category: EmailTemplateCategory;
  readonly variablesSchema: EmailVariablesSchema<V>;
  /** Variables the preview renders; they must pass `variablesSchema`. */
  readonly sampleVariables: V;
  /**
   * The top-level variable keys whose stored values an admin may see in the outbox detail (an allowlist). Every other
   * value is shown as `[redacted]`; omitted or empty, none is shown. Never list a key that holds a token, a one-time code,
   * a link or anything else a reader could use.
   */
  readonly displayVariables?: readonly string[];
  render(variables: V, context: EmailRenderContext): EmailRenderOutput;
}

/**
 * Every problem of a template's definition, as sentences; empty when it may be registered: a key by
 * `isEmailTemplateKey`, a positive whole version, a known category, a schema with `safeParse`, a `render` function and
 * sample variables the schema accepts. Rendering is checked separately (`checkEmailRenderOutput`), per locale.
 */
export function checkEmailTemplateDefinition(template: EmailTemplate<unknown>): string[] {
  const problems: string[] = [];
  const candidate = template as Partial<EmailTemplate<unknown>> | null;
  if (typeof candidate !== "object" || candidate === null) {
    return ["the template is not an object"];
  }
  if (!isEmailTemplateKey(candidate.key)) {
    problems.push("key breaks EMAIL_TEMPLATE_KEY_PATTERN");
  }
  if (!(Number.isSafeInteger(candidate.version) && (candidate.version as number) >= 1)) {
    problems.push("version is not a whole number of at least 1");
  }
  if (!EMAIL_TEMPLATE_CATEGORIES.includes(candidate.category as EmailTemplateCategory)) {
    problems.push("category is not account or order");
  }
  if (typeof candidate.render !== "function") {
    problems.push("render is not a function");
  }
  const schema = candidate.variablesSchema as { safeParse?: unknown } | undefined;
  if (typeof schema !== "object" || schema === null || typeof schema.safeParse !== "function") {
    problems.push("variablesSchema has no safeParse");
  } else if (!candidate.variablesSchema?.safeParse(candidate.sampleVariables).success) {
    problems.push("sampleVariables do not pass variablesSchema");
  }
  const display: unknown = candidate.displayVariables;
  if (
    display !== undefined &&
    !(
      Array.isArray(display) &&
      display.every((key) => typeof key === "string" && key.length > 0) &&
      new Set(display).size === display.length
    )
  ) {
    problems.push("displayVariables is not a list of distinct, non-empty keys");
  }
  return problems;
}

/**
 * Every problem of one render output, as sentences; empty when it may be sent: a subject that is not blank after
 * `sanitizeSubject`, HTML built by the `html` tag and not blank, a plain-text part that is not blank.
 */
export function checkEmailRenderOutput(output: EmailRenderOutput): string[] {
  const candidate = output as Partial<Record<keyof EmailRenderOutput, unknown>> | null;
  if (typeof candidate !== "object" || candidate === null) {
    return ["the output is not an object"];
  }
  const problems: string[] = [];
  if (typeof candidate.subject !== "string" || sanitizeSubject(candidate.subject).length === 0) {
    problems.push("subject is not a text that survives sanitizeSubject");
  }
  if (!isSafeHtml(candidate.html)) {
    problems.push("html was not built with the html tag");
  } else if (candidate.html.toString().trim().length === 0) {
    problems.push("html is blank");
  }
  if (typeof candidate.text !== "string" || candidate.text.trim().length === 0) {
    problems.push("text is missing or blank (the plain-text part is mandatory)");
  }
  return problems;
}

/** Whether `locale` may be the locale of a mail (`EMAIL_LOCALE_PATTERN`). */
export function isEmailLocale(locale: unknown): locale is string {
  return typeof locale === "string" && EMAIL_LOCALE_PATTERN.test(locale);
}

/** `domain_event.id` as Postgres prints a uuid. */
const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `email_message.dedupe_key` of a mail caused by a domain event (ADR 0031 decision 5): `<eventId>:<templateKey>`, so a
 * redelivered event inserts no second row (`ON CONFLICT DO NOTHING`). A malformed id or key is a bug (RangeError).
 */
export function buildEmailDedupeKey(eventId: string, templateKey: string): string {
  if (typeof eventId !== "string" || !EVENT_ID_PATTERN.test(eventId)) {
    throw new RangeError("eventId must be a lower-case UUID");
  }
  if (!isEmailTemplateKey(templateKey)) {
    throw new RangeError(`Not an email template key: ${String(templateKey)}`);
  }
  return `${eventId}:${templateKey}`;
}
