import type { ProblemDetails } from "@fluxkit/api-client";
import { describeFieldError, type MessageDescriptor } from "../../lib/problem-messages";
import type { FormIssues } from "../catalog-dictionaries/form-rules";
import { attributeReason } from "./attribute-values-form";
import {
  CATEGORIES_FOCUS_ID,
  GENERAL_FIELD_IDS,
  attributeControlId,
  placeholderFocusId,
} from "./field-ids";

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
 * tab that owns the path, the form field (the API path, for the inline error), the element to focus, and for a variant
 * problem its index `N` in the product detail's variant order (the API's `variants.N`) and its SKU.
 */
export interface PublishProblem {
  path: string;
  /** `null`: no tab owns the path; the summary lists it without a link. */
  tab: EditorTabId | null;
  field: string | null;
  focusId: string | null;
  variantIndex?: number;
  variantSku?: string;
  attributeCode?: string;
  message: MessageDescriptor;
}

export interface PublishContext {
  defaultLocale: string;
  /** The product detail's variants, in its order. */
  variants: readonly { sku: string }[];
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
    const sku = index === undefined ? undefined : context.variants[index]?.sku;
    const attributeCode = parts[2] === "attributes" ? parts[3] : undefined;
    return {
      ...base,
      tab: "variants",
      focusId: placeholderFocusId("variants"),
      ...(index === undefined ? {} : { variantIndex: index }),
      ...(sku === undefined ? {} : { variantSku: sku }),
      ...(attributeCode === undefined ? {} : { attributeCode }),
      message: attributeCode === undefined ? describeFieldError(code) : attributeReason(code),
    };
  }
  if (head === "options") {
    return {
      ...base,
      tab: "options",
      focusId: placeholderFocusId("options"),
      message: describeFieldError(code),
    };
  }
  if (head === "media") {
    return {
      ...base,
      tab: "media",
      focusId: placeholderFocusId("media"),
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

/** The problems of one tab as field issues (the first of each field), for the tab's inline errors. */
export function problemsOnTab(problems: readonly PublishProblem[], tab: EditorTabId): FormIssues {
  const issues: FormIssues = {};
  for (const entry of problems) {
    if (entry.tab === tab && entry.field !== null) issues[entry.field] ??= entry.message;
  }
  return issues;
}
