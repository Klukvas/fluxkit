import type { ProblemDetails } from "@fluxkit/api-client";
import { describeFieldError, type MessageDescriptor } from "../../lib/problem-messages";
import type { FormIssues } from "../catalog-dictionaries/form-rules";
import { attributeReason } from "./attribute-values-form";
import {
  CATEGORIES_FOCUS_ID,
  GENERAL_FIELD_IDS,
  MEDIA_FOCUS_ID,
  OPTIONS_FOCUS_ID,
  PRICES_FOCUS_ID,
  VARIANTS_FOCUS_ID,
  attributeControlId,
  mediaFieldId,
  optionFocusId,
  priceFieldId,
  variantRowFocusId,
} from "./field-ids";
import { fieldName as priceFieldName } from "./prices/price-grid";

/** The tabs of the product editor (their order and permissions are configuration: `src/layout/product-editor.ts`). */
export const EDITOR_TAB_IDS = [
  "general",
  "attributes",
  "categories",
  "media",
  "options",
  "variants",
  "prices",
  "stock",
] as const;
export type EditorTabId = (typeof EDITOR_TAB_IDS)[number];

/**
 * One reason a publish was refused (`400 validation_failed`, `errors[]`; `docs/api/catalog.md`), placed on the editor: the
 * tab that owns the path, the form field (the API path, for the inline error; for a variant attribute the path inside that
 * variant's form), the element to focus, and for a variant problem its index `N` in the product detail's variant order
 * (the API's `variants.N`), its id and its SKU, so the problem stays on the right row when the table changes.
 */
export interface PublishProblem {
  path: string;
  /** `null`: no tab owns the path; the summary lists it without a link. */
  tab: EditorTabId | null;
  field: string | null;
  focusId: string | null;
  variantIndex?: number;
  variantId?: string;
  variantSku?: string;
  attributeCode?: string;
  message: MessageDescriptor;
}

export interface PublishContext {
  defaultLocale: string;
  /** `GET /admin/config` `shopCurrency`: a missing price is the variant's price in it. */
  shopCurrency: string;
  /** The product detail's variants, in its order (the order the API's `variants.N` counts in). */
  variants: readonly { id: string; sku: string }[];
}

const LOCALE_MAP_FIELDS = {
  title: GENERAL_FIELD_IDS.title,
  description: GENERAL_FIELD_IDS.description,
};

function mapOne(path: string, code: string, context: PublishContext): PublishProblem {
  const parts = path.split(".");
  const head = parts[0] ?? "";
  const base = { path, field: null, focusId: null } as const;

  if (head === "title" || head === "description") {
    const locale = parts[1] ?? context.defaultLocale;
    return {
      ...base,
      tab: "general",
      field: `${head}.${locale}`,
      focusId: `${LOCALE_MAP_FIELDS[head]}-${locale}`,
      message: describeFieldError(code),
    };
  }
  if (head === "slug" || head === "brandId" || head === "productTypeId") {
    const focus = {
      slug: GENERAL_FIELD_IDS.slug,
      brandId: GENERAL_FIELD_IDS.brand,
      productTypeId: null,
    }[head];
    return {
      ...base,
      tab: "general",
      field: head,
      focusId: focus,
      message: describeFieldError(code),
    };
  }
  if (head === "attributes") {
    const attributeCode = parts[1];
    if (attributeCode === undefined) {
      return { ...base, tab: "attributes", message: attributeReason(code) };
    }
    const locale = parts[2];
    return {
      ...base,
      tab: "attributes",
      field: path,
      focusId: attributeControlId(attributeCode, locale),
      attributeCode,
      message: attributeReason(code),
    };
  }
  if (head === "variants") {
    const index = parts[1] === undefined || !/^\d+$/.test(parts[1]) ? undefined : Number(parts[1]);
    const variant = index === undefined ? undefined : context.variants[index];
    if (code === "price_missing" && parts.length === 2) {
      // An active variant without a shop-currency price: its amount cell on the Prices tab.
      return {
        ...base,
        tab: "prices",
        field:
          variant === undefined ? null : priceFieldName(variant.id, context.shopCurrency, "amount"),
        focusId:
          variant === undefined
            ? PRICES_FOCUS_ID
            : priceFieldId(variant.id, context.shopCurrency, "amount"),
        ...(index === undefined ? {} : { variantIndex: index }),
        ...(variant === undefined ? {} : { variantId: variant.id, variantSku: variant.sku }),
        message: describeFieldError(code),
      };
    }
    const attributeCode = parts[2] === "attributes" ? parts[3] : undefined;
    return {
      ...base,
      tab: "variants",
      field: attributeCode === undefined ? null : parts.slice(2).join("."),
      focusId: variant === undefined ? VARIANTS_FOCUS_ID : variantRowFocusId(variant.id),
      ...(index === undefined ? {} : { variantIndex: index }),
      ...(variant === undefined ? {} : { variantId: variant.id, variantSku: variant.sku }),
      ...(attributeCode === undefined ? {} : { attributeCode }),
      message: attributeCode === undefined ? describeFieldError(code) : attributeReason(code),
    };
  }
  if (head === "options") {
    const optionCode = parts[1];
    return {
      ...base,
      tab: "options",
      field: optionCode === undefined ? null : `options.${optionCode}`,
      focusId: optionCode === undefined ? OPTIONS_FOCUS_ID : optionFocusId(optionCode),
      message: describeFieldError(code),
    };
  }
  if (head === "media") {
    const index = parts[1] !== undefined && /^\d+$/.test(parts[1]) ? Number(parts[1]) : undefined;
    const rest = parts.slice(2);
    if (index === undefined || rest.length === 0) {
      return { ...base, tab: "media", focusId: MEDIA_FOCUS_ID, message: describeFieldError(code) };
    }
    const control = rest[0] === "optionId" || rest[0] === "optionValueId" ? "link" : rest.join("-");
    return {
      ...base,
      tab: "media",
      field: path,
      focusId: mediaFieldId(index, control),
      message: describeFieldError(code),
    };
  }
  if (head === "categories" || head === "primaryCategoryId") {
    return {
      ...base,
      tab: "categories",
      focusId: CATEGORIES_FOCUS_ID,
      message: describeFieldError(code),
    };
  }
  return { ...base, tab: null, message: describeFieldError(code) };
}

/** Every error of a refused publish, in the API's order, placed on the editor. */
export function mapPublishProblems(
  problem: ProblemDetails,
  context: PublishContext,
): PublishProblem[] {
  return (problem.errors ?? []).map((error) => mapOne(error.path, error.code, context));
}

/**
 * The problems of one tab as field issues (the first of each field), for the tab's inline errors. Variant problems are
 * per variant (`variantIssues`), so they are never mixed into one form here.
 */
export function problemsOnTab(problems: readonly PublishProblem[], tab: EditorTabId): FormIssues {
  const issues: FormIssues = {};
  for (const entry of problems) {
    if (entry.tab === tab && entry.field !== null && entry.variantId === undefined) {
      issues[entry.field] ??= entry.message;
    }
  }
  return issues;
}

/** Every problem of one variant (its row lists them). */
export function variantProblems(
  problems: readonly PublishProblem[],
  variantId: string,
): PublishProblem[] {
  return problems.filter((entry) => entry.tab === "variants" && entry.variantId === variantId);
}

/** One variant's attribute problems as field issues of its form (`attributes.<code>[.<locale>]`). */
export function variantIssues(problems: readonly PublishProblem[], variantId: string): FormIssues {
  const issues: FormIssues = {};
  for (const entry of variantProblems(problems, variantId)) {
    if (entry.field !== null) issues[entry.field] ??= entry.message;
  }
  return issues;
}

/**
 * The Prices tab's publish problems as issues of its grid (by the grid's field names, `<variantId>.<currency>.amount`),
 * so a missing price shows on the cell itself until the tab is saved.
 */
export function priceProblemIssues(problems: readonly PublishProblem[]): FormIssues {
  const issues: FormIssues = {};
  for (const entry of problems) {
    if (entry.tab === "prices" && entry.field !== null) issues[entry.field] ??= entry.message;
  }
  return issues;
}
