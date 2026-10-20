import type {
  AdminProduct,
  CreateAdminProductBody,
  UpdateAdminProductBody,
} from "@fluxkit/api-client";
import { diffForPatch } from "../../lib/diff-for-patch";
import { describeFieldError } from "../../lib/problem-messages";
import {
  nameIssue,
  slugIssue,
  type FormMode,
  type FormOptions,
} from "../catalog-dictionaries/dictionary-forms";
import { issue, type FormIssues } from "../catalog-dictionaries/form-rules";
import {
  localeFieldNames,
  localeMapFromValues,
  localeValuesFrom,
  optionalLocaleMap,
  type LocaleValues,
} from "../catalog-dictionaries/locale-text";

/**
 * The form model of a product's general fields (create, and the General tab): product type (create only), slug, brand,
 * title and description. No SEO fields: the API has none (plan, out of scope). Pure; tested first. Limits are core's
 * `TEXT_LIMITS` (compared in the spec; core is not in the bundle). The server decides; a refusal lands on its field.
 */
export const TITLE_MAX_LENGTH = 255;
export const DESCRIPTION_MAX_LENGTH = 20_000;

export interface ProductFormValues {
  /** Create only; the API refuses a change of the type (`product_type_immutable`). */
  productTypeId: string;
  /** `""` on create: the API generates it from the default-locale title. */
  slug: string;
  /** `""` is "no brand". */
  brandId: string;
  title: LocaleValues;
  description: LocaleValues;
}

export function emptyProductForm(locales: readonly string[]): ProductFormValues {
  return {
    productTypeId: "",
    slug: "",
    brandId: "",
    title: localeValuesFrom(null, locales),
    description: localeValuesFrom(null, locales),
  };
}

export function productFormFrom(
  product: AdminProduct,
  locales: readonly string[],
): ProductFormValues {
  return {
    productTypeId: product.productTypeId,
    slug: product.slug,
    brandId: product.brandId ?? "",
    title: localeValuesFrom(product.title, locales),
    description: localeValuesFrom(product.description, locales),
  };
}

/** The field names of the form, equal to the API's `errors[].path`. */
export function productFieldNames(locales: readonly string[]): string[] {
  return [
    "productTypeId",
    "slug",
    "brandId",
    ...localeFieldNames("title", locales),
    ...localeFieldNames("description", locales),
  ];
}

function lengthIssues(values: LocaleValues, field: string, max: number): FormIssues {
  const issues: FormIssues = {};
  for (const [locale, text] of Object.entries(values)) {
    if ([...text.trim()].length > max)
      issues[`${field}.${locale}`] = describeFieldError("too_long");
  }
  return issues;
}

export function validateProductForm(
  values: ProductFormValues,
  options: FormOptions,
  mode: FormMode,
): FormIssues {
  return {
    ...(mode === "create" && values.productTypeId === ""
      ? { productTypeId: issue("dict.error.pickerRequired") }
      : {}),
    ...(mode === "edit" && values.slug.trim() === ""
      ? { slug: describeFieldError("required") }
      : slugIssue(values.slug)),
    ...nameIssue(values.title, "title", options),
    ...lengthIssues(values.title, "title", TITLE_MAX_LENGTH),
    ...lengthIssues(values.description, "description", DESCRIPTION_MAX_LENGTH),
  };
}

/** `POST /admin/products`: the API creates the draft and its default variant; attributes come later (Attributes tab). */
export function productCreateBody(
  values: ProductFormValues,
  locales: readonly string[],
): CreateAdminProductBody {
  const description = optionalLocaleMap(values.description, locales);
  const slug = values.slug.trim();
  return {
    productTypeId: values.productTypeId,
    title: localeMapFromValues(values.title, locales),
    ...(slug === "" ? {} : { slug }),
    ...(values.brandId === "" ? {} : { brandId: values.brandId }),
    ...(description === undefined ? {} : { description }),
  };
}

/**
 * `PATCH /admin/products/{id}` of the General tab: only the fields that differ from the stored ones (`diffForPatch`); a
 * changed locale map is sent whole (the API replaces maps), an emptied description or brand is `null`. The product type
 * is never sent (it cannot change).
 */
export function productPatchBody(
  initial: ProductFormValues,
  current: ProductFormValues,
  locales: readonly string[],
): UpdateAdminProductBody {
  const fields = (values: ProductFormValues) => ({
    slug: values.slug.trim(),
    brandId: values.brandId === "" ? null : values.brandId,
    title: localeMapFromValues(values.title, locales),
    description: optionalLocaleMap(values.description, locales) ?? null,
  });
  return diffForPatch(fields(initial), fields(current));
}
