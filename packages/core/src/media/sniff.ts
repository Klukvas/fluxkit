import type { AllowedImageType } from "./image-types.js";

/*
 * The magic-byte gate of an upload (ADR 0028 decision 3). It decides the type from the first bytes ONLY: the declared
 * Content-Type and any file name are not parameters, so they cannot influence it. `null` means "not an allowed image", and
 * the image library must never be shown such a file (libvips would also decode SVG, TIFF, GIF and HEIF).
 *
 * It is deliberately stricter than the bare signatures. A real file of each format always starts with more than its magic:
 *  - JPEG: SOI (FF D8) then FF and a marker byte of a real segment (C0..FE, not the restart/SOI/EOI range D0..D9, and not
 *    the 0x00 or 0xFF that only occur inside entropy data or as padding);
 *  - PNG: the 8-byte signature, then the IHDR chunk header (length 13), which the PNG specification requires first;
 *  - WebP: `RIFF`, a size, `WEBP`, then the first chunk, which is `VP8 `, `VP8L` or `VP8X` (this also refuses
 *    `RIFF....WAVE` and `RIFF....AVI `).
 * So "PNG signature followed by HTML" is refused here, before any decoder, not only after a failed decode.
 *
 * Only a bounded prefix is read, so a huge input costs nothing and a signature further in is never found.
 */

/** Bytes inspected at most. */
export const SNIFF_PREFIX_LENGTH = 16;

const PNG_PREFIX: readonly number[] = [
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a, // signature
  0x00,
  0x00,
  0x00,
  0x0d, // IHDR length
  0x49,
  0x48,
  0x44,
  0x52, // "IHDR"
];

const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];
const WEBP_FIRST_CHUNKS: readonly (readonly number[])[] = [
  [0x56, 0x50, 0x38, 0x20], // "VP8 "
  [0x56, 0x50, 0x38, 0x4c], // "VP8L"
  [0x56, 0x50, 0x38, 0x58], // "VP8X"
];

function startsWithAt(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (bytes.length < offset + expected.length) {
    return false;
  }
  return expected.every((value, index) => bytes[offset + index] === value);
}

function isJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return false;
  }
  const marker = bytes[3] ?? 0;
  const isRestartOrDelimiter = marker >= 0xd0 && marker <= 0xd9;
  return marker >= 0xc0 && marker <= 0xfe && !isRestartOrDelimiter;
}

function isWebp(bytes: Uint8Array): boolean {
  // Bytes 4..7 are the RIFF size; they are not checked (a truncated upload is the decoder's concern).
  return (
    startsWithAt(bytes, 0, RIFF) &&
    startsWithAt(bytes, 8, WEBP) &&
    WEBP_FIRST_CHUNKS.some((chunk) => startsWithAt(bytes, 12, chunk))
  );
}

export function sniffImageType(bytes: Uint8Array): AllowedImageType | null {
  if (isJpeg(bytes)) {
    return "jpeg";
  }
  if (startsWithAt(bytes, 0, PNG_PREFIX)) {
    return "png";
  }
  if (isWebp(bytes)) {
    return "webp";
  }
  return null;
}
