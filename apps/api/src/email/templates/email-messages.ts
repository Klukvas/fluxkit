import type { EmailMessages } from "@fluxkit/core";
import en from "./messages/en.json" with { type: "json" };
import uk from "./messages/uk.json" with { type: "json" };

/*
 * The texts of mail (ADR 0031 decision 14): one flat catalog per locale, `templates/messages/<locale>.json`, keyed by
 * `<template key>.<name>` (and `layout.<name>` for the built-in layout). No user-facing text lives in TypeScript.
 */

/** Every template, built-in or registered by a feature, brings these locales; the layout has them too. */
export const REQUIRED_EMAIL_LOCALES = Object.freeze(["uk", "en"] as const);

/** Keys of the built-in layout start with this; template keys start with `<template key>.`. */
export const LAYOUT_MESSAGE_PREFIX = "layout.";

export type EmailCatalogs = Readonly<Record<string, EmailMessages>>;

function freezeCatalogs(catalogs: Record<string, Record<string, string>>): EmailCatalogs {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(catalogs).map(([locale, messages]) => [
        locale,
        Object.freeze({ ...messages }),
      ]),
    ),
  );
}

/** The built-in catalogs as shipped (`messages/uk.json`, `messages/en.json`). */
export const BUILT_IN_EMAIL_CATALOGS: EmailCatalogs = freezeCatalogs({ uk, en });

/** The part of `catalogs` whose keys start with `prefix`, per locale. */
export function catalogsWithPrefix(catalogs: EmailCatalogs, prefix: string): EmailCatalogs {
  return freezeCatalogs(
    Object.fromEntries(
      Object.entries(catalogs).map(([locale, messages]) => [
        locale,
        Object.fromEntries(Object.entries(messages).filter(([key]) => key.startsWith(prefix))),
      ]),
    ),
  );
}

/** The layout's own texts (`layout.*`) of the built-in catalogs. */
export const LAYOUT_CATALOGS: EmailCatalogs = catalogsWithPrefix(
  BUILT_IN_EMAIL_CATALOGS,
  LAYOUT_MESSAGE_PREFIX,
);

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

/**
 * The text of `key` with every `{name}` placeholder replaced by `params[name]`. A missing key, a placeholder without a
 * value or a value without a placeholder is a template bug and throws (registration renders every template with its
 * sample variables in every required locale, so such a bug stops the startup, not a send). The result is plain text:
 * a template prints it through the `html` tag, which escapes it.
 */
export function formatMessage(
  messages: EmailMessages,
  key: string,
  params: Readonly<Record<string, string>> = {},
): string {
  const text = Object.hasOwn(messages, key) ? messages[key] : undefined;
  if (typeof text !== "string") {
    throw new RangeError(`Email message "${key}" is missing`);
  }
  const used = new Set<string>();
  const result = text.replace(PLACEHOLDER, (_match, name: string) => {
    const value = Object.hasOwn(params, name) ? params[name] : undefined;
    if (typeof value !== "string") {
      throw new RangeError(`Email message "${key}" needs the value {${name}}`);
    }
    used.add(name);
    return value;
  });
  const unused = Object.keys(params).filter((name) => !used.has(name));
  if (unused.length > 0) {
    throw new RangeError(`Email message "${key}" has no placeholder for ${unused.join(", ")}`);
  }
  return result;
}

/**
 * The locale whose texts a mail uses (the `resolveTextWithFallback` order): the requested one when both the template
 * and the layout have it, else the default locale, else the first such locale in sorted order.
 */
export function resolveCatalogLocale(
  templateCatalogs: EmailCatalogs,
  locale: string,
  defaultLocale: string,
): string {
  const usable = (candidate: string) =>
    Object.hasOwn(templateCatalogs, candidate) && Object.hasOwn(LAYOUT_CATALOGS, candidate);
  for (const candidate of [locale, defaultLocale]) {
    if (usable(candidate)) {
      return candidate;
    }
  }
  const first = Object.keys(templateCatalogs).sort().find(usable);
  if (first === undefined) {
    throw new RangeError("No catalog of this template has a layout catalog");
  }
  return first;
}
