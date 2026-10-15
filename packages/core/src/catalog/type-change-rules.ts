/**
 * Pure decisions for ADR 0006 section 5 ("Changing a ProductType and its attributes/options after
 * products exist"). Each function takes facts the service already looked up in the database
 * (for example `valuesExist`); none of them reads anything itself.
 *
 * Changes the ADR marks "always allowed" have no function: changing validation, flags, labels,
 * names, descriptions and positions; adding an attribute option or an option value; assigning an
 * attribute to a type; adding a value to a product option of an active product.
 */
import type { AttributeInputType, AttributeLevel, ProductStatus } from "./types.js";

export type TypeChangeReason =
  | "code_immutable"
  | "input_type_immutable"
  | "is_localized_immutable"
  | "unit_in_use"
  | "level_in_use"
  | "attribute_assignment_in_use"
  | "attribute_option_in_use"
  | "option_value_in_use"
  | "attribute_assigned"
  | "option_assigned_to_product_type"
  | "option_in_use_by_products"
  | "product_type_in_use"
  | "product_type_immutable"
  | "product_options_frozen"
  | "product_option_value_in_use";

export type TypeChangeDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: TypeChangeReason };

const ALLOWED: TypeChangeDecision = Object.freeze({ allowed: true });

function forbid(reason: TypeChangeReason): TypeChangeDecision {
  return { allowed: false, reason };
}

function forbidIf(condition: boolean, reason: TypeChangeReason): TypeChangeDecision {
  return condition ? forbid(reason) : ALLOWED;
}

/** Any `code` (attribute, attribute option, option, option value, product type) is immutable. */
export function decideCodeChange(change: {
  readonly currentCode: string;
  readonly nextCode: string;
}): TypeChangeDecision {
  return forbidIf(change.currentCode !== change.nextCode, "code_immutable");
}

export function decideInputTypeChange(change: {
  readonly current: AttributeInputType;
  readonly next: AttributeInputType;
}): TypeChangeDecision {
  return forbidIf(change.current !== change.next, "input_type_immutable");
}

export function decideLocalizationChange(change: {
  readonly current: boolean;
  readonly next: boolean;
}): TypeChangeDecision {
  return forbidIf(change.current !== change.next, "is_localized_immutable");
}

/** Values are bare numbers, so a new unit silently changes their meaning: only while none exist. */
export function decideUnitChange(
  change: { readonly currentUnit: string | null; readonly nextUnit: string | null },
  facts: { readonly valuesExist: boolean },
): TypeChangeDecision {
  return forbidIf(change.currentUnit !== change.nextUnit && facts.valuesExist, "unit_in_use");
}

export function decideLevelChange(
  change: { readonly currentLevel: AttributeLevel; readonly nextLevel: AttributeLevel },
  facts: { readonly valuesExist: boolean },
): TypeChangeDecision {
  return forbidIf(change.currentLevel !== change.nextLevel && facts.valuesExist, "level_in_use");
}

export function decideRemoveAttributeFromType(facts: {
  readonly valuesExist: boolean;
}): TypeChangeDecision {
  return forbidIf(facts.valuesExist, "attribute_assignment_in_use");
}

export function decideDeleteAttributeOption(facts: {
  readonly valuesUseCode: boolean;
}): TypeChangeDecision {
  return forbidIf(facts.valuesUseCode, "attribute_option_in_use");
}

/** The database enforces this with `RESTRICT` from `product_option_value`; the service reports it first. */
export function decideDeleteOptionValue(facts: {
  readonly usedByProducts: boolean;
}): TypeChangeDecision {
  return forbidIf(facts.usedByProducts, "option_value_in_use");
}

export function decideDeleteAttribute(facts: {
  readonly assignedToProductTypes: boolean;
}): TypeChangeDecision {
  return forbidIf(facts.assignedToProductTypes, "attribute_assigned");
}

export function decideDeleteOption(facts: {
  readonly assignedToProductTypes: boolean;
  readonly usedByProducts: boolean;
}): TypeChangeDecision {
  if (facts.assignedToProductTypes) {
    return forbid("option_assigned_to_product_type");
  }
  return forbidIf(facts.usedByProducts, "option_in_use_by_products");
}

export function decideDeleteProductType(facts: { readonly hasProducts: boolean }): TypeChangeDecision {
  return forbidIf(facts.hasProducts, "product_type_in_use");
}

export function decideRemoveOptionFromType(facts: {
  readonly usedByProducts: boolean;
}): TypeChangeDecision {
  return forbidIf(facts.usedByProducts, "option_in_use_by_products");
}

/** A product keeps its type forever: attributes and options depend on it. */
export function decideChangeProductType(change: {
  readonly currentId: string;
  readonly nextId: string;
}): TypeChangeDecision {
  return forbidIf(change.currentId !== change.nextId, "product_type_immutable");
}

/** Adding or removing a `product_option` is allowed only while the product is a draft. */
export function decideProductOptionChange(facts: {
  readonly productStatus: ProductStatus;
}): TypeChangeDecision {
  return forbidIf(facts.productStatus !== "draft", "product_options_frozen");
}

export function decideRemoveProductOptionValue(facts: {
  readonly usedByVariantsOrMedia: boolean;
}): TypeChangeDecision {
  return forbidIf(facts.usedByVariantsOrMedia, "product_option_value_in_use");
}
