import { deflateSync } from "node:zlib";

/**
 * Files the upload scenarios send, all made here (template cleanliness: no third-party image is committed, and nothing the
 * scenarios upload is read from disk). The admin package has no image library, so:
 * - the PNG is built from scratch (signature, chunks with a CRC, a zlib-compressed raster);
 * - the JPEG and the WebP are two tiny files, committed as base64 (made once with `sharp` from a flat colour, 272 and 74
 *   bytes), and a JPEG gets its EXIF block spliced in by hand;
 * - the "wrong" files are plain bytes.
 * The API re-encodes what it accepts, so these only need to be valid enough for its decoder (`failOn: warning`).
 */

export interface TestFile {
  /** The name the browser reports; the server never reads it. */
  name: string;
  /** What Playwright sends as the file's type (it also guesses one from the extension when this is left to it). */
  mimeType: string;
  buffer: Buffer;
  /** The pixel size of an image (what the preview's `naturalWidth` and `naturalHeight` must become). */
  width: number;
  height: number;
}

const JPEG_24X16_BASE64 =
  "/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAUG/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AnAJjUgAP/9k=";
const WEBP_20X12_BASE64 =
  "UklGRkIAAABXRUJQVlA4IDYAAADwAgCdASoUAAwAPrVInkmnJCKhMAgA4BaJQA7AACBsAAD+4uC//ztbDEFS//8W0joVHNoAAAA=";

/** A valid EXIF block (a big-endian TIFF with one tag, ImageDescription) that carries `marker` as text. */
function exifTiff(marker: string): Buffer {
  const text = Buffer.from(`${marker}\0`, "latin1");
  const header = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]);
  const entryCount = Buffer.from([0x00, 0x01]);
  const entry = Buffer.alloc(12);
  entry.writeUInt16BE(0x010e, 0); // ImageDescription
  entry.writeUInt16BE(2, 2); // ASCII
  entry.writeUInt32BE(text.length, 4);
  // The text follows the entry and the 4-byte "next IFD" field: 8 + 2 + 12 + 4.
  entry.writeUInt32BE(26, 8);
  const noNextIfd = Buffer.alloc(4);
  return Buffer.concat([header, entryCount, entry, noNextIfd, text]);
}

/** The bytes that must NOT survive an upload: they are in the file we send, and a test checks they are gone from the stored one. */
export const EXIF_SIGNATURE = Buffer.from("Exif\0\0", "latin1");

/** A 24x16 JPEG. With `exifMarker` it carries an APP1 EXIF segment whose ImageDescription is that text. */
export function jpegFile(name: string, exifMarker?: string): TestFile {
  const base = Buffer.from(JPEG_24X16_BASE64, "base64");
  let buffer = base;
  if (exifMarker !== undefined) {
    const payload = Buffer.concat([EXIF_SIGNATURE, exifTiff(exifMarker)]);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(payload.length + 2, 0);
    // SOI (2 bytes), then the APP1 segment, then the rest of the file.
    buffer = Buffer.concat([
      base.subarray(0, 2),
      Buffer.from([0xff, 0xe1]),
      length,
      payload,
      base.subarray(2),
    ]);
  }
  return { name, mimeType: "image/jpeg", buffer, width: 24, height: 16 };
}

/** A 20x12 lossy WebP. */
export function webpFile(name: string): TestFile {
  return {
    name,
    mimeType: "image/webp",
    buffer: Buffer.from(WEBP_20X12_BASE64, "base64"),
    width: 20,
    height: 12,
  };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * An 8-bit RGB PNG of `width` x `height` with a colour gradient. With `marker` it carries a `tEXt` chunk and an `eXIf`
 * chunk (the same EXIF block as the JPEG) before the pixel data.
 */
export function pngFile(name: string, width: number, height: number, marker?: string): TestFile {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  const raster = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    raster[row] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      raster[row + 1 + x * 3] = (x * 6) % 256;
      raster[row + 2 + x * 3] = (y * 8) % 256;
      raster[row + 3 + x * 3] = 128;
    }
  }
  const metadata =
    marker === undefined
      ? []
      : [
          pngChunk("tEXt", Buffer.from(`Comment\0${marker}`, "latin1")),
          pngChunk("eXIf", exifTiff(marker)),
        ];
  const buffer = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    ...metadata,
    pngChunk("IDAT", deflateSync(raster)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return { name, mimeType: "image/png", buffer, width, height };
}

/** An SVG with a script: refused by the browser-side type check (and by the server's content check if it got that far). */
export function svgWithScript(name: string): TestFile {
  const buffer = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><script>alert(1)</script><rect width="8" height="8"/></svg>',
    "utf8",
  );
  return { name, mimeType: "image/svg+xml", buffer, width: 8, height: 8 };
}

/**
 * Text with an image extension and an image type: the browser-side check passes it (it only looks at the reported type), so
 * the server's content check refuses it.
 */
export function textRenamedAsJpeg(name: string): TestFile {
  return {
    name,
    mimeType: "image/jpeg",
    buffer: Buffer.from("This is not an image. It is a text file that was renamed.\n", "utf8"),
    width: 0,
    height: 0,
  };
}

/** `size` bytes of zeros, reported as a JPEG: refused by the browser-side size check before anything is sent. */
export function oversizedFile(name: string, size: number): TestFile {
  return { name, mimeType: "image/jpeg", buffer: Buffer.alloc(size), width: 0, height: 0 };
}

/** The payload shape `setInputFiles` takes. */
export function asPayload(file: TestFile): { name: string; mimeType: string; buffer: Buffer } {
  return { name: file.name, mimeType: file.mimeType, buffer: file.buffer };
}
