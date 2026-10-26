import type { EmailMessages, EmailTemplate } from "@fluxkit/core";

/**
 * The extension point of mail templates (ADR 0031 decision 14; `docs/contracts/email-templates.md`). A built-in, a
 * feature or a plugin registers a template with a Nest provider (any module of the application) whose class carries
 * `SetMetadata(EMAIL_TEMPLATE_METADATA, emailTemplateMetadata("<key>", { override? }))` and whose instance has this shape.
 * A feature package cannot import `apps/api`: it implements the shape structurally (it is checked at startup).
 *
 * - `template`: the core `EmailTemplate` (key, version, category, schema, sample variables, pure `render`).
 * - `catalogs`: the template's texts per locale, keys `<template key>.<name>`; `uk` and `en` at least, every locale with
 *   the same keys. The layout's texts (`layout.*`) are added by the API.
 */
export interface EmailTemplateProvider<V = unknown> {
  readonly template: EmailTemplate<V>;
  readonly catalogs: Readonly<Record<string, EmailMessages>>;
}
