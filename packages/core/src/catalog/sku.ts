import { TEXT_LIMITS } from "./limits.js";

export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
const SKU_ALPHABET = /^[A-Z0-9][A-Z0-9._-]*$/;

/** Trim and uppercase, the normalization the service applies before validating (ADR 0006 section 7). */
export function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidSku(sku: string): boolean {
  return SKU_PATTERN.test(sku);
}

export type SkuValidationResult =
  | { readonly ok: true; readonly sku: string }
  | { readonly ok: false; readonly reason: "empty" | "too_long" | "invalid_format" };

/** Normalizes, then validates; on success returns the normalized SKU to store. */
export function validateSku(raw: string): SkuValidationResult {
  const sku = normalizeSku(raw);
  if (sku.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (sku.length > TEXT_LIMITS.sku) {
    return { ok: false, reason: "too_long" };
  }
  return isValidSku(sku) ? { ok: true, sku } : { ok: false, reason: "invalid_format" };
}

export interface ProposeSkuInput {
  readonly slug: string;
  /** The variant's option value codes, in the order they should appear. */
  readonly valueCodes: readonly string[];
  /** Normalized (uppercase) SKUs that are already used. */
  readonly takenSkus: ReadonlySet<string>;
}

export type ProposeSkuResult =
  | { readonly ok: true; readonly sku: string }
  | { readonly ok: false; readonly reason: "empty_base" | "invalid_format" };

function fit(base: string, suffix: string): string {
  const room = TEXT_LIMITS.sku - suffix.length;
  const head = base.length > room ? base.slice(0, room).replace(/[-._]+$/, "") : base;
  return head + suffix;
}

/**
 * Proposes `<SLUG>-<VALUE_CODE>[-<VALUE_CODE>]` in uppercase, cut to 64 characters, with `-2`, `-3`
 * appended while the result is taken.
 */
export function proposeSku(input: ProposeSkuInput): ProposeSkuResult {
  if (input.slug === "") {
    return { ok: false, reason: "empty_base" };
  }
  const base = [input.slug, ...input.valueCodes].join("-").toUpperCase();
  if (!SKU_ALPHABET.test(base)) {
    return { ok: false, reason: "invalid_format" };
  }
  let candidate = fit(base, "");
  for (let attempt = 2; input.takenSkus.has(candidate); attempt += 1) {
    candidate = fit(base, `-${attempt}`);
  }
  return { ok: true, sku: candidate };
}

export interface ProposeSkusInput {
  readonly slug: string;
  /** One list of option value codes per variant to create. */
  readonly variants: readonly (readonly string[])[];
  readonly takenSkus: ReadonlySet<string>;
}

/** Proposes SKUs for a whole batch; each proposal is reserved so the batch cannot collide with itself. */
export function proposeSkus(input: ProposeSkusInput): ProposeSkuResult[] {
  const taken = new Set(input.takenSkus);
  return input.variants.map((valueCodes) => {
    const result = proposeSku({ slug: input.slug, valueCodes, takenSkus: taken });
    if (result.ok) {
      taken.add(result.sku);
    }
    return result;
  });
}
