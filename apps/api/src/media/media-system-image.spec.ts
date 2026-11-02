import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isMediaKey } from "@fluxkit/core";
import { ProblemException } from "../common/problem.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { mediaUpload } from "../database/schema/index.js";
import { startApp, type RunningApp } from "../test/app.js";
import { filesUnder, TEST_MEDIA_BASE_URL } from "../test/media-app.js";
import * as images from "../test/media-images.js";
import { ensureMigrated } from "../test/migrate.js";
import { MediaUploadService } from "./media-upload.service.js";

/** The problem a refused `storeSystemImage` throws, as `{status, code, reasons}`. */
async function refusal(promise: Promise<unknown>): Promise<{
  status: number;
  code: string;
  reasons: string[];
}> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ProblemException);
  const problem = error as ProblemException;
  return {
    status: problem.getStatus(),
    code: problem.code,
    reasons: (problem.errors ?? []).map((entry) => entry.code),
  };
}

// `storeSystemImage` (the demo seed's entry, review F3 of PR 209): the same pipeline as POST /admin/media/uploads, without an
// admin. The HTTP route keeps its own spec (`media-uploads.spec.ts`); this one calls the service directly.
describe("MediaUploadService.storeSystemImage (real Postgres, local driver)", () => {
  let mediaDir: string;
  let running: RunningApp;
  let service: MediaUploadService;
  let db: Database;
  const storedKeys: string[] = [];

  beforeAll(async () => {
    await ensureMigrated();
    mediaDir = await mkdtemp(join(tmpdir(), "fluxkit-system-image-spec-"));
    running = await startApp({
      mediaStorageDriver: "local",
      mediaDir,
      mediaPublicBaseUrl: TEST_MEDIA_BASE_URL,
    });
    service = running.app.get(MediaUploadService);
    db = running.app.get<Database>(DRIZZLE);
  });

  afterAll(async () => {
    for (const key of storedKeys) {
      await db.delete(mediaUpload).where(eq(mediaUpload.storageKey, key));
    }
    await running?.app.close();
    if (mediaDir !== undefined) {
      await rm(mediaDir, { recursive: true, force: true });
    }
  });

  it("stores a re-encoded file under a random key with a row that names no admin", async () => {
    const stored = await service.storeSystemImage(await images.webp(40, 30));
    const key = stored.url.slice(TEST_MEDIA_BASE_URL.length + 1);
    storedKeys.push(key);
    expect(stored.url.startsWith(`${TEST_MEDIA_BASE_URL}/`)).toBe(true);
    expect(isMediaKey(key)).toBe(true);
    expect(stored).toMatchObject({ contentType: "image/webp", width: 40, height: 30 });
    const [row] = await db.select().from(mediaUpload).where(eq(mediaUpload.storageKey, key));
    expect(row?.createdBy).toBeNull();
    // Not attached until a product save names it (attach marking), like an admin upload.
    expect(row?.firstAttachedAt).toBeNull();
    expect(await filesUnder(mediaDir)).toContainEqual(expect.stringContaining(key));
    const served = await fetch(`${running.baseUrl}/media/${key}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/webp");
  });

  it("refuses what the route refuses (type gate, empty file) and stores nothing", async () => {
    const filesBefore = await filesUnder(mediaDir);
    const rowsBefore = await db.select({ id: mediaUpload.id }).from(mediaUpload);
    expect(await refusal(service.storeSystemImage(await images.gif()))).toEqual({
      status: 400,
      code: "validation_failed",
      reasons: ["unsupported_type"],
    });
    expect(await refusal(service.storeSystemImage(new Uint8Array(0)))).toEqual({
      status: 400,
      code: "validation_failed",
      reasons: ["empty_file"],
    });
    expect(await filesUnder(mediaDir)).toEqual(filesBefore);
    expect(await db.select({ id: mediaUpload.id }).from(mediaUpload)).toHaveLength(
      rowsBefore.length,
    );
  });
});

describe("MediaUploadService.storeSystemImage with MEDIA_STORAGE_DRIVER=none", () => {
  let running: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ mediaStorageDriver: "none" });
  });

  afterAll(async () => {
    await running?.app.close();
  });

  it("answers 503 uploads_disabled and writes no row", async () => {
    const db = running.app.get<Database>(DRIZZLE);
    const before = await db.select({ id: mediaUpload.id }).from(mediaUpload);
    const service = running.app.get(MediaUploadService);
    expect(await refusal(service.storeSystemImage(await images.webp()))).toEqual({
      status: 503,
      code: "uploads_disabled",
      reasons: [],
    });
    expect(await db.select({ id: mediaUpload.id }).from(mediaUpload)).toHaveLength(before.length);
  });
});
