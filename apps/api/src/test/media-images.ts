import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import sharp, { type Sharp } from "sharp";

/*
 * TEST ONLY: image inputs for the media upload specs (ADR 0028 decision 10). Every valid image is generated here with sharp
 * itself; every invalid one is built by hand from bytes. No third-party image is committed (template cleanliness).
 */

/** Text planted in the EXIF block of `jpegWithExif`, so a spec can prove no byte of it survives the re-encode. */
export const EXIF_MARKER = "FluxkitSecretCam";

function solid(width: number, height: number, channels: 3 | 4 = 3): Sharp {
  return sharp({
    create: {
      width,
      height,
      channels,
      background: channels === 4 ? { r: 200, g: 40, b: 40, alpha: 0.5 } : { r: 30, g: 90, b: 160 },
    },
  });
}

/** A plain baseline JPEG. */
export function jpeg(width = 64, height = 48): Promise<Buffer> {
  return solid(width, height).jpeg({ quality: 90 }).toBuffer();
}

/**
 * A 60 x 20 JPEG (landscape pixels) tagged EXIF Orientation 6 (rotate 90 degrees clockwise to display), with camera make,
 * model, copyright, GPS tags and a P3 ICC profile. Displayed upright it is 20 x 60.
 */
export function jpegWithExif(): Promise<Buffer> {
  return solid(60, 20)
    .jpeg({ quality: 90 })
    .withIccProfile("p3")
    .withExif({
      IFD0: { Make: EXIF_MARKER, Model: `${EXIF_MARKER}-Model`, Copyright: EXIF_MARKER },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "50/1 27/1 0/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "30/1 31/1 0/1",
      },
    })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

/** A PNG with an alpha channel. */
export function pngWithAlpha(width = 32, height = 32): Promise<Buffer> {
  return solid(width, height, 4).png().toBuffer();
}

/** A lossy WebP. */
export function webp(width = 40, height = 30): Promise<Buffer> {
  return solid(width, height).webp({ quality: 80 }).toBuffer();
}

/** A lossless WebP with alpha (first chunk `VP8L`). */
export function webpLossless(width = 16, height = 16): Promise<Buffer> {
  return solid(width, height, 4).webp({ lossless: true }).toBuffer();
}

/** A two-frame animated WebP. */
export async function animatedWebp(): Promise<Buffer> {
  const first = await solid(10, 10).png().toBuffer();
  const second = await sharp({
    create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 200, b: 0 } },
  })
    .png()
    .toBuffer();
  return sharp([first, second], { join: { animated: true } })
    .webp()
    .toBuffer();
}

export function gif(): Promise<Buffer> {
  return solid(10, 10).gif().toBuffer();
}

export function tiff(): Promise<Buffer> {
  return solid(10, 10).tiff().toBuffer();
}

export function avif(): Promise<Buffer> {
  return solid(10, 10).avif().toBuffer();
}

export const SVG_WITH_SCRIPT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>',
);
export const HTML_PAGE = Buffer.from(
  "<!doctype html><html><body><script>alert(document.cookie)</script></body></html>",
);
export const PDF_DOCUMENT = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");

/** Appended data that must never survive: HTML with a script, and the start of a zip archive. */
export const POLYGLOT_TAIL = Buffer.from(
  "<html><script>alert('polyglot')</script></html>PK\u0003\u0004appended-archive",
);

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    let c = (crc ^ byte) & 0xff;
    for (let bit = 0; bit < 8; bit += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * A PNG whose IHDR claims `width` x `height` with a tiny, far too short IDAT: what a decompression bomb's header looks
 * like. Only the header is valid; decoding it would fail (or explode), so it must be refused from the header alone.
 */
export function pngHeaderClaiming(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.alloc(64))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A real JPEG whose start-of-frame marker is patched to claim `width` x `height` (each at most 65 535). */
export async function jpegHeaderClaiming(width: number, height: number): Promise<Buffer> {
  const bytes = Buffer.from(await jpeg(16, 16));
  for (let offset = 2; offset < bytes.length - 9; offset += 1) {
    if (bytes[offset] === 0xff && (bytes[offset + 1] === 0xc0 || bytes[offset + 1] === 0xc2)) {
      // FF Cx, length (2), precision (1), height (2), width (2)
      bytes.writeUInt16BE(height, offset + 5);
      bytes.writeUInt16BE(width, offset + 7);
      return bytes;
    }
  }
  throw new Error("Test setup bug: no start-of-frame marker in the generated JPEG");
}

/** The first half of a real JPEG: the header is fine, the scan data ends early. */
export async function truncatedJpeg(): Promise<Buffer> {
  const bytes = await jpeg(200, 150);
  return bytes.subarray(0, Math.floor(bytes.length / 2));
}

/** A CMYK JPEG (print-shop export); the stored copy must be sRGB. */
export function cmykJpeg(): Promise<Buffer> {
  return solid(20, 20).toColourspace("cmyk").jpeg().toBuffer();
}

/** A 16-bit PNG. */
export function png16(): Promise<Buffer> {
  return solid(20, 20).toColourspace("rgb16").png().toBuffer();
}

/** A PNG of random pixels (does not compress): a file of a predictable, larger size. */
export function noisyPng(width: number, height: number): Promise<Buffer> {
  const pixels = randomBytes(width * height * 3);
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

/**
 * A two-colour (1-bit, paletted) PNG of random black and white pixels: small on input, but its re-encode is a 24-bit
 * RGB PNG that barely compresses, so the stored output is several times larger than the upload (step 9 review M-1).
 */
export function noisyOneBitPng(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.from(randomBytes(width * height).map((byte) => (byte & 1 ? 255 : 0)));
  return sharp(pixels, { raw: { width, height, channels: 1 } })
    .png({ palette: true, colours: 2 })
    .toBuffer();
}

/** A solid PNG of `width` x `height` pixels: compresses to almost nothing, so a near-limit image is cheap to send. */
export function solidPng(width: number, height: number): Promise<Buffer> {
  return solid(width, height).png({ compressionLevel: 9 }).toBuffer();
}
