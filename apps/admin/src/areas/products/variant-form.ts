import type {
  AdminProduct,
  AdminVariant,
  CreateAdminVariantBody,
  ProblemDetails,
  UpdateAdminVariantBody,
} from "@fluxkit/api-client";
import { diffForPatch } from "../../lib/diff-for-patch";
import type { FormErrors } from "../../lib/form-errors";
import {
  describeFieldError,
  describeProblem,
  type MessageDescriptor,
} from "../../lib/problem-messages";
import { issue, type FormIssues } from "../catalog-dictionaries/form-rules";
import { formErrorsFromProblem } from "../catalog-dictionaries/submit-errors";
import { attributeReason } from "./attribute-values-form";

/**
 * The Variants tab's model (ADR 0006 sections 6 and 7, ADR 0008, 0013, 0020; `docs/api/catalog.md`): the edit form of one
 * variant (SKU, barcode, the flags; its attributes come from `attribute-values-form.ts` at the variant level), the
 * create form of a draft product's variant, and which row actions the API would refuse (hints only: the API decides and
 * its refusal is shown). Prices and stock are not here (step 7). Pure.
 */

/** Core's SKU rules (`packages/core/src/catalog/sku.ts`, `TEXT_LIMITS`; compared in the spec, core is not bundled). */
export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
export const SKU_MAX_LENGTH = 64;
export const BARCODE_MAX_LENGTH = 64;

/** Core's `normalizeSku`: trimmed, ASCII letters upper case (no Unicode case mapping), as the API stores it. */
export function normalizeSku(raw: string): string {
  return raw.trim().replace(/[a-z]/g, (letter) => letter.toUpperCase());
}

/** Core's `validateSku` reason (`empty`, `too_long`, `invalid_format`) as a message, or `null` for a valid SKU. */
export function skuIssue(raw: string): MessageDescriptor | null {
  const sku = normalizeSku(raw);
  if (sku.length === 0) return describeFieldError("empty");
  if (sku.length > SKU_MAX_LENGTH) return describeFieldError("too_long");
  return SKU_PATTERN.test(sku) ? null : describeFieldError("invalid_format");
}

function barcodeIssue(raw: string): MessageDescriptor | null {
  return [...raw.trim()].length > BARCODE_MAX_LENGTH ? describeFieldError("too_long") : null;
}

const barcodeOf = (raw: string): string | null => (raw.trim() === "" ? null : raw.trim());

// ------------------------------------------------------------------------------------------- edit

export interface VariantFormValues {
  sku: string;
  barcode: string;
  isActive: boolean;
  trackInventory: boolean;
  allowBackorder: boolean;
}

export function variantFormFrom(variant: AdminVariant): VariantFormValues {
  return {
    sku: variant.sku,
    barcode: variant.barcode ?? "",
    isActive: variant.isActive,
    trackInventory: variant.trackInventory,
    allowBackorder: variant.allowBackorder,
  };
}

export function validateVariantForm(values: VariantFormValues): FormIssues {
  const issues: FormIssues = {};
  const sku = skuIssue(values.sku);
  if (sku !== null) issues["sku"] = sku;
  const barcode = barcodeIssue(values.barcode);
  if (barcode !== null) issues["barcode"] = barcode;
  return issues;
}

/**
 * `PATCH /admin/products/{id}/variants/{variantId}` with the changed fields only (`diffForPatch`): the SKU compared after
 * normalization (typing the stored SKU in lower case is no change), an emptied barcode `null`, each flag on its own, and
 * the variant's attribute map (`{attributes}` from `attributesPatchBody`, whole, only when it changed).
 */
export function variantPatchBody(
  variant: AdminVariant,
  values: VariantFormValues,
  attributes: Pick<UpdateAdminVariantBody, "attributes"> = {},
): UpdateAdminVariantBody {
  return {
    ...diffForPatch(
      {
        sku: variant.sku,
        barcode: variant.barcode,
        isActive: variant.isActive,
        trackInventory: variant.trackInventory,
        allowBackorder: variant.allowBackorder,
      },
      {
        sku: normalizeSku(values.sku),
        barcode: barcodeOf(values.barcode),
        isActive: values.isActive,
        trackInventory: values.trackInventory,
        allowBackorder: values.allowBackorder,
      },
    ),
    ...attributes,
  };
}

// ----------------------------------------------------------------------------------------- create

export interface VariantCreateValues {
  /** One chosen value per product option, by option id (`""`: none yet). */
  valueIds: Record<string, string>;
  sku: string;
  barcode: string;
  isActive: boolean;
  trackInventory: boolean;
  allowBackorder: boolean;
}

const optionOrder = (product: AdminProduct) =>
  [...product.options].sort((left, right) => left.position - right.position);

/** An empty create form: no value chosen, active, stock tracked unless the type does not ship (the API's default). */
export function newVariantValues(
  product: AdminProduct,
  requiresShipping: boolean,
): VariantCreateValues {
  const valueIds: Record<string, string> = {};
  for (const option of optionOrder(product)) valueIds[option.optionId] = "";
  return {
    valueIds,
    sku: "",
    barcode: "",
    isActive: true,
    trackInventory: requiresShipping,
    allowBackorder: false,
  };
}

/** Whether a variant of the product already has exactly these option values. */
export function combinationTaken(product: AdminProduct, valueIds: readonly string[]): boolean {
  const wanted = [...valueIds].sort().join(",");
  return product.variants.some(
    (variant) =>
      variant.optionValues
        .map((value) => value.optionValueId)
        .sort()
        .join(",") === wanted,
  );
}

/** Early feedback: a value per option (`optionValueIds.<optionId>`), a free combination, a valid SKU when typed. */
export function validateVariantCreate(
  values: VariantCreateValues,
  product: AdminProduct,
): FormIssues {
  const issues: FormIssues = {};
  const chosen: string[] = [];
  for (const option of optionOrder(product)) {
    const valueId = values.valueIds[option.optionId] ?? "";
    if (valueId === "")
      issues[`optionValueIds.${option.optionId}`] = describeFieldError("required");
    else chosen.push(valueId);
  }
  if (chosen.length === product.options.length && combinationTaken(product, chosen)) {
    issues["optionValueIds"] = issue("products.variants.combinationTaken");
  }
  if (values.sku.trim() !== "") {
    const sku = skuIssue(values.sku);
    if (sku !== null) issues["sku"] = sku;
  }
  const barcode = barcodeIssue(values.barcode);
  if (barcode !== null) issues["barcode"] = barcode;
  return issues;
}

/** `POST /admin/products/{id}/variants`: the values in the product's option order; the API proposes a SKU when none is typed. */
export function variantCreateBody(
  values: VariantCreateValues,
  product: AdminProduct,
): CreateAdminVariantBody {
  const sku = normalizeSku(values.sku);
  const barcode = barcodeOf(values.barcode);
  return {
    optionValueIds: optionOrder(product).map((option) => values.valueIds[option.optionId] ?? ""),
    ...(sku === "" ? {} : { sku }),
    ...(barcode === null ? {} : { barcode }),
    isActive: values.isActive,
    trackInventory: values.trackInventory,
    allowBackorder: values.allowBackorder,
  };
}

// ------------------------------------------------------------------------------------ row actions

/** Why the API would refuse to delete the variant (core `canDeleteVariant`), as far as the screen can know; `null`: try. */
export function deleteBlock(
  product: AdminProduct,
  variant: AdminVariant,
): "product_not_draft" | "default_variant" | "last_variant" | null {
  if (product.status !== "draft") return "product_not_draft";
  if (product.variants.length <= 1) return "last_variant";
  if (variant.isDefault) return "default_variant";
  return null;
}

/** Why "make default" is not offered: it is the default, or a live product's default must be active. */
export function defaultBlock(
  product: AdminProduct,
  variant: AdminVariant,
): "already_default" | "default_variant_inactive" | null {
  if (variant.isDefault) return "already_default";
  if (product.status === "active" && !variant.isActive) return "default_variant_inactive";
  return null;
}

/**
 * Switching the variant on or off. A published product must keep its default variant active and at least one active
 * variant (the API's `default_variant_inactive`, `no_active_variant`); switching on may still be refused for a missing
 * price or required attribute (ADR 0008), which only the API knows.
 */
export function activeToggle(
  product: AdminProduct,
  variant: AdminVariant,
): { next: boolean; block: "default_variant_inactive" | "no_active_variant" | null } {
  const next = !variant.isActive;
  if (next || product.status !== "active") return { next, block: null };
  if (variant.isDefault) return { next, block: "default_variant_inactive" };
  const othersActive = product.variants.some((other) => other.id !== variant.id && other.isActive);
  return { next, block: othersActive ? null : "no_active_variant" };
}

// ------------------------------------------------------------------------------------ server errors

/**
 * A refused variant write on the form: a `409 conflict` on `sku` (a SKU another variant has) on the SKU field;
 * `400` errors at `attributes.<code>[.<locale>]` on that attribute with the attribute reason; other paths on their field
 * when the form has it; everything else (rules such as `price_missing`, `default_variant_inactive`) in the summary.
 */
export function variantErrorsFromProblem(
  problem: ProblemDetails,
  status: number,
  formFields: readonly string[],
): FormErrors<string> {
  if (problem.code === "conflict") return formErrorsFromProblem(problem, status, formFields);
  const fields: Partial<Record<string, MessageDescriptor>> = {};
  const other: MessageDescriptor[] = [];
  if (problem.errors === undefined || problem.errors.length === 0) {
    return { fields, other: [describeProblem(status, problem)] };
  }
  for (const error of problem.errors) {
    const isAttribute = error.path === "attributes" || error.path.startsWith("attributes.");
    const descriptor = isAttribute ? attributeReason(error.code) : describeFieldError(error.code);
    if (formFields.includes(error.path)) fields[error.path] ??= descriptor;
    else other.push(descriptor);
  }
  return { fields, other };
}
