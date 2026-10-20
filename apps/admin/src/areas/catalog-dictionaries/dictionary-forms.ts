import type {
  AdminBrand,
  AdminCategory,
  AdminOption,
  AdminProductType,
  CreateAdminBrandBody,
  CreateAdminCategoryBody,
  CreateAdminOptionBody,
  CreateAdminOptionValueBody,
  CreateAdminProductTypeBody,
  LocalizedText,
  MoveAdminCategoryBody,
  ProductTypeAttributeLevel,
  PutProductTypeAttributeBody,
  PutProductTypeOptionBody,
  UpdateAdminBrandBody,
  UpdateAdminCategoryBody,
  UpdateAdminOptionBody,
  UpdateAdminOptionValueBody,
  UpdateAdminProductTypeBody,
} from "@fluxkit/api-client";
import { diffForPatch } from "../../lib/diff-for-patch";
import { describeFieldError } from "../../lib/problem-messages";
import { safeHttpUrl } from "../../lib/safe-http-url";
import {
  CODE_PATTERN,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
  URL_MAX_LENGTH,
  VALUE_CODE_PATTERN,
  issue,
  parsePosition,
  type FormIssues,
} from "./form-rules";
import {
  hasDefaultLocale,
  localeMapFromValues,
  localeValuesFrom,
  optionalLocaleMap,
  type LocaleValues,
} from "./locale-text";

/**
 * The form models of the options, option values and attribute options, product types and their assignments, brands and
 * categories: what each form holds, the early checks, and the request bodies. Pure functions (tests first); the screens
 * only render them. Every PATCH body goes through `diffForPatch` (changed fields only; a locale map is sent whole).
 * Keys of the issue maps are the API's `errors[].path`, so a server answer and a local check land on the same field.
 */

export interface FormOptions {
  defaultLocale: string;
  locales: readonly string[];
}

export type FormMode = "create" | "edit";

export function nameIssue(values: LocaleValues, field: string, options: FormOptions): FormIssues {
  return hasDefaultLocale(values, options.defaultLocale)
    ? {}
    : { [`${field}.${options.defaultLocale}`]: describeFieldError("default_locale_missing") };
}

export function slugIssue(slug: string): FormIssues {
  const trimmed = slug.trim();
  if (trimmed === "") return {};
  return SLUG_PATTERN.test(trimmed) && trimmed.length <= SLUG_MAX_LENGTH
    ? {}
    : { slug: issue("dict.error.slugFormat") };
}

// ------------------------------------------------------------------------ options

export interface OptionFormValues {
  code: string;
  name: LocaleValues;
}

export function emptyOptionForm(locales: readonly string[]): OptionFormValues {
  return { code: "", name: localeValuesFrom(null, locales) };
}

export function optionFormFrom(option: AdminOption, locales: readonly string[]): OptionFormValues {
  return { code: option.code, name: localeValuesFrom(option.name, locales) };
}

export function validateOptionForm(
  values: OptionFormValues,
  mode: FormMode,
  options: FormOptions,
): FormIssues {
  return {
    ...(mode === "create" && !CODE_PATTERN.test(values.code)
      ? { code: issue("dict.error.codeFormat") }
      : {}),
    ...nameIssue(values.name, "name", options),
  };
}

export function optionCreateBody(
  values: OptionFormValues,
  locales: readonly string[],
): CreateAdminOptionBody {
  return { code: values.code, name: localeMapFromValues(values.name, locales) };
}

export function optionPatchBody(
  initial: OptionFormValues,
  current: OptionFormValues,
  locales: readonly string[],
): UpdateAdminOptionBody {
  const fields = (values: OptionFormValues) => ({
    name: localeMapFromValues(values.name, locales),
  });
  return diffForPatch(fields(initial), fields(current));
}

// ------------------------------------------------- items: option values, attribute options

export interface ItemFormValues {
  code: string;
  label: LocaleValues;
  /** Text: empty lets the API pick the place. */
  position: string;
}

export function emptyItemForm(locales: readonly string[]): ItemFormValues {
  return { code: "", label: localeValuesFrom(null, locales), position: "" };
}

export function itemFormFrom(
  item: { code: string; label: LocalizedText; position: number },
  locales: readonly string[],
): ItemFormValues {
  return {
    code: item.code,
    label: localeValuesFrom(item.label, locales),
    position: String(item.position),
  };
}

export function validateItemForm(
  values: ItemFormValues,
  mode: FormMode,
  options: FormOptions,
): FormIssues {
  return {
    ...(mode === "create" && !VALUE_CODE_PATTERN.test(values.code)
      ? { code: issue("dict.error.valueCodeFormat") }
      : {}),
    ...nameIssue(values.label, "label", options),
    ...(parsePosition(values.position).ok ? {} : { position: issue("dict.error.positionInvalid") }),
  };
}

export function itemCreateBody(
  values: ItemFormValues,
  locales: readonly string[],
): CreateAdminOptionValueBody {
  const position = parsePosition(values.position);
  return {
    code: values.code,
    label: localeMapFromValues(values.label, locales),
    ...(position.ok && position.value !== undefined ? { position: position.value } : {}),
  };
}

/** An emptied position on edit means "as before": the API cannot clear a position, so it is not sent. */
export function itemPatchBody(
  initial: ItemFormValues,
  current: ItemFormValues,
  locales: readonly string[],
): UpdateAdminOptionValueBody {
  const fields = (values: ItemFormValues) => {
    const position = parsePosition(values.position);
    return {
      label: localeMapFromValues(values.label, locales),
      ...(position.ok && position.value !== undefined ? { position: position.value } : {}),
    };
  };
  return diffForPatch(fields(initial), fields(current));
}

// ------------------------------------------------------------------ product types

export interface ProductTypeFormValues {
  code: string;
  name: LocaleValues;
  requiresShipping: boolean;
}

export function emptyProductTypeForm(locales: readonly string[]): ProductTypeFormValues {
  return { code: "", name: localeValuesFrom(null, locales), requiresShipping: true };
}

export function productTypeFormFrom(
  type: AdminProductType,
  locales: readonly string[],
): ProductTypeFormValues {
  return {
    code: type.code,
    name: localeValuesFrom(type.name, locales),
    requiresShipping: type.requiresShipping,
  };
}

export function validateProductTypeForm(
  values: ProductTypeFormValues,
  mode: FormMode,
  options: FormOptions,
): FormIssues {
  return validateOptionForm(values, mode, options);
}

export function productTypeCreateBody(
  values: ProductTypeFormValues,
  locales: readonly string[],
): CreateAdminProductTypeBody {
  return {
    code: values.code,
    name: localeMapFromValues(values.name, locales),
    requiresShipping: values.requiresShipping,
  };
}

export function productTypePatchBody(
  initial: ProductTypeFormValues,
  current: ProductTypeFormValues,
  locales: readonly string[],
): UpdateAdminProductTypeBody {
  const fields = (values: ProductTypeFormValues) => ({
    name: localeMapFromValues(values.name, locales),
    requiresShipping: values.requiresShipping,
  });
  return diffForPatch(fields(initial), fields(current));
}

export interface AttributeAssignmentValues {
  attributeId: string;
  level: ProductTypeAttributeLevel;
  isRequired: boolean;
  position: string;
}

export interface OptionAssignmentValues {
  optionId: string;
  position: string;
}

const positionIssue = (text: string): FormIssues =>
  parsePosition(text).ok ? {} : { position: issue("dict.error.positionInvalid") };

export function validateAttributeAssignment(
  values: AttributeAssignmentValues,
  mode: "add" | "edit",
): FormIssues {
  return {
    ...(mode === "add" && values.attributeId === ""
      ? { attributeId: issue("dict.error.pickerRequired") }
      : {}),
    ...positionIssue(values.position),
  };
}

export function validateOptionAssignment(
  values: OptionAssignmentValues,
  mode: "add" | "edit",
): FormIssues {
  return {
    ...(mode === "add" && values.optionId === ""
      ? { optionId: issue("dict.error.pickerRequired") }
      : {}),
    ...positionIssue(values.position),
  };
}

export function attributeAssignmentBody(
  values: AttributeAssignmentValues,
): PutProductTypeAttributeBody {
  const position = parsePosition(values.position);
  return {
    level: values.level,
    isRequired: values.isRequired,
    ...(position.ok && position.value !== undefined ? { position: position.value } : {}),
  };
}

export function optionAssignmentBody(values: OptionAssignmentValues): PutProductTypeOptionBody {
  const position = parsePosition(values.position);
  return position.ok && position.value !== undefined ? { position: position.value } : {};
}

// ---------------------------------------------------------------------------- brands

export interface BrandFormValues {
  name: LocaleValues;
  description: LocaleValues;
  logoUrl: string;
  slug: string;
}

export function emptyBrandForm(locales: readonly string[]): BrandFormValues {
  return {
    name: localeValuesFrom(null, locales),
    description: localeValuesFrom(null, locales),
    logoUrl: "",
    slug: "",
  };
}

export function brandFormFrom(brand: AdminBrand, locales: readonly string[]): BrandFormValues {
  return {
    name: localeValuesFrom(brand.name, locales),
    description: localeValuesFrom(brand.description, locales),
    logoUrl: brand.logoUrl ?? "",
    slug: brand.slug,
  };
}

/** The logo must be an absolute http(s) URL of at most 2048 characters (`safeHttpUrl`, the API checks it too). */
export function validateBrandForm(
  values: BrandFormValues,
  options: FormOptions,
  mode: FormMode = "create",
): FormIssues {
  const logo = values.logoUrl.trim();
  return {
    ...nameIssue(values.name, "name", options),
    ...(mode === "edit" && values.slug.trim() === ""
      ? { slug: describeFieldError("required") }
      : slugIssue(values.slug)),
    ...(logo !== "" && (logo.length > URL_MAX_LENGTH || safeHttpUrl(logo) === null)
      ? { logoUrl: issue("dict.error.urlInvalid") }
      : {}),
  };
}

export function brandCreateBody(
  values: BrandFormValues,
  locales: readonly string[],
): CreateAdminBrandBody {
  const description = optionalLocaleMap(values.description, locales);
  const logoUrl = values.logoUrl.trim();
  const slug = values.slug.trim();
  return {
    name: localeMapFromValues(values.name, locales),
    ...(description === undefined ? {} : { description }),
    ...(logoUrl === "" ? {} : { logoUrl }),
    ...(slug === "" ? {} : { slug }),
  };
}

export function brandPatchBody(
  initial: BrandFormValues,
  current: BrandFormValues,
  locales: readonly string[],
): UpdateAdminBrandBody {
  const fields = (values: BrandFormValues) => ({
    name: localeMapFromValues(values.name, locales),
    description: optionalLocaleMap(values.description, locales) ?? null,
    logoUrl: values.logoUrl.trim() === "" ? null : values.logoUrl.trim(),
    slug: values.slug.trim(),
  });
  return diffForPatch(fields(initial), fields(current));
}

// ------------------------------------------------------------------------ categories

export interface CategoryFormValues {
  name: LocaleValues;
  description: LocaleValues;
  slug: string;
  isActive: boolean;
  /** Create only: `""` is the root level. */
  parentId: string;
}

export function emptyCategoryForm(
  locales: readonly string[],
  parentId: string | null,
): CategoryFormValues {
  return {
    name: localeValuesFrom(null, locales),
    description: localeValuesFrom(null, locales),
    slug: "",
    isActive: true,
    parentId: parentId ?? "",
  };
}

export function categoryFormFrom(
  category: AdminCategory,
  locales: readonly string[],
): CategoryFormValues {
  return {
    name: localeValuesFrom(category.name, locales),
    description: localeValuesFrom(category.description, locales),
    slug: category.slug,
    isActive: category.isActive,
    parentId: category.parentId ?? "",
  };
}

/** On create the slug is optional (generated from the name); an existing category always has one. */
export function validateCategoryForm(
  values: CategoryFormValues,
  options: FormOptions,
  mode: FormMode = "create",
): FormIssues {
  return {
    ...nameIssue(values.name, "name", options),
    ...(mode === "edit" && values.slug.trim() === ""
      ? { slug: describeFieldError("required") }
      : slugIssue(values.slug)),
  };
}

/** The new category goes last among its siblings (no `position`): reordering is the move action's job. */
export function categoryCreateBody(
  values: CategoryFormValues,
  locales: readonly string[],
): CreateAdminCategoryBody {
  const description = optionalLocaleMap(values.description, locales);
  const slug = values.slug.trim();
  return {
    name: localeMapFromValues(values.name, locales),
    ...(description === undefined ? {} : { description }),
    ...(slug === "" ? {} : { slug }),
    ...(values.parentId === "" ? {} : { parentId: values.parentId }),
    isActive: values.isActive,
  };
}

/** `parentId` and `position` change only through the move route (the API refuses them in a PATCH). */
export function categoryPatchBody(
  initial: CategoryFormValues,
  current: CategoryFormValues,
  locales: readonly string[],
): UpdateAdminCategoryBody {
  const fields = (values: CategoryFormValues) => ({
    name: localeMapFromValues(values.name, locales),
    description: optionalLocaleMap(values.description, locales) ?? null,
    slug: values.slug.trim(),
    isActive: values.isActive,
  });
  return diffForPatch(fields(initial), fields(current));
}

export interface MoveFormValues {
  /** `""` moves to the root level. */
  parentId: string;
  position: string;
}

export function validateMoveForm(values: MoveFormValues): FormIssues {
  return positionIssue(values.position);
}

export function moveCategoryBody(values: MoveFormValues): MoveAdminCategoryBody {
  const position = parsePosition(values.position);
  return {
    parentId: values.parentId === "" ? null : values.parentId,
    ...(position.ok && position.value !== undefined ? { position: position.value } : {}),
  };
}
