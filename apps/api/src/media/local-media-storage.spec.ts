import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MediaKey } from "@fluxkit/core";
import {
  DisabledMediaStorage,
  LocalMediaStorage,
  type UploadStorage,
} from "./local-media-storage.js";
import { isStorageUnavailableError } from "./media-problems.js";

const KEY = "3f2a9c0d1b7e4f6a8c5d2e1f00aabbcc.webp" as MediaKey;
const OTHER = "00112233445566778899aabbccddeeff.png" as MediaKey;

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe("LocalMediaStorage (ADR 0028 decisions 6 and 7)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "fluxkit-media-storage-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function tempWith(storage: LocalMediaStorage, content: string): Promise<string> {
    const temp = await storage.createTempFile();
    await temp.handle.writeFile(content);
    await temp.handle.close();
    return temp.path;
  }

  describe("start-up check (fails loudly)", () => {
    it("refuses a relative directory", async () => {
      await expect(LocalMediaStorage.open("var/media")).rejects.toThrow(/absolute/);
    });

    it("refuses a directory that does not exist", async () => {
      await expect(LocalMediaStorage.open(join(root, "missing"))).rejects.toThrow(/does not exist/);
    });

    it("refuses a file in place of the directory", async () => {
      await writeFile(join(root, "file"), "x");
      await expect(LocalMediaStorage.open(join(root, "file"))).rejects.toThrow(/not a directory/);
    });

    it("refuses a directory it cannot write (probe file)", async () => {
      // /proc is a directory nobody can create files in, not even root.
      await expect(LocalMediaStorage.open("/proc")).rejects.toThrow(/not writable/);
    });

    it("creates .tmp (mode 0750) and leaves no probe file behind", async () => {
      await LocalMediaStorage.open(root);
      expect(await readdir(root)).toEqual([".tmp"]);
      expect((await stat(join(root, ".tmp"))).mode & 0o777).toBe(0o750);
    });

    it("deletes .tmp entries older than one hour and keeps newer ones", async () => {
      await mkdir(join(root, ".tmp"));
      const old = join(root, ".tmp", "old-upload");
      const fresh = join(root, ".tmp", "fresh-upload");
      await writeFile(old, "x");
      await writeFile(fresh, "y");
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await utimes(old, twoHoursAgo, twoHoursAgo);
      await LocalMediaStorage.open(root);
      expect(await readdir(join(root, ".tmp"))).toEqual(["fresh-upload"]);
    });
  });

  it("creates temp files under .tmp with mode 0640 and never reuses a name", async () => {
    const storage = await LocalMediaStorage.open(root);
    const first = await storage.createTempFile();
    const second = await storage.createTempFile();
    await first.handle.close();
    await second.handle.close();
    expect(first.path).not.toBe(second.path);
    for (const path of [first.path, second.path]) {
      expect(path.startsWith(join(root, ".tmp") + "/")).toBe(true);
      expect((await stat(path)).mode & 0o777).toBe(0o640);
    }
  });

  it("puts a file at MEDIA_DIR/<2 hex>/<2 hex>/<key> and removes the temp file", async () => {
    const storage = await LocalMediaStorage.open(root);
    const source = await tempWith(storage, "image bytes");
    await storage.put(KEY, source, "image/webp");
    const final = join(root, "3f", "2a", KEY);
    expect(await readFile(final, "utf8")).toBe("image bytes");
    expect((await stat(final)).mode & 0o777).toBe(0o640);
    expect((await stat(join(root, "3f"))).mode & 0o777).toBe(0o750);
    expect(await readdir(join(root, ".tmp"))).toEqual([]);
  });

  it("never overwrites an existing key: the second put fails and the first file stays", async () => {
    const storage = await LocalMediaStorage.open(root);
    await storage.put(KEY, await tempWith(storage, "first"), "image/webp");
    const second = await tempWith(storage, "second");
    await expect(storage.put(KEY, second, "image/webp")).rejects.toThrow(/already exists/);
    expect(await readFile(join(root, "3f", "2a", KEY), "utf8")).toBe("first");
  });

  it("refuses a source outside its .tmp directory and a content type that does not match the key", async () => {
    const storage = await LocalMediaStorage.open(root);
    const outside = join(root, "outside");
    await writeFile(outside, "x");
    await expect(storage.put(KEY, outside, "image/webp")).rejects.toThrow(/temp directory/);
    await expect(storage.put(KEY, "/etc/passwd", "image/webp")).rejects.toThrow(/temp directory/);
    const source = await tempWith(storage, "x");
    await expect(storage.put(KEY, source, "image/png")).rejects.toThrow(/content type/);
    await expect(
      storage.put(KEY, join(root, ".tmp", "..", "outside"), "image/webp"),
    ).rejects.toThrow(/temp directory/);
  });

  it.each([
    "../../etc/passwd",
    "..%2f..%2fetc%2fpasswd",
    `${KEY.toUpperCase()}`,
    `${KEY}\0`,
    `3f/2a/${KEY}`,
    "",
  ])("refuses to build a path from %j", async (value) => {
    const storage = await LocalMediaStorage.open(root);
    expect(() => storage.pathOf(value as MediaKey)).toThrow(RangeError);
    await expect(storage.open(value as MediaKey)).rejects.toThrow(RangeError);
    await expect(storage.delete(value as MediaKey)).rejects.toThrow(RangeError);
  });

  it("opens a stored file as a stream with its size; an absent key is undefined", async () => {
    const storage = await LocalMediaStorage.open(root);
    await storage.put(KEY, await tempWith(storage, "0123456789"), "image/webp");
    const opened = await storage.open(KEY);
    if (opened === undefined) throw new Error("expected the stored file");
    expect(opened.byteSize).toBe(10);
    expect((await collect(opened.stream)).toString()).toBe("0123456789");
    expect(await storage.open(OTHER)).toBeUndefined();
  });

  it("does not follow a directory that is not a regular file at the key's place", async () => {
    const storage = await LocalMediaStorage.open(root);
    await mkdir(join(root, "3f", "2a", KEY), { recursive: true });
    expect(await storage.open(KEY)).toBeUndefined();
  });

  it("does not serve a symlink planted at the key's place", async () => {
    const storage = await LocalMediaStorage.open(root);
    await mkdir(join(root, "00", "11"), { recursive: true });
    await symlink("/etc/passwd", join(root, "00", "11", OTHER));
    expect(await storage.open(OTHER)).toBeUndefined();
  });

  it("deletes idempotently", async () => {
    const storage = await LocalMediaStorage.open(root);
    await storage.put(KEY, await tempWith(storage, "x"), "image/webp");
    await storage.delete(KEY);
    await storage.delete(KEY);
    expect(await storage.open(KEY)).toBeUndefined();
  });
});

describe("DisabledMediaStorage (MEDIA_STORAGE_DRIVER=none)", () => {
  it("finds nothing, stores nothing, deletes nothing", async () => {
    const storage: UploadStorage = new DisabledMediaStorage();
    expect(await storage.open(KEY)).toBeUndefined();
    await expect(storage.put(KEY, "/x", "image/webp")).rejects.toThrow(/switched off/);
    await expect(storage.createTempFile()).rejects.toThrow(/switched off/);
    await expect(storage.delete(KEY)).resolves.toBeUndefined();
  });
});

describe("isStorageUnavailableError", () => {
  it.each(["ENOSPC", "EDQUOT", "EROFS", "EACCES", "EPERM", "ENOTDIR", "ENOENT"])(
    "%s means the storage cannot be written (503 storage_unavailable)",
    (code) => {
      expect(isStorageUnavailableError(Object.assign(new Error("x"), { code }))).toBe(true);
    },
  );

  it.each([undefined, "EEXIST", "EINVAL", "EMFILE"])("%s does not", (code) => {
    expect(isStorageUnavailableError(Object.assign(new Error("x"), { code }))).toBe(false);
    expect(isStorageUnavailableError("ENOSPC")).toBe(false);
  });
});
