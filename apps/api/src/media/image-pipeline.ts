import { open } from "node:fs/promises";
import sharp, { type Metadata, type Sharp } from "sharp";
import {
  checkDimensions,
  sniffImageType,
  SNIFF_PREFIX_LENGTH,
  type AllowedImageType,
  type MediaValidationReason,
} from "@fluxkit/core";

/*
 * The image pipeline of an upload (ADR 0028 decision 3): magic-byte gate (core), header checks, decode with limits,
 * re-encode in the same format without any metadata. libvips decodes far more than we accept (SVG through librsvg, TIFF,
 * GIF, HEIF, PDF, ...), so sharp is only ever given a file the core gate accepted.
 */

// No decoded-image cache (each upload is new data) and one libvips thread per operation: the memory and CPU of an upload
// stay bounded; parallelism comes from the two processing slots, not from libvips threads.
sharp.cache(false);
sharp.concurrency(1);

/** Output settings (ADR 0028 decision 3). `withMetadata`, `keepExif`, `keepIccProfile` and friends are never called. */
export const ENCODE_SETTINGS = Object.freeze({
  jpeg: Object.freeze({ quality: 85, progressive: true }),
  png: Object.freeze({ compressionLevel: 6 }),
  webp: Object.freeze({ quality: 85 }),
});

export interface PipelineLimits {
  /** `MEDIA_MAX_PIXELS`: width times height of the input. */
  readonly maxPixels: number;
  /** Largest input side (core `MEDIA_LIMITS.maxSide`). */
  readonly maxSide: number;
  /** The output fits this many pixels on its longer side, never enlarged (core `MEDIA_LIMITS.outputMaxSide`). */
  readonly outputMaxSide: number;
  /**
   * `MEDIA_MAX_BYTES`: the re-encoded output may not be larger than an upload may be (step 9 review M-1). A two-colour
   * PNG is re-encoded as 24-bit RGB and can grow several times, so without this a 6 MB upload could store 40 MB.
   */
  readonly maxOutputBytes: number;
}

export interface ProcessedImage {
  readonly type: AllowedImageType;
  /** The re-encoded bytes: the only bytes ever stored. */
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
}

export type PipelineResult =
  | { readonly ok: true; readonly image: ProcessedImage }
  | { readonly ok: false; readonly reason: MediaValidationReason };

/** What libvips reports from the header, before any pixel is decoded. */
export interface HeaderFacts {
  readonly format?: string | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly pages?: number | undefined;
}

function refused(reason: MediaValidationReason): PipelineResult {
  return { ok: false, reason };
}

async function readPrefix(path: string): Promise<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(SNIFF_PREFIX_LENGTH);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_PREFIX_LENGTH, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * The header rules: the format libvips found must be the sniffed one, one page or frame only, and the dimensions within
 * the limits (core `checkDimensions`; EXIF orientation does not matter for the limits).
 */
export function checkDecodedHeader(
  sniffed: AllowedImageType,
  header: HeaderFacts,
  limits: Pick<PipelineLimits, "maxPixels" | "maxSide">,
): MediaValidationReason | undefined {
  if (header.format !== sniffed) {
    return "unsupported_type";
  }
  if ((header.pages ?? 1) > 1) {
    return "animated_not_supported";
  }
  const dimensions = checkDimensions(
    header.width ?? Number.NaN,
    header.height ?? Number.NaN,
    limits,
  );
  return dimensions.ok ? undefined : dimensions.reason;
}

function encoder(pipeline: Sharp, type: AllowedImageType): Sharp {
  switch (type) {
    case "jpeg":
      return pipeline.jpeg({ ...ENCODE_SETTINGS.jpeg });
    case "png":
      return pipeline.png({ ...ENCODE_SETTINGS.png });
    case "webp":
      return pipeline.webp({ ...ENCODE_SETTINGS.webp });
  }
}

async function decodeAndEncode(
  path: string,
  sniffed: AllowedImageType,
  limits: PipelineLimits,
  deadline: number,
  budgetMs: number,
): Promise<PipelineResult> {
  const input = {
    failOn: "warning",
    sequentialRead: true,
    pages: 1,
    limitInputPixels: limits.maxPixels,
  } as const;
  let header: Metadata;
  try {
    // Reading the header decodes no pixel, so the pixel limit is checked by `checkDecodedHeader` with its own reasons
    // (libvips would refuse a bomb header here with a generic error).
    header = await sharp(path, { ...input, limitInputPixels: false }).metadata();
  } catch {
    return refused("corrupt_image");
  }
  const headerProblem = checkDecodedHeader(sniffed, header, limits);
  if (headerProblem !== undefined) {
    return refused(headerProblem);
  }
  try {
    const pipeline = sharp(path, input)
      // libvips stops on its own after the budget (whole seconds), so a timed-out upload frees its slot soon after.
      .timeout({ seconds: Math.max(1, Math.ceil(budgetMs / 1000)) })
      .rotate()
      .toColorspace("srgb")
      .resize({
        width: limits.outputMaxSide,
        height: limits.outputMaxSide,
        fit: "inside",
        withoutEnlargement: true,
      });
    // libvips encodes into one buffer (at most about 67 MB: a 4 096 x 4 096 RGBA PNG that does not compress); it is
    // dropped right here when it is above the cap, before anything is written (docs/api/media.md, Memory).
    const { data, info } = await encoder(pipeline, sniffed).toBuffer({ resolveWithObject: true });
    if (data.length > limits.maxOutputBytes) {
      return refused("output_too_large");
    }
    return { ok: true, image: { type: sniffed, data, width: info.width, height: info.height } };
  } catch {
    // Truncated or corrupt data (failOn "warning"), or libvips' own timeout. The input is what we refuse, not a fault.
    return refused(Date.now() >= deadline ? "processing_timeout" : "corrupt_image");
  }
}

const TIMED_OUT = Symbol("timed out");

/**
 * Runs the whole pipeline on a file and decides. The gate reads only the first bytes; anything it does not accept is
 * refused before sharp is called. Processing longer than `budgetMs` is refused as `processing_timeout`; this function
 * still resolves only when libvips has really stopped, so the caller's processing slot and temp files stay held until
 * then.
 */
export async function processImageFile(
  path: string,
  limits: PipelineLimits,
  budgetMs: number,
): Promise<PipelineResult> {
  const sniffed = sniffImageType(await readPrefix(path));
  if (sniffed === null) {
    return refused("unsupported_type");
  }
  const deadline = Date.now() + budgetMs;
  const work = decodeAndEncode(path, sniffed, limits, deadline, budgetMs);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), budgetMs);
  });
  const first = await Promise.race([work, timeout]);
  clearTimeout(timer);
  if (first === TIMED_OUT) {
    // The answer is decided; wait until libvips has stopped (decodeAndEncode never rejects: it maps every failure).
    await work;
    return refused("processing_timeout");
  }
  return first;
}
