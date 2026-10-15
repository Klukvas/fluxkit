/**
 * Planning a change of the options a product uses and the values it chose (ADR 0006 sections 3
 * and 5). It works on ids (`option.id`, `option_value.id`) and reads nothing itself; the service
 * applies the returned plan in one transaction.
 */
import { CATALOG_LIMITS } from "./limits.js";
import type { ProductStatus } from "./types.js";

export interface ProductOptionSelection {
  readonly optionId: string;
  readonly valueIds: readonly string[];
}

export interface ProductOptionLimits {
  readonly maxOptionsPerProduct: number;
  readonly maxValuesPerProductOption: number;
}

export interface PlanProductOptionChangeInput {
  readonly productStatus: ProductStatus;
  readonly current: readonly ProductOptionSelection[];
  readonly desired: readonly ProductOptionSelection[];
  /** Ids of the options the product type allows. */
  readonly allowedOptionIds: readonly string[];
  readonly limits?: Partial<ProductOptionLimits>;
}

export type ProductOptionChangeErrorReason =
  | "too_many_options"
  | "empty_value_list"
  | "too_many_values"
  | "duplicate_option"
  | "duplicate_value"
  | "option_not_allowed"
  | "options_frozen";

export interface ProductOptionChangeError {
  readonly reason: ProductOptionChangeErrorReason;
  readonly optionId?: string;
  readonly valueId?: string;
  readonly limit?: number;
  readonly actual?: number;
}

export interface ProductOptionChangePlan {
  readonly hasChanges: boolean;
  /**
   * True when the option set or the chosen values changed on a draft: the service then rebuilds all
   * variants. On a published or archived product only new combinations are generated.
   */
  readonly regeneratesAllVariants: boolean;
  readonly addedOptionIds: readonly string[];
  readonly removedOptionIds: readonly string[];
  /** Values newly chosen, per option, including every value of an added option. */
  readonly addedValues: readonly ProductOptionSelection[];
  /** Values dropped, per option, including every value of a removed option. */
  readonly removedValues: readonly ProductOptionSelection[];
}

export type PlanProductOptionChangeResult =
  | { readonly ok: true; readonly plan: ProductOptionChangePlan }
  | { readonly ok: false; readonly errors: readonly ProductOptionChangeError[] };

/** Drops keys whose value is undefined so that they cannot override a default limit. */
function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  if (value === undefined) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

function validateDesired(
  desired: readonly ProductOptionSelection[],
  allowedOptionIds: readonly string[],
  limits: ProductOptionLimits,
): ProductOptionChangeError[] {
  const errors: ProductOptionChangeError[] = [];
  if (desired.length > limits.maxOptionsPerProduct) {
    errors.push({
      reason: "too_many_options",
      limit: limits.maxOptionsPerProduct,
      actual: desired.length,
    });
  }
  const seenOptions = new Set<string>();
  for (const { optionId, valueIds } of desired) {
    if (seenOptions.has(optionId)) {
      errors.push({ reason: "duplicate_option", optionId });
    }
    seenOptions.add(optionId);
    if (!allowedOptionIds.includes(optionId)) {
      errors.push({ reason: "option_not_allowed", optionId });
    }
    if (valueIds.length === 0) {
      errors.push({ reason: "empty_value_list", optionId });
    }
    if (valueIds.length > limits.maxValuesPerProductOption) {
      errors.push({
        reason: "too_many_values",
        optionId,
        limit: limits.maxValuesPerProductOption,
        actual: valueIds.length,
      });
    }
    const seenValues = new Set<string>();
    for (const valueId of valueIds) {
      if (seenValues.has(valueId)) {
        errors.push({ reason: "duplicate_value", optionId, valueId });
      }
      seenValues.add(valueId);
    }
  }
  return errors;
}

function valuesByOption(
  selections: readonly ProductOptionSelection[],
): Map<string, readonly string[]> {
  return new Map(selections.map((selection) => [selection.optionId, selection.valueIds]));
}

/**
 * While the product is a draft any change is allowed (the service regenerates all variants). Once
 * it is active or archived the option set and the chosen values are frozen, except that new values
 * may be added to options the product already uses (then only the missing variants are generated).
 */
export function planProductOptionChange(
  input: PlanProductOptionChangeInput,
): PlanProductOptionChangeResult {
  const limits: ProductOptionLimits = {
    maxOptionsPerProduct: CATALOG_LIMITS.maxOptionsPerProduct,
    maxValuesPerProductOption: CATALOG_LIMITS.maxValuesPerProductOption,
    ...definedOnly(input.limits),
  };
  const errors = validateDesired(input.desired, input.allowedOptionIds, limits);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const currentValues = valuesByOption(input.current);
  const desiredValues = valuesByOption(input.desired);

  const addedOptionIds = [...desiredValues.keys()].filter((id) => !currentValues.has(id));
  const removedOptionIds = [...currentValues.keys()].filter((id) => !desiredValues.has(id));
  const addedValues: ProductOptionSelection[] = [];
  const removedValues: ProductOptionSelection[] = [];

  for (const [optionId, valueIds] of desiredValues) {
    const before = currentValues.get(optionId) ?? [];
    const added = valueIds.filter((valueId) => !before.includes(valueId));
    if (added.length > 0) {
      addedValues.push({ optionId, valueIds: added });
    }
  }
  for (const [optionId, valueIds] of currentValues) {
    const after = desiredValues.get(optionId) ?? [];
    const removed = valueIds.filter((valueId) => !after.includes(valueId));
    if (removed.length > 0) {
      removedValues.push({ optionId, valueIds: removed });
    }
  }

  const hasChanges =
    addedOptionIds.length > 0 ||
    removedOptionIds.length > 0 ||
    addedValues.length > 0 ||
    removedValues.length > 0;

  if (input.productStatus !== "draft") {
    const frozen: ProductOptionChangeError[] = [
      ...addedOptionIds.map((optionId) => ({ reason: "options_frozen" as const, optionId })),
      ...removedOptionIds.map((optionId) => ({ reason: "options_frozen" as const, optionId })),
      ...removedValues
        .filter(({ optionId }) => !removedOptionIds.includes(optionId))
        .flatMap(({ optionId, valueIds }) =>
          valueIds.map((valueId) => ({ reason: "options_frozen" as const, optionId, valueId })),
        ),
    ];
    if (frozen.length > 0) {
      return { ok: false, errors: frozen };
    }
  }

  return {
    ok: true,
    plan: {
      hasChanges,
      regeneratesAllVariants: hasChanges && input.productStatus === "draft",
      addedOptionIds,
      removedOptionIds,
      addedValues,
      removedValues,
    },
  };
}
