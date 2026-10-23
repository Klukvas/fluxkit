import { createHash } from "node:crypto";
import { readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { isMediaKey } from "@fluxkit/core";
import type { ProblemBody } from "../common/problem.filter.js";
import { mediaUpload } from "../database/schema/index.js";
import { ProcessingSlots } from "./processing-slots.js";
import { startApp, type RunningApp } from "../test/app.js";
import { http } from "../test/http.js";
import {
  filesUnder,
  rawRequest,
  startMediaApp,
  TEST_ADMIN_HEADER,
  TEST_MEDIA_BASE_URL,
  type MediaApp,
} from "../test/media-app.js";
import * as images from "../test/media-images.js";
import { ensureMigrated } from "../test/migrate.js";
import { adminRoutes } from "../test/routes.js";
import { storeRoutes } from "../test/store-routes.js";

const UPLOAD_PATH = "/admin/media/uploads";

interface UploadBody {
  id: string;
  url: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
  createdAt: string;
}

interface Answer<T> {
  status: number;
  headers: Headers;
  body: T;
}

async function upload<T = UploadBody>(
  baseUrl: string,
  bytes: Buffer,
  headers: Record<string, string> = {},
): Promise<Answer<T>> {
  const response = await fetch(`${baseUrl}${UPLOAD_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-fluxkit-csrf": "1",
      ...headers,
    },
    body: bytes,
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: (text === "" ? undefined : JSON.parse(text)) as T,
  };
}

/**
 * Sends only the request head (a Content-Length far above the limit) and no body, and resolves with the first response
 * line: proves the server answered without waiting for, or reading, the body.
 */
function headOnlyStatus(baseUrl: string, headers: Record<string, string>): Promise<string> {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(url.port), url.hostname, () => {
      const lines = [
        `POST ${UPLOAD_PATH} HTTP/1.1`,
        `Host: ${url.host}`,
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        "",
        "",
      ];
      socket.write(lines.join("\r\n"));
    });
    let received = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("no answer within 5 s: the server waited for the body"));
    }, 5000);
    socket.on("data", (chunk: Buffer) => {
      received += chunk.toString("latin1");
      if (received.includes("\r\n")) {
        clearTimeout(timer);
        socket.destroy();
        resolve(received.slice(0, received.indexOf("\r\n")));
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe("POST /admin/media/uploads (real app, real Postgres, real sharp, temp MEDIA_DIR)", () => {
  let media: MediaApp;

  beforeAll(async () => {
    await ensureMigrated();
    media = await startMediaApp();
  });

  afterAll(async () => {
    await media.close();
  });

  afterEach(async () => {
    // Every answer, success or refusal, leaves no temp file behind.
    expect(await filesUnder(join(media.mediaDir, ".tmp"))).toEqual([]);
  });

  async function rowsOf(id: string) {
    return media.db.select().from(mediaUpload).where(eq(mediaUpload.id, id));
  }

  async function storedFiles(): Promise<string[]> {
    return (await filesUnder(media.mediaDir)).filter((path) => !path.startsWith(".tmp/"));
  }

  describe("a valid upload", () => {
    it("answers 201 with the stored output, stores a re-encode under a random key and records the row", async () => {
      const result = await upload(media.baseUrl, await images.jpegWithExif(), {
        [TEST_ADMIN_HEADER]: "manager",
      });
      expect(result.status).toBe(201);
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(result.headers.get("location")).toBeNull();
      const body = result.body;
      expect(Object.keys(body).sort()).toEqual(
        ["byteSize", "contentType", "createdAt", "height", "id", "url", "width"].sort(),
      );
      expect(body.contentType).toBe("image/jpeg");
      expect({ width: body.width, height: body.height }).toEqual({ width: 20, height: 60 });
      expect(body.url.startsWith(`${TEST_MEDIA_BASE_URL}/`)).toBe(true);
      const key = body.url.slice(TEST_MEDIA_BASE_URL.length + 1);
      expect(isMediaKey(key)).toBe(true);
      expect(key.endsWith(".jpg")).toBe(true);

      const path = join(media.mediaDir, key.slice(0, 2), key.slice(2, 4), key);
      const bytes = await readFile(path);
      expect(bytes.length).toBe(body.byteSize);
      expect((await stat(path)).mode & 0o777).toBe(0o640);
      expect(bytes.includes(Buffer.from(images.EXIF_MARKER))).toBe(false);
      const metadata = await sharp(bytes).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();

      const [row] = await rowsOf(body.id);
      expect(row).toMatchObject({
        storageKey: key,
        contentType: "image/jpeg",
        byteSize: bytes.length,
        width: 20,
        height: 60,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        createdBy: media.admins.authenticate({ headers: { [TEST_ADMIN_HEADER]: "manager" } })
          ?.userId,
        firstAttachedAt: null,
      });
      expect(row?.createdAt.toISOString()).toBe(body.createdAt);
    });

    it("keeps the type of PNG and WebP and answers the output's own size", async () => {
      for (const [bytes, contentType, extension] of [
        [await images.pngWithAlpha(), "image/png", ".png"],
        [await images.webpLossless(), "image/webp", ".webp"],
        [await images.webp(), "image/webp", ".webp"],
      ] as const) {
        const result = await upload(media.baseUrl, bytes);
        expect(result.status, contentType).toBe(201);
        expect(result.body.contentType).toBe(contentType);
        expect(result.body.url.endsWith(extension)).toBe(true);
      }
    });

    it("gives two uploads of the same picture two keys and two rows", async () => {
      const bytes = await images.jpeg();
      const first = await upload(media.baseUrl, bytes);
      const second = await upload(media.baseUrl, bytes);
      expect(first.body.url).not.toBe(second.body.url);
      expect(first.body.id).not.toBe(second.body.id);
    });

    it("ignores the declared content type of the parts it cannot see: a name or an extension never matters", async () => {
      const result = await upload(media.baseUrl, await images.pngWithAlpha(), {
        "content-disposition": 'attachment; filename="../../evil.html"',
      });
      expect(result.status).toBe(201);
      expect(result.body.url).not.toContain("evil");
      expect(result.body.contentType).toBe("image/png");
    });

    it("writes one info log line with ids and numbers only, never a header value", async () => {
      const spy = vi.spyOn(Logger.prototype, "log");
      try {
        const result = await upload(media.baseUrl, await images.webp(), {
          "user-agent": "evil-agent-<script>",
          "x-custom": "header-value-secret",
        });
        expect(result.status).toBe(201);
        const lines = spy.mock.calls
          .map((call) => String(call[0]))
          .filter((line) => line.includes(result.body.id));
        expect(lines).toHaveLength(1);
        const line = lines[0] ?? "";
        expect(line).toMatch(
          /^Stored upload id=[0-9a-f-]{36} admin=[0-9a-f-]{36} type=webp bytesIn=\d+ bytesOut=\d+ width=40 height=30 durationMs=\d+$/,
        );
        expect(line).not.toContain("evil-agent");
        expect(line).not.toContain("secret");
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("refusals (400 validation_failed with one reason at path body; nothing stored)", () => {
    it.each([
      ["svg", () => images.SVG_WITH_SCRIPT, "unsupported_type"],
      ["html", () => images.HTML_PAGE, "unsupported_type"],
      ["pdf", () => images.PDF_DOCUMENT, "unsupported_type"],
      ["gif", images.gif, "unsupported_type"],
      ["tiff", images.tiff, "unsupported_type"],
      ["avif", images.avif, "unsupported_type"],
      ["truncated jpeg", images.truncatedJpeg, "corrupt_image"],
      ["animated webp", images.animatedWebp, "animated_not_supported"],
      ["png bomb header", () => images.pngHeaderClaiming(100_000, 100_000), "dimensions_too_large"],
      [
        "jpeg 65000 header",
        () => images.jpegHeaderClaiming(65_000, 65_000),
        "dimensions_too_large",
      ],
      ["png 12001 px wide", () => images.pngHeaderClaiming(12_001, 2), "dimensions_too_large"],
      ["png 56 megapixels", () => images.pngHeaderClaiming(8_000, 7_000), "too_many_pixels"],
    ])("%s: %s", async (_name, make, reason) => {
      const before = await storedFiles();
      const result = await upload<ProblemBody>(media.baseUrl, await make());
      expect(result.status).toBe(400);
      expect(result.headers.get("content-type")).toContain("application/problem+json");
      expect(result.body).toMatchObject({
        code: "validation_failed",
        errors: [expect.objectContaining({ path: "body", code: reason })],
      });
      expect(result.body.errors).toHaveLength(1);
      expect(await storedFiles()).toEqual(before);
    });

    it("an image with a lying extension in the bytes it is not (HTML sent as a .jpg upload)", async () => {
      const result = await upload<ProblemBody>(
        media.baseUrl,
        Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), images.HTML_PAGE]),
      );
      expect(result.status).toBe(400);
      expect(result.body.errors?.[0]?.code).toBe("corrupt_image");
    });

    it("a body shorter than the image it claims to be (Content-Length cut below the real size)", async () => {
      const bytes = await images.jpeg(300, 200);
      const result = await rawRequest(
        media.baseUrl,
        "POST",
        UPLOAD_PATH,
        {
          "content-type": "application/octet-stream",
          "x-fluxkit-csrf": "1",
          "content-length": bytes.length - 100,
          connection: "close",
        },
        bytes.subarray(0, bytes.length - 100),
      );
      expect(result.status).toBe(400);
      expect(JSON.parse(result.body.toString()).errors[0].code).toBe("corrupt_image");
    });

    it("an empty body: 400 empty_file", async () => {
      const result = await upload<ProblemBody>(media.baseUrl, Buffer.alloc(0));
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual([expect.objectContaining({ code: "empty_file" })]);
    });

    it("no Content-Length (chunked): 411 length_required", async () => {
      const result = await rawRequest(
        media.baseUrl,
        "POST",
        UPLOAD_PATH,
        {
          "content-type": "application/octet-stream",
          "x-fluxkit-csrf": "1",
          "transfer-encoding": "chunked",
        },
        [await images.jpeg()],
      );
      expect(result.status).toBe(411);
      const body = JSON.parse(result.body.toString()) as ProblemBody;
      expect(body).toMatchObject({ code: "validation_failed", status: 411 });
      expect(body.errors).toEqual([
        expect.objectContaining({ path: "body", code: "length_required" }),
      ]);
    });

    it("a declared length above MEDIA_MAX_BYTES: 413 file_too_large, answered before the body is sent", async () => {
      const line = await headOnlyStatus(media.baseUrl, {
        "content-type": "application/octet-stream",
        "x-fluxkit-csrf": "1",
        "content-length": String(10 * 1024 * 1024 + 1),
      });
      expect(line).toBe("HTTP/1.1 413 Payload Too Large");
      const result = await rawRequest(
        media.baseUrl,
        "POST",
        UPLOAD_PATH,
        {
          "content-type": "application/octet-stream",
          "x-fluxkit-csrf": "1",
          "content-length": 10 * 1024 * 1024 + 1,
          connection: "close",
        },
        Buffer.alloc(16),
      ).catch(() => undefined);
      if (result !== undefined) {
        expect(result.status).toBe(413);
        expect(JSON.parse(result.body.toString()).errors[0].code).toBe("file_too_large");
      }
    });

    it("a client that sends less than it declared and goes away leaves nothing behind", async () => {
      const before = await storedFiles();
      const url = new URL(media.baseUrl);
      await new Promise<void>((resolve) => {
        const socket = connect(Number(url.port), url.hostname, () => {
          socket.write(
            [
              `POST ${UPLOAD_PATH} HTTP/1.1`,
              `Host: ${url.host}`,
              "Content-Type: application/octet-stream",
              "X-Fluxkit-CSRF: 1",
              "Content-Length: 5000",
              "",
              "",
            ].join("\r\n"),
          );
          socket.write(Buffer.alloc(100));
          setTimeout(() => {
            socket.destroy();
            resolve();
          }, 100);
        });
      });
      // The server notices the abort asynchronously.
      await vi.waitFor(async () => {
        expect(await filesUnder(join(media.mediaDir, ".tmp"))).toEqual([]);
      });
      expect(await storedFiles()).toEqual(before);
    });
  });

  describe("CSRF (ADR 0028 decision 4)", () => {
    it("refuses a missing or wrong X-Fluxkit-CSRF header with 403", async () => {
      for (const value of [undefined, "0", "true"]) {
        const response = await fetch(`${media.baseUrl}${UPLOAD_PATH}`, {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            ...(value === undefined ? {} : { "x-fluxkit-csrf": value }),
          },
          body: await images.jpeg(),
        });
        expect(response.status, String(value)).toBe(403);
        expect(((await response.json()) as ProblemBody).code).toBe("forbidden");
      }
    });

    it.each([
      "multipart/form-data; boundary=x",
      "text/plain",
      "application/x-www-form-urlencoded",
      "image/jpeg",
      "image/png",
      "application/json",
    ])("refuses %s with 403, and stores nothing", async (contentType) => {
      const before = await storedFiles();
      // A JSON body must be valid JSON to get past Express' JSON parser (which answers 400 otherwise) to the guard.
      const body = contentType === "application/json" ? Buffer.from("{}") : await images.jpeg();
      const result = await upload<ProblemBody>(media.baseUrl, body, {
        "content-type": contentType,
      });
      expect(result.status).toBe(403);
      expect(result.body.code).toBe("forbidden");
      expect(result.body.detail).toContain("application/octet-stream");
      expect(await storedFiles()).toEqual(before);
    });

    it("no other admin route accepts application/octet-stream (route walk over every write route)", async () => {
      const writes = adminRoutes(media.app).filter(
        ({ method, pattern }) =>
          !["GET", "HEAD", "OPTIONS"].includes(method) &&
          !(method === "POST" && pattern === UPLOAD_PATH),
      );
      expect(writes.length).toBeGreaterThan(40);
      for (const { method, path } of writes) {
        const result = await http<ProblemBody>(media.baseUrl, method as "POST", path, {
          rawBody: "binary-bytes",
          contentType: "application/octet-stream",
        });
        expect(result.status, `${method} ${path}`).toBe(403);
        expect(result.body.detail, `${method} ${path}`).toContain("application/json");
      }
      expect(
        adminRoutes(media.app).filter(
          ({ method, pattern }) => method === "POST" && pattern === UPLOAD_PATH,
        ),
      ).toHaveLength(1);
    });

    it("no store write route accepts application/octet-stream either", async () => {
      const writes = storeRoutes(media.app).filter(
        ({ method }) => !["GET", "HEAD", "OPTIONS"].includes(method),
      );
      expect(writes.length).toBeGreaterThan(10);
      for (const { method, path } of writes) {
        const result = await http<ProblemBody>(media.baseUrl, method as "POST", path, {
          rawBody: "binary-bytes",
          contentType: "application/octet-stream",
        });
        expect(result.status, `${method} ${path}`).toBe(403);
        expect(result.body.detail, `${method} ${path}`).toContain("application/json");
      }
    });
  });

  describe("authentication and permission come before the body", () => {
    it("refuses a viewer with 403 and stores nothing", async () => {
      const before = await storedFiles();
      const result = await upload<ProblemBody>(media.baseUrl, await images.jpeg(), {
        [TEST_ADMIN_HEADER]: "viewer",
      });
      expect(result.status).toBe(403);
      expect(result.body.detail).toContain("catalog.write");
      expect(await storedFiles()).toEqual(before);
    });

    it("answers an anonymous upload (401) and a viewer upload (403) without waiting for a body above the limit", async () => {
      const base = {
        "content-type": "application/octet-stream",
        "x-fluxkit-csrf": "1",
        "content-length": String(500 * 1024 * 1024),
      };
      expect(await headOnlyStatus(media.baseUrl, { ...base, [TEST_ADMIN_HEADER]: "nobody" })).toBe(
        "HTTP/1.1 401 Unauthorized",
      );
      expect(await headOnlyStatus(media.baseUrl, { ...base, [TEST_ADMIN_HEADER]: "viewer" })).toBe(
        "HTTP/1.1 403 Forbidden",
      );
    });
  });

  describe("storage failures", () => {
    it("answers 503 storage_unavailable when the temp directory cannot be written, and recovers", async () => {
      const tmp = join(media.mediaDir, ".tmp");
      await rm(tmp, { recursive: true });
      await writeFile(tmp, "not a directory");
      try {
        const result = await upload<ProblemBody>(media.baseUrl, await images.jpeg());
        expect(result.status).toBe(503);
        expect(result.body).toMatchObject({ code: "storage_unavailable", status: 503 });
      } finally {
        await rm(tmp);
        await mkdir(tmp, { mode: 0o750 });
      }
      expect((await upload(media.baseUrl, await images.jpeg())).status).toBe(201);
    });

    it("removes the stored file when the row insert fails (an unknown creator: 409 by the foreign key)", async () => {
      media.admins.addGhost("ghost");
      const before = await storedFiles();
      const result = await upload<ProblemBody>(media.baseUrl, await images.jpeg(), {
        [TEST_ADMIN_HEADER]: "ghost",
      });
      // The problem filter maps the foreign key violation (23503) to 409 in_use, like every other one.
      expect(result.status).toBe(409);
      expect(result.body.code).toBe("in_use");
      expect(await storedFiles()).toEqual(before);
    });
  });
});

describe("upload limits that need their own app", () => {
  let apps: MediaApp[] = [];

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    for (const started of apps) await started.close();
    apps = [];
  });

  it("counts 60 uploads per 10 minutes per admin user, not per address (a lower limit for the spec)", async () => {
    const media = await startMediaApp({
      rateLimits: { mediaUpload: { maxAttempts: 2, windowMinutes: 10 } },
    });
    apps.push(media);
    const bytes = await images.jpeg(8, 8);
    expect((await upload(media.baseUrl, bytes)).status).toBe(201);
    expect((await upload(media.baseUrl, bytes)).status).toBe(201);
    const refused = await upload<ProblemBody>(media.baseUrl, bytes);
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe("too_many_requests");
    expect(refused.headers.get("retry-after")).toBe("600");
    // Same address, another admin: not counted together.
    expect((await upload(media.baseUrl, bytes, { [TEST_ADMIN_HEADER]: "manager" })).status).toBe(
      201,
    );
  });

  it("processes at most 2 uploads at once; a third waits, then 429 with Retry-After 5", async () => {
    const media = await startMediaApp({ mediaTuning: { slotWaitMs: 200 } });
    apps.push(media);
    const slots = media.app.get(ProcessingSlots);
    const first = await slots.acquire();
    const second = await slots.acquire();
    try {
      const started = Date.now();
      const refused = await upload<ProblemBody>(media.baseUrl, await images.jpeg());
      expect(refused.status).toBe(429);
      expect(refused.body.code).toBe("too_many_requests");
      expect(refused.headers.get("retry-after")).toBe("5");
      expect(Date.now() - started).toBeGreaterThanOrEqual(190);
      expect(await filesUnder(join(media.mediaDir, ".tmp"))).toEqual([]);
    } finally {
      first?.();
      second?.();
    }
    expect((await upload(media.baseUrl, await images.jpeg())).status).toBe(201);
    expect(slots.inUse).toBe(0);
  });

  it("refuses an image that does not finish within the processing budget: 400 processing_timeout", async () => {
    const media = await startMediaApp({ mediaTuning: { processingBudgetMs: 1 } });
    apps.push(media);
    const result = await upload<ProblemBody>(media.baseUrl, await images.solidPng(3000, 3000));
    expect(result.status).toBe(400);
    expect(result.body.errors).toEqual([expect.objectContaining({ code: "processing_timeout" })]);
    await vi.waitFor(async () => {
      expect(await filesUnder(media.mediaDir)).toEqual([]);
      expect(media.app.get(ProcessingSlots).inUse).toBe(0);
    });
  });

  it("refuses a re-encoded output above MEDIA_MAX_BYTES: 400 output_too_large, nothing stored, slot free (review M-1)", async () => {
    // A 1-bit noise PNG grows when re-encoded as 24-bit RGB; the cap is inclusive, so learn the exact output size first.
    const input = await images.noisyOneBitPng(600, 600);
    const measure = await startMediaApp();
    apps.push(measure);
    const measured = await upload(measure.baseUrl, input);
    expect(measured.status).toBe(201);
    const outputBytes = measured.body.byteSize;
    expect(outputBytes).toBeGreaterThan(input.length + 1);

    const tight = await startMediaApp({ mediaMaxBytes: outputBytes - 1 });
    apps.push(tight);
    const owner = tight.admins.authenticate({ headers: {} })?.userId ?? "";
    const refused = await upload<ProblemBody>(tight.baseUrl, input);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({
      code: "validation_failed",
      errors: [expect.objectContaining({ path: "body", code: "output_too_large" })],
    });
    expect(refused.body.errors).toHaveLength(1);
    expect(await filesUnder(tight.mediaDir)).toEqual([]);
    expect(
      await tight.db.select().from(mediaUpload).where(eq(mediaUpload.createdBy, owner)),
    ).toEqual([]);
    expect(tight.app.get(ProcessingSlots).inUse).toBe(0);

    const exact = await startMediaApp({ mediaMaxBytes: outputBytes });
    apps.push(exact);
    const accepted = await upload(exact.baseUrl, input);
    expect(accepted.status).toBe(201);
    expect(accepted.body.byteSize).toBe(outputBytes);
  });

  it("applies a configured MEDIA_MAX_BYTES to the declared length", async () => {
    const media = await startMediaApp({ mediaMaxBytes: 2048 });
    apps.push(media);
    const big = await images.noisyPng(64, 64);
    expect(big.length).toBeGreaterThan(2048);
    const result = await upload<ProblemBody>(media.baseUrl, big);
    expect(result.status).toBe(413);
    expect(result.body.errors).toEqual([expect.objectContaining({ code: "file_too_large" })]);
    expect((await upload(media.baseUrl, await images.jpeg(4, 4))).status).toBe(201);
  });
});

describe("MEDIA_STORAGE_DRIVER=none", () => {
  let running: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ mediaStorageDriver: "none" });
  });

  afterAll(async () => {
    await running.app.close();
  });

  it("answers 503 uploads_disabled without reading the body", async () => {
    const result = await upload<ProblemBody>(running.baseUrl, await images.jpeg());
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ code: "uploads_disabled", status: 503 });
    expect(
      await headOnlyStatus(running.baseUrl, {
        "content-type": "application/octet-stream",
        "x-fluxkit-csrf": "1",
        "content-length": String(400 * 1024 * 1024),
      }),
    ).toBe("HTTP/1.1 503 Service Unavailable");
  });
});
