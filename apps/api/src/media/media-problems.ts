import type { MediaValidationReason } from "@fluxkit/core";
import { ProblemException } from "../common/problem.js";
import { errorCode } from "../common/error-summary.js";

/*
 * The problem answers of the media routes (ADR 0028 decision 3). Reasons come from core `MEDIA_VALIDATION_REASONS`; the
 * texts are generic and never echo anything the client sent.
 */

const DETAIL: Readonly<Record<MediaValidationReason, string>> = {
  empty_file: "The upload is empty.",
  unsupported_type: "Only JPEG, PNG and WebP images can be uploaded.",
  corrupt_image: "The image is damaged or incomplete.",
  animated_not_supported: "Animated images cannot be uploaded.",
  dimensions_too_large: "The image is too large: at most 12000 pixels per side.",
  too_many_pixels: "The image has too many pixels.",
  processing_timeout: "The image took too long to process.",
  output_too_large: "The processed image would be larger than the upload limit.",
  length_required: "The upload must send Content-Length (no chunked transfer).",
  file_too_large: "The file is larger than the upload limit.",
  upload_not_found: "This media URL names no uploaded file.",
};

/** `400` (or the given status) `validation_failed` with one error at `path` (`body` for the upload itself). */
export function mediaRefused(
  reason: MediaValidationReason,
  status = 400,
  path = "body",
): ProblemException {
  return new ProblemException({
    code: "validation_failed",
    status,
    detail: DETAIL[reason],
    errors: [{ path, code: reason, message: DETAIL[reason] }],
  });
}

/** The body ended before `Content-Length` bytes arrived; the client is normally gone and never reads this. */
export function uploadInterrupted(): ProblemException {
  return new ProblemException({
    code: "validation_failed",
    detail: "The upload ended before all of its bytes arrived.",
  });
}

/** `503 storage_unavailable`: the disk is full, over quota, read-only or gone. Details only in the log (by code). */
export function storageUnavailable(): ProblemException {
  return new ProblemException({
    code: "storage_unavailable",
    detail: "The file could not be stored. Try again later.",
  });
}

/** `503 uploads_disabled`: `MEDIA_STORAGE_DRIVER=none`. */
export function uploadsDisabled(): ProblemException {
  return new ProblemException({
    code: "uploads_disabled",
    detail: "File uploads are switched off on this server. Enter an image address instead.",
  });
}

/** `429` while both processing slots stay busy for the whole wait. */
export function uploadsBusy(retryAfterSeconds: number): ProblemException {
  return new ProblemException({
    code: "too_many_requests",
    detail: "Too many uploads are being processed. Try again shortly.",
    headers: { "Retry-After": String(retryAfterSeconds) },
  });
}

/** File-system error codes that mean "this storage cannot be written now" (answered `503 storage_unavailable`). */
const STORAGE_UNAVAILABLE_CODES = new Set([
  "ENOSPC", // disk full
  "EDQUOT", // quota exceeded
  "EROFS", // read-only file system
  "EACCES", // permissions changed under us
  "EPERM",
  "ENOTDIR", // the directory was replaced
  "ENOENT", // the directory was removed
]);

export function isStorageUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = errorCode(error);
  return code !== undefined && STORAGE_UNAVAILABLE_CODES.has(code);
}
