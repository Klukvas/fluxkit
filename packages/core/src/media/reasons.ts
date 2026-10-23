/*
 * Reason and problem codes of the media upload (ADR 0028 decisions 3 and 5). Constants only; the API maps them to
 * `validation_failed` errors (`errors[].code`) and to problem codes. Do not add a code here without amending the ADR.
 */

/** `errors[].code` of a `validation_failed` answer about an upload or about a URL that names an upload. */
export const MEDIA_VALIDATION_REASONS = Object.freeze([
  "empty_file",
  "unsupported_type",
  "corrupt_image",
  "animated_not_supported",
  "dimensions_too_large",
  "too_many_pixels",
  "processing_timeout",
  "length_required",
  "file_too_large",
  "upload_not_found",
] as const);

export type MediaValidationReason = (typeof MEDIA_VALIDATION_REASONS)[number];

/** New problem `code` values: `503` when the storage cannot be written, `503` when uploads are switched off. */
export const MEDIA_PROBLEM_CODES = Object.freeze([
  "storage_unavailable",
  "uploads_disabled",
] as const);

export type MediaProblemCode = (typeof MEDIA_PROBLEM_CODES)[number];
