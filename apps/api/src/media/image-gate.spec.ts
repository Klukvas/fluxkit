import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MEDIA_LIMITS } from "@fluxkit/core";

/*
 * ADR 0028 decision 10.1: no file reaches sharp without passing the magic-byte gate. sharp is replaced by a spy that CALLS
 * THE REAL sharp (nothing is faked), so this spec can count how often the pipeline hands a file to libvips. The images
 * themselves are made with the real sharp before the spy starts counting.
 */
const calls = vi.hoisted(() => ({ count: 0 }));
vi.mock("sharp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sharp")>();
  const real = actual.default;
  const spy = Object.assign((...args: Parameters<typeof real>) => {
    calls.count += 1;
    return real(...args);
  }, real);
  return { ...actual, default: spy };
});

const images = await import("../test/media-images.js");
const { processImageFile } = await import("./image-pipeline.js");

const LIMITS = {
  maxPixels: MEDIA_LIMITS.maxPixels.default,
  maxSide: MEDIA_LIMITS.maxSide,
  outputMaxSide: MEDIA_LIMITS.outputMaxSide,
};

describe("the magic-byte gate runs before sharp sees anything", () => {
  let directory: string;
  const inputs = new Map<string, Buffer>();

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "fluxkit-gate-"));
    inputs.set("svg", images.SVG_WITH_SCRIPT);
    inputs.set("html", images.HTML_PAGE);
    inputs.set("pdf", images.PDF_DOCUMENT);
    inputs.set("gif", await images.gif());
    inputs.set("tiff", await images.tiff());
    inputs.set("avif", await images.avif());
    inputs.set("empty", Buffer.alloc(0));
    inputs.set(
      "html-named-jpg",
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0x00]), images.HTML_PAGE]),
    );
    inputs.set("jpeg", await images.jpeg());
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  beforeEach(() => {
    calls.count = 0;
  });

  async function run(name: string): Promise<unknown> {
    const path = join(directory, name);
    await writeFile(path, inputs.get(name) ?? Buffer.alloc(0));
    return processImageFile(path, LIMITS, 30_000);
  }

  it.each(["svg", "html", "pdf", "gif", "tiff", "avif", "empty", "html-named-jpg"])(
    "%s is refused with sharp never called",
    async (name) => {
      expect(await run(name)).toEqual({ ok: false, reason: "unsupported_type" });
      expect(calls.count).toBe(0);
    },
  );

  it("a JPEG that passes the gate does reach sharp (the spy counts)", async () => {
    expect(await run("jpeg")).toMatchObject({ ok: true });
    expect(calls.count).toBeGreaterThan(0);
  });
});
