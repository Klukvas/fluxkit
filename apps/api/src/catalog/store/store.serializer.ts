import { Logger } from "@nestjs/common";
import {
  publicAttributeDefinitions,
  resolveText,
  resolveTextWithFallback,
  selectPublicAttributes,
  type AttributeDefinition,
  type AttributeValues,
  type StoreLocale,
} from "@fluxkit/core";
import { z } from "zod";
import type { I18nText } from "../../database/schema/catalog.js";
import type { TypeAttributeRow } from "./store.repository.js";
import type { StoreAttributes, StoreProductDetail } from "./store.schemas.js";

/**
 * The one place where attribute definitions and values leave the API (ADR 0006 section 10). What is public is
 * decided by core (`selectPublicAttributes`, `publicAttributeDefinitions`: visible on the storefront and not
 * internal); this file only feeds core and never filters attributes itself. Every attribute that reaches a response
 * goes through here, so a flag change in core cannot be bypassed by a route.
 */

const logger = new Logger("StoreSerializer");

const inputTypeSchema = z.enum(["text", "number", "boolean", "select", "multiselect", "date"]);

/**
 * A required text (title, name): the requested locale, else the default locale, else the first available non-empty one
 * (`resolveTextWithFallback`, the rule the order snapshot and the order views share). A text with no usable entry at all can
 * only come from data written around the service; log it and degrade to "".
 */
export function requiredText(text: I18nText, locale: StoreLocale, what: string): string {
  const resolved = resolveTextWithFallback(text, locale.locale, locale.defaultLocale);
  if (resolved === undefined) {
    logger.warn(`${what} has no text in any locale.`);
    return "";
  }
  return resolved;
}

export function optionalText(text: I18nText | null, locale: StoreLocale): string | null {
  return resolveText(text, locale.locale, locale.defaultLocale) ?? null;
}

function toAttributeDefinition(row: TypeAttributeRow): AttributeDefinition {
  const { attribute } = row;
  return {
    code: attribute.code,
    inputType: inputTypeSchema.parse(attribute.inputType),
    isLocalized: attribute.isLocalized,
    unit: attribute.unit,
    validation: attribute.validation,
    isFilterable: attribute.isFilterable,
    isSearchable: attribute.isSearchable,
    isVisibleOnStorefront: attribute.isVisibleOnStorefront,
    isComparable: attribute.isComparable,
    isSortable: attribute.isSortable,
    isInternal: attribute.isInternal,
    options: row.options,
  };
}

function definitionsAtLevel(
  assignments: readonly TypeAttributeRow[],
  level: "product" | "variant",
): AttributeDefinition[] {
  return assignments.filter((row) => row.level === level).map(toAttributeDefinition);
}

/** Public attribute values of a product or variant: only keys that have a public definition at `level` survive. */
export function serializeAttributes(
  assignments: readonly TypeAttributeRow[],
  level: "product" | "variant",
  values: AttributeValues,
  locale: StoreLocale,
): StoreAttributes {
  return selectPublicAttributes(definitionsAtLevel(assignments, level), values, locale);
}

/**
 * Public definitions of the product-level attributes. Core's list has no display name, so the name is looked up by
 * the code of each definition core kept (a code core dropped never gets a name here); select option labels are
 * resolved to one string like every other text.
 */
export function serializeAttributeDefinitions(
  assignments: readonly TypeAttributeRow[],
  locale: StoreLocale,
): StoreProductDetail["attributeDefinitions"] {
  const namesByCode = new Map(
    assignments.map((row) => [row.attribute.code, row.attribute.name] as const),
  );
  return publicAttributeDefinitions(definitionsAtLevel(assignments, "product")).map(
    (definition) => ({
      code: definition.code,
      name: requiredText(
        namesByCode.get(definition.code) ?? {},
        locale,
        `Attribute "${definition.code}" name`,
      ),
      inputType: definition.inputType,
      isLocalized: definition.isLocalized,
      unit: definition.unit,
      isFilterable: definition.isFilterable,
      isComparable: definition.isComparable,
      isSortable: definition.isSortable,
      options: definition.options.map((option) => ({
        code: option.code,
        // Same fallback as core uses for stored values: never an empty label.
        label: resolveText(option.label, locale.locale, locale.defaultLocale) ?? option.code,
      })),
    }),
  );
}
