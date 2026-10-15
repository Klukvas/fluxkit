import { CATALOG_LIMITS, isValidCode, isValidValueCode } from "./limits.js";
import type { OptionValuePair, VariantSnapshot } from "./types.js";

/**
 * The string stored in `variant.option_signature`: `code=value` pairs sorted by option code and
 * joined with `;`; empty for a variant without options (ADR 0006 section 3). Sorting by code,
 * not by position, keeps it stable when the admin reorders options.
 */
export function computeOptionSignature(pairs: readonly OptionValuePair[]): string {
  for (const pair of pairs) {
    if (!isValidCode(pair.optionCode) || !isValidValueCode(pair.valueCode)) {
      // A code containing ";" or "=" could make two different combinations share a signature.
      throw new RangeError(
        `Invalid option or value code in signature: "${pair.optionCode}=${pair.valueCode}"`,
      );
    }
  }
  return [...pairs]
    .sort((left, right) => compareCodes(left.optionCode, right.optionCode))
    .map((pair) => `${pair.optionCode}=${pair.valueCode}`)
    .join(";");
}

function compareCodes(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface GenerateVariantsOption {
  readonly code: string;
  /** The values the product chose for this option, in display order. */
  readonly valueCodes: readonly string[];
}

export interface VariantLimits {
  readonly maxOptionsPerProduct: number;
  readonly maxValuesPerProductOption: number;
  readonly maxVariantsPerProduct: number;
  readonly maxNewVariantsPerGenerate: number;
}

export interface GenerateVariantsInput {
  readonly options: readonly GenerateVariantsOption[];
  /** Signatures of the variants the product already has. */
  readonly existingSignatures: ReadonlySet<string>;
  readonly limits?: Partial<VariantLimits>;
}

export interface GeneratedVariant {
  readonly optionValues: readonly OptionValuePair[];
  readonly optionSignature: string;
  /** True only for the first variant of a product that has none yet. */
  readonly isDefault: boolean;
}

export type GenerateVariantsErrorReason =
  | "too_many_options"
  | "empty_value_list"
  | "too_many_values"
  | "duplicate_option"
  | "duplicate_value"
  | "invalid_code"
  | "too_many_new_variants"
  | "too_many_variants_total";

export interface GenerateVariantsError {
  readonly reason: GenerateVariantsErrorReason;
  readonly optionCode?: string;
  readonly valueCode?: string;
  readonly limit?: number;
  readonly actual?: number;
}

export type GenerateVariantsResult =
  | { readonly ok: true; readonly variants: readonly GeneratedVariant[] }
  | { readonly ok: false; readonly errors: readonly GenerateVariantsError[] };

/** Drops keys whose value is undefined so that they cannot override a default limit. */
function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  if (value === undefined) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

/**
 * Builds the variants a product is missing: the cartesian product of the chosen option values minus
 * the combinations that already exist. Either returns all of them or refuses with typed errors;
 * it never returns a partial result. A product without options yields one default variant.
 */
export function generateVariants(input: GenerateVariantsInput): GenerateVariantsResult {
  const limits: VariantLimits = {
    maxOptionsPerProduct: CATALOG_LIMITS.maxOptionsPerProduct,
    maxValuesPerProductOption: CATALOG_LIMITS.maxValuesPerProductOption,
    maxVariantsPerProduct: CATALOG_LIMITS.maxVariantsPerProduct,
    maxNewVariantsPerGenerate: CATALOG_LIMITS.maxNewVariantsPerGenerate,
    ...definedOnly(input.limits),
  };
  const { options, existingSignatures } = input;

  const structuralErrors: GenerateVariantsError[] = [];
  if (options.length > limits.maxOptionsPerProduct) {
    structuralErrors.push({
      reason: "too_many_options",
      limit: limits.maxOptionsPerProduct,
      actual: options.length,
    });
  }
  for (const option of options) {
    if (!isValidCode(option.code)) {
      structuralErrors.push({ reason: "invalid_code", optionCode: option.code });
    }
    for (const valueCode of option.valueCodes) {
      if (!isValidValueCode(valueCode)) {
        structuralErrors.push({ reason: "invalid_code", optionCode: option.code, valueCode });
      }
    }
  }
  const seenOptions = new Set<string>();
  for (const option of options) {
    if (seenOptions.has(option.code)) {
      structuralErrors.push({ reason: "duplicate_option", optionCode: option.code });
    }
    seenOptions.add(option.code);
    if (option.valueCodes.length === 0) {
      structuralErrors.push({ reason: "empty_value_list", optionCode: option.code });
    }
    if (option.valueCodes.length > limits.maxValuesPerProductOption) {
      structuralErrors.push({
        reason: "too_many_values",
        optionCode: option.code,
        limit: limits.maxValuesPerProductOption,
        actual: option.valueCodes.length,
      });
    }
    const seenValues = new Set<string>();
    for (const valueCode of option.valueCodes) {
      if (seenValues.has(valueCode)) {
        structuralErrors.push({ reason: "duplicate_value", optionCode: option.code, valueCode });
      }
      seenValues.add(valueCode);
    }
  }
  if (structuralErrors.length > 0) {
    return { ok: false, errors: structuralErrors };
  }

  const sizes = options.map((option) => option.valueCodes.length);
  const combinationCount = sizes.reduce((product, size) => product * size, 1);
  const hasNoVariantsYet = existingSignatures.size === 0;
  const variants: GeneratedVariant[] = [];

  for (let index = 0; index < combinationCount; index += 1) {
    // Mixed-radix counter: the first option is the most significant digit, so it changes slowest.
    const optionValues: OptionValuePair[] = new Array<OptionValuePair>(options.length);
    let remainder = index;
    for (let position = options.length - 1; position >= 0; position -= 1) {
      const option = options[position];
      const size = sizes[position];
      if (option === undefined || size === undefined) {
        throw new Error("generateVariants: option index out of range");
      }
      const valueCode = option.valueCodes[remainder % size];
      if (valueCode === undefined) {
        throw new Error("generateVariants: value index out of range");
      }
      optionValues[position] = { optionCode: option.code, valueCode };
      remainder = Math.floor(remainder / size);
    }
    const optionSignature = computeOptionSignature(optionValues);
    if (!existingSignatures.has(optionSignature)) {
      variants.push({ optionValues, optionSignature, isDefault: false });
    }
  }

  if (variants.length > limits.maxNewVariantsPerGenerate) {
    return {
      ok: false,
      errors: [
        {
          reason: "too_many_new_variants",
          limit: limits.maxNewVariantsPerGenerate,
          actual: variants.length,
        },
      ],
    };
  }
  const total = existingSignatures.size + variants.length;
  if (total > limits.maxVariantsPerProduct) {
    return {
      ok: false,
      errors: [
        { reason: "too_many_variants_total", limit: limits.maxVariantsPerProduct, actual: total },
      ],
    };
  }

  const [first, ...rest] = variants;
  if (first === undefined || !hasNoVariantsYet) {
    return { ok: true, variants };
  }
  return { ok: true, variants: [{ ...first, isDefault: true }, ...rest] };
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

export type VariantInvariantInput = Pick<
  VariantSnapshot,
  "isDefault" | "optionSignature" | "optionValues"
>;

export type VariantInvariantCode =
  | "no_variants"
  | "no_default_variant"
  | "multiple_default_variants"
  | "missing_option_value"
  | "unexpected_option_value"
  | "duplicate_option_value"
  | "duplicate_option_signature"
  | "signature_mismatch";

export interface VariantInvariantViolation {
  readonly code: VariantInvariantCode;
  /** Index into the variants array that was checked. */
  readonly variantIndex?: number;
  readonly optionCode?: string;
  readonly signature?: string;
}

/** Exactly one default variant. An empty list has none. */
export function checkExactlyOneDefault(
  variants: readonly Pick<VariantInvariantInput, "isDefault">[],
): VariantInvariantViolation[] {
  const defaults = variants.flatMap((variant, variantIndex) =>
    variant.isDefault ? [variantIndex] : [],
  );
  if (defaults.length === 0) {
    return [{ code: "no_default_variant" }];
  }
  return defaults.length === 1
    ? []
    : defaults.map((variantIndex) => ({ code: "multiple_default_variants", variantIndex }));
}

/** Every variant has exactly one value for each product option, and for nothing else. */
export function checkOptionCoverage(
  productOptionCodes: readonly string[],
  variants: readonly Pick<VariantInvariantInput, "optionValues">[],
): VariantInvariantViolation[] {
  const violations: VariantInvariantViolation[] = [];
  variants.forEach((variant, variantIndex) => {
    const counts = new Map<string, number>();
    for (const { optionCode } of variant.optionValues) {
      counts.set(optionCode, (counts.get(optionCode) ?? 0) + 1);
    }
    for (const optionCode of productOptionCodes) {
      const count = counts.get(optionCode) ?? 0;
      if (count === 0) {
        violations.push({ code: "missing_option_value", variantIndex, optionCode });
      } else if (count > 1) {
        violations.push({ code: "duplicate_option_value", variantIndex, optionCode });
      }
    }
    for (const optionCode of counts.keys()) {
      if (!productOptionCodes.includes(optionCode)) {
        violations.push({ code: "unexpected_option_value", variantIndex, optionCode });
      }
    }
  });
  return violations;
}

/** No two variants share an option combination (a product without options has only one variant). */
export function checkUniqueSignatures(
  variants: readonly Pick<VariantInvariantInput, "optionSignature">[],
): VariantInvariantViolation[] {
  const seen = new Set<string>();
  const violations: VariantInvariantViolation[] = [];
  variants.forEach((variant, variantIndex) => {
    if (seen.has(variant.optionSignature)) {
      violations.push({
        code: "duplicate_option_signature",
        variantIndex,
        signature: variant.optionSignature,
      });
    }
    seen.add(variant.optionSignature);
  });
  return violations;
}

/** The stored signature equals the one computed from the variant's option values. */
export function checkSignatureConsistency(
  variants: readonly Pick<VariantInvariantInput, "optionSignature" | "optionValues">[],
): VariantInvariantViolation[] {
  return variants.flatMap((variant, variantIndex) =>
    computeOptionSignature(variant.optionValues) === variant.optionSignature
      ? []
      : [{ code: "signature_mismatch" as const, variantIndex, signature: variant.optionSignature }],
  );
}

/** All variant invariants of ADR 0006 section 3 that need no database. */
export function checkVariantInvariants(
  productOptionCodes: readonly string[],
  variants: readonly VariantInvariantInput[],
): VariantInvariantViolation[] {
  if (variants.length === 0) {
    return [{ code: "no_variants" }];
  }
  return [
    ...checkExactlyOneDefault(variants),
    ...checkOptionCoverage(productOptionCodes, variants),
    ...checkUniqueSignatures(variants),
    ...checkSignatureConsistency(variants),
  ];
}
