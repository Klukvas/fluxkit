import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MEDIA_LIMITS } from "@fluxkit/core";
import {
  animatedWebp,
  avif,
  cmykJpeg,
  EXIF_MARKER,
  gif,
  HTML_PAGE,
  jpeg,
  jpegHeaderClaiming,
  jpegWithExif,
  PDF_DOCUMENT,
  png16,
  pngHeaderClaiming,
  pngWithAlpha,
  POLYGLOT_TAIL,
  solidPng,
  SVG_WITH_SCRIPT,
  tiff,
  truncatedJpeg,
  webp,
  webpLossless,
} from "../test/media-images.js";
import {
  checkDecodedHeader,
  ENCODE_SETTINGS,
  processImageFile,
  type PipelineLimits,
  type PipelineResult,
} from "./image-pipeline.js";

const LIMITS: PipelineLimits = {
  maxPixels: MEDIA_LIMITS.maxPixels.default,
  maxSide: MEDIA_LIMITS.maxSide,
  outputMaxSide: MEDIA_LIMITS.outputMaxSide,
};
const BUDGET_MS = 30_000;

const PNG_IEND = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

describe("the image pipeline (real sharp, ADR 0028 decisions 3 and 10)", () => {
  let directory: string;
  let counter = 0;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "fluxkit-pipeline-"));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function run(
    bytes: Buffer,
    limits: PipelineLimits = LIMITS,
    budgetMs = BUDGET_MS,
  ): Promise<PipelineResult> {
    counter += 1;
    const path = join(directory, `input-${counter}`);
    await writeFile(path, bytes);
    return processImageFile(path, limits, budgetMs);
  }

  async function stored(bytes: Buffer): Promise<{
    data: Buffer;
    type: string;
    width: number;
    height: number;
  }> {
    const result = await run(bytes);
    if (!result.ok) throw new Error(`expected a stored image, got ${result.reason}`);
    return result.image;
  }

  it("turns sharp's cache off and processes with one thread", () => {
    const cache = sharp.cache();
    expect(cache.memory.max).toBe(0);
    expect(cache.files.max).toBe(0);
    expect(cache.items.max).toBe(0);
    expect(sharp.concurrency()).toBe(1);
  });

  it("encodes JPEG at quality 85 progressive, PNG at level 6, WebP at quality 85, never with metadata", () => {
    expect(ENCODE_SETTINGS).toEqual({
      jpeg: { quality: 85, progressive: true },
      png: { compressionLevel: 6 },
      webp: { quality: 85 },
    });
  });

  describe("stores a re-encode, never the uploaded bytes", () => {
    it("applies the EXIF orientation and drops EXIF (GPS, camera), XMP and the ICC profile", async () => {
      const input = await jpegWithExif();
      const before = await sharp(input).metadata();
      expect(before.orientation).toBe(6);
      expect(before.exif).toBeDefined();
      expect(before.icc).toBeDefined();
      expect(input.includes(Buffer.from(EXIF_MARKER))).toBe(true);

      const image = await stored(input);
      expect(image.type).toBe("jpeg");
      // 60 x 20 tagged "rotate 90": stored upright as 20 x 60.
      expect({ width: image.width, height: image.height }).toEqual({ width: 20, height: 60 });
      const after = await sharp(image.data).metadata();
      expect({ width: after.width, height: after.height }).toEqual({ width: 20, height: 60 });
      expect(after.orientation).toBeUndefined();
      expect(after.exif).toBeUndefined();
      expect(after.xmp).toBeUndefined();
      expect(after.icc).toBeUndefined();
      expect(after.iptc).toBeUndefined();
      expect(after.space).toBe("srgb");
      expect(after.isProgressive).toBe(true);
      expect(image.data.includes(Buffer.from(EXIF_MARKER))).toBe(false);
      expect(image.data.includes(Buffer.from("Exif\0\0"))).toBe(false);
    });

    it("cuts data appended to a JPEG (polyglot with HTML and a zip)", async () => {
      const image = await stored(Buffer.concat([await jpeg(), POLYGLOT_TAIL]));
      expect(image.type).toBe("jpeg");
      expect(image.data.includes(Buffer.from("<script"))).toBe(false);
      expect(image.data.includes(Buffer.from("PK\u0003\u0004"))).toBe(false);
      expect(image.data.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    });

    it("cuts data appended to a PNG and keeps its alpha", async () => {
      const image = await stored(Buffer.concat([await pngWithAlpha(), POLYGLOT_TAIL]));
      expect(image.type).toBe("png");
      expect(image.data.includes(Buffer.from("<script"))).toBe(false);
      expect(image.data.subarray(-12)).toEqual(PNG_IEND);
      expect((await sharp(image.data).metadata()).hasAlpha).toBe(true);
    });

    it("cuts data appended to a WebP (the RIFF size covers the whole output)", async () => {
      const image = await stored(Buffer.concat([await webp(), POLYGLOT_TAIL]));
      expect(image.type).toBe("webp");
      expect(image.data.includes(Buffer.from("<script"))).toBe(false);
      expect(image.data.readUInt32LE(4)).toBe(image.data.length - 8);
    });

    it("keeps the type: PNG stays PNG, WebP stays WebP (lossless with alpha too), JPEG stays JPEG", async () => {
      expect((await stored(await pngWithAlpha())).type).toBe("png");
      expect((await stored(await webp())).type).toBe("webp");
      const lossless = await stored(await webpLossless());
      expect(lossless.type).toBe("webp");
      expect((await sharp(lossless.data).metadata()).hasAlpha).toBe(true);
      expect((await stored(await jpeg())).type).toBe("jpeg");
      for (const bytes of [await pngWithAlpha(), await webp(), await jpeg()]) {
        const image = await stored(bytes);
        expect((await sharp(image.data).metadata()).format).toBe(image.type);
      }
    });

    it("never enlarges: a 1 x 1 image stays 1 x 1", async () => {
      const image = await stored(await jpeg(1, 1));
      expect({ width: image.width, height: image.height }).toEqual({ width: 1, height: 1 });
      const tall = await stored(await solidPng(3, 4000));
      expect({ width: tall.width, height: tall.height }).toEqual({ width: 3, height: 4000 });
    });

    it("shrinks to fit 4096 px on the longer side, keeping the aspect ratio", async () => {
      const wide = await stored(await solidPng(5000, 100));
      expect(wide.width).toBe(4096);
      expect(wide.height).toBe(82);
      const square = await stored(await solidPng(4097, 4097));
      expect({ width: square.width, height: square.height }).toEqual({
        width: 4096,
        height: 4096,
      });
      const metadata = await sharp(square.data).metadata();
      expect({ width: metadata.width, height: metadata.height }).toEqual({
        width: 4096,
        height: 4096,
      });
    });

    it("converts CMYK to sRGB and accepts a 16-bit PNG", async () => {
      const fromCmyk = await stored(await cmykJpeg());
      expect((await sharp(fromCmyk.data).metadata()).space).toBe("srgb");
      expect((await stored(await png16())).type).toBe("png");
    });

    it("accepts an image just under the pixel limit (49 megapixels)", async () => {
      const image = await stored(await solidPng(7000, 7000));
      expect({ width: image.width, height: image.height }).toEqual({ width: 4096, height: 4096 });
    }, 60_000);
  });

  describe("refuses", () => {
    it.each([
      ["SVG with a script", () => SVG_WITH_SCRIPT],
      ["HTML", () => HTML_PAGE],
      ["PDF", () => PDF_DOCUMENT],
      ["GIF", gif],
      ["TIFF", tiff],
      ["AVIF", avif],
      ["random bytes", () => Buffer.from("not an image at all, just text")],
      [
        "a PNG signature followed by HTML",
        () => Buffer.concat([pngHeaderClaiming(1, 1).subarray(0, 8), HTML_PAGE]),
      ],
      ["an empty file", () => Buffer.alloc(0)],
    ])("%s as unsupported_type", async (_name, make) => {
      expect(await run(await make())).toEqual({ ok: false, reason: "unsupported_type" });
    });

    it("a truncated JPEG and a truncated PNG as corrupt_image", async () => {
      expect(await run(await truncatedJpeg())).toEqual({ ok: false, reason: "corrupt_image" });
      const png = await pngWithAlpha(100, 100);
      expect(await run(png.subarray(0, png.length - 30))).toEqual({
        ok: false,
        reason: "corrupt_image",
      });
    });

    it("an animated WebP as animated_not_supported", async () => {
      expect(await run(await animatedWebp())).toEqual({
        ok: false,
        reason: "animated_not_supported",
      });
    });

    it("decompression-bomb headers from the header alone: too large per side, too many pixels", async () => {
      expect(await run(pngHeaderClaiming(100_000, 100_000))).toEqual({
        ok: false,
        reason: "dimensions_too_large",
      });
      expect(await run(pngHeaderClaiming(12_001, 1))).toEqual({
        ok: false,
        reason: "dimensions_too_large",
      });
      expect(await run(pngHeaderClaiming(1, 12_001))).toEqual({
        ok: false,
        reason: "dimensions_too_large",
      });
      expect(await run(await jpegHeaderClaiming(65_000, 65_000))).toEqual({
        ok: false,
        reason: "dimensions_too_large",
      });
      // 8 000 x 7 000 = 56 megapixels: each side is allowed, the area is not.
      expect(await run(pngHeaderClaiming(8_000, 7_000))).toEqual({
        ok: false,
        reason: "too_many_pixels",
      });
    });

    it("an image above a configured pixel limit, with the header check and libvips agreeing", async () => {
      const limits = { ...LIMITS, maxPixels: 10_000 };
      expect(await run(await solidPng(101, 100), limits)).toEqual({
        ok: false,
        reason: "too_many_pixels",
      });
      expect((await run(await solidPng(100, 100), limits)).ok).toBe(true);
    });

    it("an image that takes longer than the processing budget as processing_timeout", async () => {
      expect(await run(await solidPng(3000, 3000), LIMITS, 1)).toEqual({
        ok: false,
        reason: "processing_timeout",
      });
    });
  });
});

describe("checkDecodedHeader (what libvips reports, before any pixel is decoded)", () => {
  const ok = { format: "png", width: 10, height: 10, pages: undefined } as const;

  it("accepts a header that matches the sniffed type and the limits", () => {
    expect(checkDecodedHeader("png", ok, LIMITS)).toBeUndefined();
    expect(checkDecodedHeader("webp", { ...ok, format: "webp", pages: 1 }, LIMITS)).toBeUndefined();
  });

  it("refuses a format libvips reports that is not the sniffed one", () => {
    for (const format of ["jpeg", "webp", "gif", "svg", "heif", "tiff", undefined]) {
      expect(checkDecodedHeader("png", { ...ok, format }, LIMITS), String(format)).toBe(
        "unsupported_type",
      );
    }
  });

  it("refuses more than one page or frame", () => {
    expect(checkDecodedHeader("webp", { ...ok, format: "webp", pages: 2 }, LIMITS)).toBe(
      "animated_not_supported",
    );
  });

  it("refuses dimensions by core checkDimensions", () => {
    expect(checkDecodedHeader("png", { ...ok, width: 12_001 }, LIMITS)).toBe(
      "dimensions_too_large",
    );
    expect(checkDecodedHeader("png", { ...ok, width: 8_000, height: 7_000 }, LIMITS)).toBe(
      "too_many_pixels",
    );
    expect(checkDecodedHeader("png", { ...ok, width: undefined }, LIMITS)).toBe("corrupt_image");
  });
});
