import type { FileHandle } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import { mediaRefused } from "./media-problems.js";

const DIGITS = /^[0-9]+$/;

/**
 * The length rules of an upload, decided from the request head before a byte of the body is read (ADR 0028 decision 3):
 * `411 length_required` without a plain `Content-Length` or with any `Transfer-Encoding`, `413 file_too_large` above
 * `maxBytes`, `400 empty_file` for zero. Returns the declared length.
 */
export function checkUploadLength(headers: IncomingHttpHeaders, maxBytes: number): number {
  const declared = headers["content-length"];
  if (
    headers["transfer-encoding"] !== undefined ||
    declared === undefined ||
    !DIGITS.test(declared)
  ) {
    throw mediaRefused("length_required", 411);
  }
  // A number with more digits than the limit is above it, whatever its value (no float rounding of huge numbers).
  const digits = declared.replace(/^0+(?=[0-9])/, "");
  if (digits.length > String(maxBytes).length || Number(digits) > maxBytes) {
    throw mediaRefused("file_too_large", 413);
  }
  const length = Number(digits);
  if (length === 0) {
    throw mediaRefused("empty_file");
  }
  return length;
}

/** The body stream failed (the client went away, or sent less than `Content-Length`): not a server fault. */
export class UploadInterruptedError extends Error {
  constructor(cause: unknown) {
    super(
      `The upload body ended early: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "UploadInterruptedError";
  }
}

/**
 * Streams the body into an open temp file and counts. More than `maxBytes` ends the read at once with `413
 * file_too_large`: nothing beyond the limit is written and the rest of the stream is not pulled. Node's HTTP parser never
 * delivers more than `Content-Length` bytes, so this is the second line of defence, also for a source that is not an HTTP
 * request. A failing source (the client went away) rejects with its own error.
 */
export async function readBodyToFile(
  source: AsyncIterable<Uint8Array>,
  file: FileHandle,
  maxBytes: number,
): Promise<number> {
  const iterator = source[Symbol.asyncIterator]();
  let total = 0;
  for (;;) {
    let next: IteratorResult<Uint8Array>;
    try {
      next = await iterator.next();
    } catch (error) {
      throw new UploadInterruptedError(error);
    }
    if (next.done === true) {
      return total;
    }
    total += next.value.length;
    if (total > maxBytes) {
      // Stop pulling: the rest of a lying client's body is never read into memory or onto the disk.
      await iterator.return?.();
      throw mediaRefused("file_too_large", 413);
    }
    await file.write(next.value);
  }
}
