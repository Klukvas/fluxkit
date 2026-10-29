import type { Availability } from "../inventory/availability.js";
import { isVariantSellable } from "../catalog/sellable.js";
import { resolveTextWithFallback } from "../catalog/i18n.js";
import { isPublicAttribute } from "../catalog/store-attributes.js";
import type {
  AttributeDefinition,
  AttributeValues,
  I18nText,
  OptionValuePair,
  ProductStatus,
} from "../catalog/types.js";
import type { SearchAttributeAssignment } from "./facets.js";
import { FILTERABLE_INPUT_TYPES, attributeField, optionField } from "./fields.js";
import type { AttributeFieldName, OptionFieldName } from "./fields.js";
import { SEARCH_LIMITS } from "./limits.js";
import { normalizeSearchWords } from "./query.js";
import { prefixToken, stemLanguageOf, stemTokens } from "./stemmers/index.js";

export interface SearchOptionDefinition {
  readonly code: string;
  readonly label: I18nText;
  readonly values: readonly { readonly code: string; readonly label: I18nText }[];
}

export interface SearchCategoryFact {
  readonly id: string;
  readonly name: I18nText;
  /** Ids of all ancestors; the document stores them so a category matches its subtree. */
  readonly ancestorIds: readonly string[];
}

export interface SearchVariantFacts {
  readonly id: string;
  readonly sku: string;
  readonly isActive: boolean;
  /** Price in minor units of the shop currency, or null when the variant has none (then it is not sellable). */
  readonly shopPrice: number | null;
  /** From core `availabilityOf`; the index keeps one bit of it. */
  readonly availability: Availability;
  readonly optionValues: readonly OptionValuePair[];
  readonly attributes: AttributeValues;
}

export interface SearchProductFacts {
  readonly id: string;
  readonly slug: string;
  readonly status: ProductStatus;
  /** ISO timestamp of the first publish. */
  readonly publishedAt: string | null;
  readonly title: I18nText;
  readonly description: I18nText | null;
  readonly brand: { readonly slug: string; readonly name: I18nText } | null;
  /** The visible categories of the product. */
  readonly categories: readonly SearchCategoryFact[];
  readonly attributes: AttributeValues;
  readonly variants: readonly SearchVariantFacts[];
}

export interface SearchBuildContext {
  readonly locale: string;
  readonly defaultLocale: string;
  /** Attribute assignments of the product's type, in the order their texts should appear. */
  readonly attributes: readonly SearchAttributeAssignment[];
  readonly options: readonly SearchOptionDefinition[];
}

export type SearchAttributeFieldValue = string | number | boolean | readonly string[];

export interface SearchDocumentFields {
  readonly id: string;
  readonly productId: string;
  readonly productSlug: string;
  readonly title: string;
  readonly brandName?: string;
  readonly sku: string;
  readonly optionLabels: readonly string[];
  readonly categoryNames: readonly string[];
  readonly attributeText: readonly string[];
  readonly description?: string;
  readonly stems: readonly string[];
  readonly stems5: readonly string[];
  readonly brand?: string;
  readonly categories: readonly string[];
  readonly price: number;
  readonly inStock: boolean;
  readonly publishedAt: number;
}

/** One document per sellable variant (ADR 0034 decision 2), public data only. */
export type SearchDocument = SearchDocumentFields & {
  readonly [field in OptionFieldName]?: string;
} & {
  readonly [field in AttributeFieldName]?: SearchAttributeFieldValue;
};

function isI18nText(value: unknown): value is I18nText {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

function textOf(text: I18nText | null | undefined, context: SearchBuildContext): string {
  return resolveTextWithFallback(text, context.locale, context.defaultLocale) ?? "";
}

function optionLabel(
  definition: AttributeDefinition,
  code: string,
  context: SearchBuildContext,
): string {
  const option = definition.options.find((candidate) => candidate.code === code);
  return textOf(option?.label, context) || code;
}

/** The chosen option codes of a select or multiselect value, in the order of the definition; empty if the value does not fit. */
function chosenCodes(definition: AttributeDefinition, raw: unknown): string[] {
  let chosen: unknown[] = [];
  if (definition.inputType === "select" && typeof raw === "string") {
    chosen = [raw];
  } else if (definition.inputType === "multiselect" && Array.isArray(raw)) {
    chosen = raw;
  }
  return definition.options.map((option) => option.code).filter((code) => chosen.includes(code));
}

function filterValue(
  definition: AttributeDefinition,
  raw: unknown,
): SearchAttributeFieldValue | undefined {
  switch (definition.inputType) {
    case "select": {
      const [code] = chosenCodes(definition, raw);
      return code;
    }
    case "multiselect": {
      const codes = chosenCodes(definition, raw);
      return codes.length === 0 ? undefined : [...codes].sort();
    }
    case "boolean":
      return typeof raw === "boolean" ? raw : undefined;
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
    default:
      return undefined;
  }
}

function searchableText(
  definition: AttributeDefinition,
  raw: unknown,
  context: SearchBuildContext,
): string[] {
  switch (definition.inputType) {
    case "select":
    case "multiselect":
      return chosenCodes(definition, raw).map((code) => optionLabel(definition, code, context));
    case "text": {
      if (definition.isLocalized) {
        const text = isI18nText(raw) ? textOf(raw, context) : "";
        return text === "" ? [] : [text];
      }
      return typeof raw === "string" && raw !== "" ? [raw] : [];
    }
    case "number":
      return typeof raw === "number" && Number.isFinite(raw)
        ? [definition.unit === null ? String(raw) : `${raw} ${definition.unit}`]
        : [];
    default:
      return [];
  }
}

/**
 * Milliseconds, the precision the API writes `published_at` with: seconds tied products published in the same second and
 * the engine then listed them in its own order, unlike the SQL listing (review F2 of the search finish).
 */
function epochMilliseconds(iso: string | null): number {
  if (iso === null) {
    return 0;
  }
  const milliseconds = Date.parse(iso);
  if (Number.isNaN(milliseconds)) {
    throw new RangeError("A product has a publish timestamp that is not a date");
  }
  return milliseconds;
}

function cut(text: string, length: number): string {
  const characters = [...text];
  return characters.length <= length ? text : characters.slice(0, length).join("");
}

/**
 * The search documents of one product (ADR 0034 decision 2): one per sellable variant, none for a product that is not
 * `active`. The ONLY place that decides what reaches the index: attributes pass `isPublicAttribute` (visible on the
 * storefront and not internal) and then their own `isFilterable` / `isSearchable` flag, whatever else the definition says.
 * Stored values that do not fit their definition are left out. Pure: the caller supplies the facts and the definitions.
 */
export function buildSearchDocuments(
  product: SearchProductFacts,
  context: SearchBuildContext,
): SearchDocument[] {
  const publicAssignments = context.attributes.filter(({ definition }) =>
    isPublicAttribute(definition),
  );
  const language = stemLanguageOf(context.locale);
  const brandName = product.brand === null ? undefined : textOf(product.brand.name, context);
  const title = textOf(product.title, context);
  const description = cut(textOf(product.description, context), SEARCH_LIMITS.maxDescriptionLength);
  const categoryIds = unique(
    product.categories.flatMap((category) => [category.id, ...category.ancestorIds]),
  ).sort();
  const categoryNames = unique(
    product.categories
      .map((category) => textOf(category.name, context))
      .filter((name) => name !== ""),
  );
  const publishedAt = epochMilliseconds(product.publishedAt);

  const documents: SearchDocument[] = [];
  for (const variant of product.variants) {
    const sellable = isVariantSellable({
      productStatus: product.status,
      variantIsActive: variant.isActive,
      hasShopPrice: variant.shopPrice !== null,
    });
    if (!sellable || variant.shopPrice === null) {
      continue;
    }
    if (!Number.isSafeInteger(variant.shopPrice) || variant.shopPrice < 0) {
      throw new RangeError("A variant price must be a non-negative integer of minor units");
    }

    const optionLabels: string[] = [];
    const optionFields: Record<OptionFieldName, string> = {};
    for (const option of context.options) {
      const pair = variant.optionValues.find((candidate) => candidate.optionCode === option.code);
      if (pair === undefined) {
        continue;
      }
      const value = option.values.find((candidate) => candidate.code === pair.valueCode);
      optionLabels.push(textOf(value?.label, context) || pair.valueCode);
      optionFields[optionField(option.code)] = pair.valueCode;
    }

    const attributeText: string[] = [];
    const attributeFields: Record<AttributeFieldName, SearchAttributeFieldValue> = {};
    for (const { definition, level } of publicAssignments) {
      const values = level === "product" ? product.attributes : variant.attributes;
      if (!Object.hasOwn(values, definition.code)) {
        continue;
      }
      const raw = values[definition.code];
      if (definition.isSearchable) {
        attributeText.push(...searchableText(definition, raw, context));
      }
      if (definition.isFilterable && FILTERABLE_INPUT_TYPES.includes(definition.inputType)) {
        const value = filterValue(definition, raw);
        if (value !== undefined) {
          attributeFields[attributeField(definition.code)] = value;
        }
      }
    }

    const stemmedWords = unique(
      [title, brandName ?? "", ...optionLabels, ...categoryNames, ...attributeText].flatMap(
        normalizeSearchWords,
      ),
    );
    const document: SearchDocument = {
      id: variant.id,
      productId: product.id,
      productSlug: product.slug,
      title,
      ...(brandName !== undefined && { brandName }),
      sku: variant.sku,
      optionLabels,
      categoryNames,
      attributeText,
      ...(description !== "" && { description }),
      stems: language === null ? [] : unique(stemTokens(stemmedWords, language)),
      stems5: language === "uk" ? unique(stemmedWords.map(prefixToken)) : [],
      ...(product.brand !== null && { brand: product.brand.slug }),
      categories: categoryIds,
      price: variant.shopPrice,
      inStock: variant.availability !== "out_of_stock",
      publishedAt,
      ...optionFields,
      ...attributeFields,
    };
    documents.push(document);
  }
  return documents;
}
