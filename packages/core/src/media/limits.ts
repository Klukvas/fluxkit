import type { MediaValidationReason } from "./reasons.js";

/*
 * Limits of an image upload (ADR 0028 decision 3 and 8). The configurable ones (`MEDIA_MAX_BYTES`, `MEDIA_MAX_PIXELS`) carry
 * a default and bounds; `packages/config` repeats the numbers because it does not depend on this package (a test in apps/api
 * asserts they are equal). The side limit and the output size are constants, not variables: fewer knobs.
 */

export const MEDIA_LIMITS = Object.freeze({
  /** Largest accepted upload in bytes (`Content-Length` and the streamed count): 10 MiB, adjustable from 1 KiB to 50 MiB. */
  maxBytes: Object.freeze({ default: 10 * 1024 * 1024, min: 1024, max: 50 * 1024 * 1024 }),
  /** Largest accepted input, width times height: 50 megapixels, adjustable from 1 to 100 000 000. */
  maxPixels: Object.freeze({ default: 50_000_000, min: 1, max: 100_000_000 }),
  /** Largest accepted input side in pixels (`MEDIA_MAX_DIMENSION` in the ADR). */
  maxSide: 12_000,
  /** The stored image is shrunk to fit this many pixels on its longer side, never enlarged (`MEDIA_OUTPUT_MAX_SIDE`). */
  outputMaxSide: 4_096,
});

export interface DimensionLimits {
  readonly maxPixels: number;
  readonly maxSide: number;
}

export type DimensionCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: Extract<
        MediaValidationReason,
        "corrupt_image" | "dimensions_too_large" | "too_many_pixels"
      >;
    };

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Judges the width and height read from an image HEADER, before anything is decoded. A header that is not a positive whole
 * number of pixels (zero, negative, NaN, infinite, fractional) is a corrupt image, not a size problem.
 *
 * The pixel limit is tested as `width > floor(maxPixels / height)`, which is exact for positive whole numbers and never forms
 * a product, so two huge sides cannot overflow or round in floating point. The side limit is tested first: a header that
 * claims 100 000 x 100 000 is "too large", whatever the pixel count.
 */
export function checkDimensions(
  width: number,
  height: number,
  limits: DimensionLimits,
): DimensionCheck {
  if (!isPositiveSafeInteger(width) || !isPositiveSafeInteger(height)) {
    return { ok: false, reason: "corrupt_image" };
  }
  if (width > limits.maxSide || height > limits.maxSide) {
    return { ok: false, reason: "dimensions_too_large" };
  }
  if (width > Math.floor(limits.maxPixels / height)) {
    return { ok: false, reason: "too_many_pixels" };
  }
  return { ok: true };
}
