import {
  checkEmailRenderOutput,
  sanitizeSubject,
  type EmailLinks,
  type EmailRenderContext,
  type EmailRenderOutput,
  type EmailTemplate,
  type EmailTemplateCategory,
  type EmailTheme,
} from "@fluxkit/core";
import { LAYOUT_CATALOGS, resolveCatalogLocale, type EmailCatalogs } from "./email-messages.js";
import { layoutHtml, layoutText } from "./email-layout.js";

/** One template as the registry keeps it: the template, its catalogs per locale and where it came from (for logs). */
export interface RegisteredEmailTemplate {
  readonly template: EmailTemplate<unknown>;
  /** Locale to the template's own texts (keys `<template key>.<name>`). */
  readonly catalogs: EmailCatalogs;
  /** The class name of the Nest provider that registered it. */
  readonly source: string;
}

/** A mail ready to be handed to a provider (before the addresses are added). */
export interface RenderedEmail {
  /** Sanitized (`sanitizeSubject`): header-safe, at most 200 code points. */
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly category: EmailTemplateCategory;
}

/** Why a render did not produce a mail; the code becomes `last_error_code`. Never carries a variable or a text. */
export class EmailRenderError extends Error {
  constructor(
    readonly code: "variables_invalid" | "render_failed",
    options?: ErrorOptions,
  ) {
    super(`Email render failed: ${code}`, options);
    this.name = "EmailRenderError";
  }
}

export interface EmailRenderOptions {
  /** The mail's locale (`email_message.locale`); its texts fall back to `defaultLocale`, then the first catalog. */
  readonly locale: string;
  readonly defaultLocale: string;
  readonly theme: EmailTheme;
  readonly links: EmailLinks;
  readonly shopName: string | null;
}

/** The context a template renders with: frozen, the layout's and the template's texts of one locale merged. */
export function buildRenderContext(
  entry: RegisteredEmailTemplate,
  options: EmailRenderOptions,
): EmailRenderContext {
  const catalogLocale = resolveCatalogLocale(entry.catalogs, options.locale, options.defaultLocale);
  return Object.freeze({
    locale: options.locale,
    messages: Object.freeze({
      ...LAYOUT_CATALOGS[catalogLocale],
      ...entry.catalogs[catalogLocale],
    }),
    theme: options.theme,
    links: Object.freeze({ ...options.links }),
    shopName: options.shopName,
  });
}

/**
 * Renders one mail (ADR 0031 decisions 7 and 14): the variables pass the template's schema again (they were checked at
 * enqueue; a deploy may have changed the schema), the template renders the content, `checkEmailRenderOutput` checks it,
 * the layout wraps it and the subject is sanitized. Pure, synchronous and deterministic: the same stored input gives the
 * same bytes on every attempt, which the provider's idempotency check relies on.
 */
export function renderEmail(
  entry: RegisteredEmailTemplate,
  variables: unknown,
  options: EmailRenderOptions,
): RenderedEmail {
  const parsed = entry.template.variablesSchema.safeParse(variables);
  if (!parsed.success) {
    throw new EmailRenderError("variables_invalid");
  }
  const context = buildRenderContext(entry, options);
  let content: EmailRenderOutput;
  try {
    content = entry.template.render(parsed.data, context);
  } catch (error) {
    throw new EmailRenderError("render_failed", { cause: error });
  }
  const problems = checkEmailRenderOutput(content);
  if (problems.length > 0) {
    // The problems are sentences about the shape of the output, never its text.
    throw new EmailRenderError("render_failed", { cause: new Error(problems.join("; ")) });
  }
  const subject = sanitizeSubject(content.subject);
  const category = entry.template.category;
  return Object.freeze({
    subject,
    html: layoutHtml(content, context, category, subject).toString(),
    text: layoutText(content, context, category),
    category,
  });
}
