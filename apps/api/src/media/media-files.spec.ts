import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.factory.js";
import { SESSION_COOKIE_NAME } from "../auth/session-cookie.js";
import { CUSTOMER_SESSION_COOKIE_NAME } from "../customers/auth/customer-session-cookie.js";
import { TEST_ORDER_TOKEN_SECRET, TEST_SCRYPT_PARAMS } from "../test/app.js";
import {
  rawRequest,
  startMediaApp,
  TEST_MEDIA_BASE_URL,
  type MediaApp,
} from "../test/media-app.js";
import * as images from "../test/media-images.js";
import { ensureMigrated } from "../test/migrate.js";

const ABSENT_KEY = "ffffffffffffffffffffffffffffffff.png";

/** The headers every served file carries (ADR 0028 decision 6), pinned exactly. */
function expectedHeaders(key: string, contentType: string, byteSize: number) {
  return {
    "content-type": contentType,
    "content-length": String(byteSize),
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    "content-disposition": `inline; filename="${key}"`,
    "cache-control": "public, max-age=31536000, immutable",
    etag: `"${key}"`,
    "cross-origin-resource-policy": "cross-origin",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
  };
}

async function uploadedKey(media: MediaApp, bytes: Buffer): Promise<{ key: string; size: number }> {
  const response = await fetch(`${media.baseUrl}/admin/media/uploads`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "x-fluxkit-csrf": "1" },
    body: bytes,
  });
  const body = (await response.json()) as { url: string; byteSize: number };
  if (response.status !== 201)
    throw new Error(`Test setup bug: upload answered ${response.status}`);
  return { key: body.url.slice(TEST_MEDIA_BASE_URL.length + 1), size: body.byteSize };
}

describe("GET and HEAD /media/{key} (real app, temp MEDIA_DIR)", () => {
  let media: MediaApp;
  let jpegKey: string;
  let jpegSize: number;
  let pngKey: string;
  let webpKey: string;

  beforeAll(async () => {
    await ensureMigrated();
    media = await startMediaApp();
    ({ key: jpegKey, size: jpegSize } = await uploadedKey(media, await images.jpeg()));
    pngKey = (await uploadedKey(media, await images.pngWithAlpha())).key;
    webpKey = (await uploadedKey(media, await images.webp())).key;
  });

  afterAll(async () => {
    await media.close();
  });

  it("serves the stored bytes with every pinned header and nothing that sets a cookie", async () => {
    const result = await rawRequest(media.baseUrl, "GET", `/media/${jpegKey}`, {});
    expect(result.status).toBe(200);
    expect(result.headers).toMatchObject(expectedHeaders(jpegKey, "image/jpeg", jpegSize));
    expect(result.headers["set-cookie"]).toBeUndefined();
    expect(result.headers["access-control-allow-origin"]).toBeUndefined();
    const onDisk = await readFile(
      join(media.mediaDir, jpegKey.slice(0, 2), jpegKey.slice(2, 4), jpegKey),
    );
    expect(result.body.equals(onDisk)).toBe(true);
  });

  it("sends the content type of the key's extension", async () => {
    for (const [key, contentType] of [
      [pngKey, "image/png"],
      [webpKey, "image/webp"],
    ] as const) {
      const result = await rawRequest(media.baseUrl, "GET", `/media/${key}`, {});
      expect(result.status).toBe(200);
      expect(result.headers["content-type"]).toBe(contentType);
    }
  });

  it("answers HEAD with the same headers and no body", async () => {
    const result = await rawRequest(media.baseUrl, "HEAD", `/media/${jpegKey}`, {});
    expect(result.status).toBe(200);
    expect(result.headers).toMatchObject(expectedHeaders(jpegKey, "image/jpeg", jpegSize));
    expect(result.body.length).toBe(0);
  });

  it("answers 304 to a matching If-None-Match, with the caching headers and no body", async () => {
    const result = await rawRequest(media.baseUrl, "GET", `/media/${jpegKey}`, {
      "if-none-match": `"${jpegKey}"`,
    });
    expect(result.status).toBe(304);
    expect(result.body.length).toBe(0);
    expect(result.headers).toMatchObject({
      etag: `"${jpegKey}"`,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    });
    const other = await rawRequest(media.baseUrl, "GET", `/media/${jpegKey}`, {
      "if-none-match": `"${pngKey}"`,
    });
    expect(other.status).toBe(200);
  });

  it("answers 404 with no-store and no echo of the key for an absent file", async () => {
    for (const method of ["GET", "HEAD"]) {
      const result = await rawRequest(media.baseUrl, method, `/media/${ABSENT_KEY}`, {});
      expect(result.status, method).toBe(404);
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(result.headers["x-content-type-options"]).toBe("nosniff");
      expect(result.body.toString()).not.toContain("ffffffff");
    }
  });

  it.each([
    "/media/..%2f..%2f..%2fetc%2fpasswd",
    "/media/%2e%2e",
    "/media/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    "/media/..%5c..%5cetc%5cpasswd",
    "/media/.tmp",
    "/media/%2etmp",
    "/media/KEY_UPPER",
    "/media/KEY%00",
    "/media/KEY%00.png",
    "/media/KEY.png",
    "/media/KEY_HEX_ENCODED",
    "/media/ab/cd/KEY",
    "/media/KEY_SHARD",
    "/media/KEY_EXT_UPPER",
    "/media/KEY%20",
    "/media/%20KEY",
  ])("answers 404 for %s", async (template) => {
    const path = template
      .replace("KEY_UPPER", jpegKey.toUpperCase())
      .replace("KEY_HEX_ENCODED", `%${jpegKey.charCodeAt(0).toString(16)}${jpegKey.slice(1)}`)
      .replace("KEY_SHARD", `${jpegKey.slice(0, 2)}%2f${jpegKey.slice(2, 4)}%2f${jpegKey}`)
      .replace("KEY_EXT_UPPER", jpegKey.replace(".jpg", ".JPG"))
      .replace("KEY", jpegKey);
    const result = await rawRequest(media.baseUrl, "GET", path, {});
    expect(result.status, path).toBe(404);
    expect(result.headers["cache-control"], path).toBe("no-store");
    expect(result.body.toString(), path).not.toContain("root:");
  });

  it("answers the bare /media and /media/ with the same 404: no-store and nosniff, GET and HEAD (step 9 review)", async () => {
    for (const method of ["GET", "HEAD"]) {
      for (const path of ["/media", "/media/", "/MEDIA", "/media?x=1"]) {
        const result = await rawRequest(media.baseUrl, method, path, {});
        expect(result.status, `${method} ${path}`).toBe(404);
        expect(result.headers["cache-control"], `${method} ${path}`).toBe("no-store");
        expect(result.headers["x-content-type-options"], `${method} ${path}`).toBe("nosniff");
        expect(result.headers["set-cookie"], `${method} ${path}`).toBeUndefined();
      }
    }
  });

  it("does not answer other methods", async () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const result = await rawRequest(media.baseUrl, method, `/media/${jpegKey}`, {
        "x-fluxkit-csrf": "1",
      });
      expect(result.status, method).toBe(404);
    }
  });
});

describe("the read route reads no cookie and no database row", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let mediaDir: string;
  let key: string;

  beforeAll(async () => {
    await ensureMigrated();
    // Upload one file through a normal app into a directory, then serve that directory from an app whose database is
    // unreachable: any database read (a session lookup through a cookie included) would fail the request.
    const media = await startMediaApp();
    mediaDir = await mkdtemp(join(tmpdir(), "fluxkit-media-nodb-"));
    try {
      key = (await uploadedKey(media, await images.webp())).key;
      const { cp } = await import("node:fs/promises");
      await cp(media.mediaDir, mediaDir, { recursive: true });
    } finally {
      await media.close();
    }
    app = await createApp(
      {
        databaseUrl: "postgres://nobody:nothing@127.0.0.1:1/unreachable_test",
        enabledFeatures: [],
        featuresDir: undefined,
        orderTokenSecret: TEST_ORDER_TOKEN_SECRET,
        mediaStorageDriver: "local",
        mediaDir,
        mediaPublicBaseUrl: TEST_MEDIA_BASE_URL,
      },
      { scrypt: TEST_SCRYPT_PARAMS, cleanExpiredSessionsOnBootstrap: false, logLevels: [] },
    );
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await app.close();
    await rm(mediaDir, { recursive: true, force: true });
  });

  it("serves the file with admin and customer cookies attached, while a database route fails", async () => {
    const cookie = `${SESSION_COOKIE_NAME}=${"A".repeat(43)}; ${CUSTOMER_SESSION_COOKIE_NAME}=${"B".repeat(43)}`;
    const served = await rawRequest(baseUrl, "GET", `/media/${key}`, { cookie });
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/webp");
    // Proof that the database is really unreachable for this app: a route that reads it fails.
    const me = await rawRequest(baseUrl, "GET", "/admin/auth/me", { cookie });
    expect(me.status).toBe(500);
  });
});

describe("the read route with MEDIA_STORAGE_DRIVER=none", () => {
  it("answers 404 for every key", async () => {
    await ensureMigrated();
    const media = await startMediaApp();
    const key = (await uploadedKey(media, await images.jpeg())).key;
    const disabled = await createApp(
      {
        databaseUrl: "postgres://nobody:nothing@127.0.0.1:1/unreachable_test",
        enabledFeatures: [],
        featuresDir: undefined,
        orderTokenSecret: TEST_ORDER_TOKEN_SECRET,
        mediaStorageDriver: "none",
        mediaDir: media.mediaDir,
      },
      { cleanExpiredSessionsOnBootstrap: false, logLevels: [] },
    );
    try {
      await disabled.listen(0, "127.0.0.1");
      const url = `http://127.0.0.1:${(disabled.getHttpServer().address() as { port: number }).port}`;
      const result = await rawRequest(url, "GET", `/media/${key}`, {});
      expect(result.status).toBe(404);
      expect(result.headers["cache-control"]).toBe("no-store");
    } finally {
      await disabled.close();
      await media.close();
    }
  });
});
