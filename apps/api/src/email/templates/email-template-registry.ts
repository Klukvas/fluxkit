import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import {
  checkEmailTemplateDefinition,
  EMAIL_TEMPLATE_METADATA,
  emailTemplateMetadata,
  isEmailLocale,
  type EmailLinks,
  type EmailTemplate,
  type EmailTemplateMetadata,
} from "@fluxkit/core";
import { REQUIRED_EMAIL_LOCALES, type EmailCatalogs } from "./email-messages.js";
import { EmailRenderError, renderEmail, type RegisteredEmailTemplate } from "./email-renderer.js";
import { EMAIL_THEME } from "./email-theme.js";

/** What discovery found for one marked provider. */
export interface EmailTemplateCandidate {
  /** The provider's class name, for messages. */
  readonly name: string;
  /** The raw metadata under `EMAIL_TEMPLATE_METADATA`. */
  readonly metadata: unknown;
  readonly instance: unknown;
  /** A singleton provider (not request-scoped or transient). */
  readonly isStatic: boolean;
}

/** Links the startup check renders every template with (placeholders; nothing is sent). */
export function sampleEmailLinks(locale: string): EmailLinks {
  return Object.freeze({
    storefront: `https://shop.example.com/${encodeURIComponent(locale)}`,
    action: `https://shop.example.com/${encodeURIComponent(locale)}/sample#t=sample`,
  });
}

/** Message keys: `<template key>.<segment>` with lower-case segments. */
const MESSAGE_NAME = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

function catalogProblems(key: string, catalogs: unknown): string[] {
  if (typeof catalogs !== "object" || catalogs === null) {
    return ["catalogs is not an object of locale to texts"];
  }
  const problems: string[] = [];
  const entries = Object.entries(catalogs as Record<string, unknown>);
  for (const locale of REQUIRED_EMAIL_LOCALES) {
    if (!Object.hasOwn(catalogs, locale)) {
      problems.push(`catalogs lack the required locale ${locale}`);
    }
  }
  let reference: string | undefined;
  let referenceLocale = "";
  for (const [locale, messages] of entries) {
    if (!isEmailLocale(locale)) {
      problems.push(`catalog locale ${JSON.stringify(locale)} is not a locale`);
      continue;
    }
    if (typeof messages !== "object" || messages === null) {
      problems.push(`catalog ${locale} is not an object`);
      continue;
    }
    for (const [name, text] of Object.entries(messages as Record<string, unknown>)) {
      if (!name.startsWith(`${key}.`) || !MESSAGE_NAME.test(name.slice(key.length + 1))) {
        problems.push(
          `catalog ${locale} has the key ${JSON.stringify(name)}, which does not start with ${key}.`,
        );
      }
      if (typeof text !== "string" || text.trim().length === 0) {
        problems.push(`catalog ${locale} has no text for ${name}`);
      }
    }
    const keys = Object.keys(messages).sort().join("\n");
    if (reference === undefined) {
      reference = keys;
      referenceLocale = locale;
    } else if (keys !== reference) {
      problems.push(`catalogs ${referenceLocale} and ${locale} do not have the same keys`);
    }
  }
  return problems;
}

/** Renders the sample variables in every required locale, twice, with and without a shop name. */
function renderProblems(entry: RegisteredEmailTemplate): string[] {
  const problems: string[] = [];
  for (const locale of REQUIRED_EMAIL_LOCALES) {
    for (const shopName of [null, "Sample Shop"]) {
      const options = {
        locale,
        defaultLocale: locale,
        theme: EMAIL_THEME,
        links: sampleEmailLinks(locale),
        shopName,
      };
      try {
        const first = renderEmail(entry, entry.template.sampleVariables, options);
        const second = renderEmail(entry, entry.template.sampleVariables, options);
        if (JSON.stringify(first) !== JSON.stringify(second)) {
          problems.push(`render is not deterministic in ${locale}`);
        }
      } catch (error) {
        const cause = error instanceof EmailRenderError ? error.cause : error;
        problems.push(
          `the sample variables do not render in ${locale}${error instanceof EmailRenderError ? ` (${error.code})` : ""}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
  }
  return problems;
}

function checkCandidate(candidate: EmailTemplateCandidate): {
  metadata: EmailTemplateMetadata;
  entry: RegisteredEmailTemplate;
} {
  const raw = candidate.metadata as { key?: unknown; override?: unknown } | null;
  let metadata: EmailTemplateMetadata;
  try {
    metadata = emailTemplateMetadata(String(raw?.key), { override: raw?.override === true });
  } catch (error) {
    throw new Error(
      `Email template ${candidate.name} declares an invalid key: ${(error as Error).message}`,
      { cause: error },
    );
  }
  const fail = (problems: string[]): never => {
    throw new Error(
      `Email template ${candidate.name} ("${metadata.key}") cannot be registered: ${problems.join("; ")}.`,
    );
  };
  const instance = candidate.instance as { template?: unknown; catalogs?: unknown } | null;
  if (!candidate.isStatic || typeof instance !== "object" || instance === null) {
    fail(["it must be a static provider with template and catalogs"]);
  }
  const template = instance?.template as EmailTemplate<unknown> | undefined;
  if (typeof template !== "object" || template === null) {
    return fail(["it has no template"]);
  }
  const problems = checkEmailTemplateDefinition(template);
  if (template.key !== metadata.key) {
    problems.push(`its template key "${String(template.key)}" differs from the metadata`);
  }
  problems.push(...catalogProblems(metadata.key, instance?.catalogs));
  if (problems.length > 0) {
    fail(problems);
  }
  const entry: RegisteredEmailTemplate = Object.freeze({
    template,
    catalogs: instance?.catalogs as EmailCatalogs,
    source: candidate.name,
  });
  const rendering = renderProblems(entry);
  if (rendering.length > 0) {
    fail(rendering);
  }
  return { metadata, entry };
}

/**
 * The templates of the application by key (ADR 0031 decision 14). Every candidate is checked (key, version, category,
 * schema and sample variables by core `checkEmailTemplateDefinition`; catalogs in `uk` and `en` with the same
 * `<key>.<name>` keys; the sample variables render in both locales, deterministically, through the core render checks:
 * a subject, HTML built by the `html` tag and a plain-text part). One template per key: a second one without
 * `override: true` stops the startup, an override replaces the template it names, two overrides of one key or an
 * override of a key nobody registered stop the startup too. Pure: the discovery is done by the caller.
 */
export function buildEmailTemplateCatalog(
  candidates: readonly EmailTemplateCandidate[],
): ReadonlyMap<string, RegisteredEmailTemplate> {
  const base = new Map<string, RegisteredEmailTemplate>();
  const overrides = new Map<string, RegisteredEmailTemplate>();
  for (const candidate of candidates) {
    const { metadata, entry } = checkCandidate(candidate);
    const target = metadata.override ? overrides : base;
    const existing = target.get(metadata.key);
    if (existing !== undefined) {
      throw new Error(
        metadata.override
          ? `Email template "${metadata.key}" is overridden twice (${existing.source} and ${entry.source}).`
          : `Email template "${metadata.key}" is registered twice (${existing.source} and ${entry.source}); mark the replacement with override: true.`,
      );
    }
    target.set(metadata.key, entry);
  }
  for (const [key, entry] of overrides) {
    if (!base.has(key)) {
      throw new Error(
        `Email template ${entry.source} overrides "${key}", which no other provider registers.`,
      );
    }
    base.set(key, entry);
  }
  return new Map([...base.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** Read-only view for the outbox and, later, the admin routes. */
export interface EmailTemplateSource {
  get(key: string): RegisteredEmailTemplate | undefined;
  keys(): readonly string[];
}

/**
 * Finds the mail templates once, at startup: every Nest provider whose class carries `EMAIL_TEMPLATE_METADATA`, in any
 * module (built-ins in `EmailTemplatesModule`, a feature's in its own module, so they disappear with the feature).
 */
@Injectable()
export class EmailTemplateRegistry implements OnApplicationBootstrap, EmailTemplateSource {
  private readonly logger = new Logger(EmailTemplateRegistry.name);
  private templates: ReadonlyMap<string, RegisteredEmailTemplate> = new Map();

  constructor(@Inject(DiscoveryService) private readonly discovery: DiscoveryService) {}

  onApplicationBootstrap(): void {
    this.discover();
    this.logger.log(`Email templates registered: ${this.keys().join(", ") || "none"}`);
  }

  /** Scans the providers and replaces the registry (public so a test can assert on a fresh scan). */
  discover(): void {
    const candidates: EmailTemplateCandidate[] = [];
    for (const wrapper of this.discovery.getProviders()) {
      const target: unknown = wrapper.instance?.constructor ?? wrapper.metatype;
      if (typeof target !== "function") {
        continue;
      }
      const raw: unknown = Reflect.getMetadata(EMAIL_TEMPLATE_METADATA, target);
      if (raw === undefined) {
        continue;
      }
      candidates.push({
        name: target.name === "" ? String(wrapper.name) : target.name,
        metadata: raw,
        instance: wrapper.instance,
        isStatic: wrapper.isDependencyTreeStatic() && !wrapper.isTransient,
      });
    }
    this.templates = buildEmailTemplateCatalog(candidates);
  }

  get(key: string): RegisteredEmailTemplate | undefined {
    return this.templates.get(key);
  }

  keys(): readonly string[] {
    return [...this.templates.keys()];
  }
}
