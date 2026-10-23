import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { link, mkdir, open, readdir, rm, stat, unlink, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  contentTypeOf,
  keyToRelativePath,
  typeOfKey,
  type AllowedContentType,
  type MediaKey,
  type MediaReadable,
  type MediaStoragePort,
} from "@fluxkit/core";

/** A new, empty, exclusively created temp file (`wx`, mode 0640) and its open handle. The caller closes the handle. */
export interface TempFile {
  readonly path: string;
  readonly handle: FileHandle;
}

/**
 * The storage the upload route needs: the port of core plus a place for temp files on the same file system (so the final
 * move is an atomic link). Only the local driver can give one; with `none` uploads are refused before it is asked.
 */
export interface UploadStorage extends MediaStoragePort {
  createTempFile(): Promise<TempFile>;
}

const DIRECTORY_MODE = 0o750;
const FILE_MODE = 0o640;
const TEMP_DIRECTORY = ".tmp";
/** Temp entries older than this are leftovers of a crash and are removed at start (ADR 0028 decision 7). */
export const STALE_TEMP_AGE_MS = 60 * 60 * 1000;

function codeOf(error: unknown): string | undefined {
  const code: unknown = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * The local-disk driver (ADR 0028 decisions 6 and 7): `MEDIA_DIR/<2 hex>/<2 hex>/<key>`, directories 0750, files 0640.
 * Every path is built only from a key that passed `isMediaKey` (core `keyToRelativePath` throws otherwise) and is checked
 * to stay inside `MEDIA_DIR` after resolving. Files are moved in with `link`, which fails when the target exists, so a
 * key is never overwritten. Single instance or a shared volume only (see README).
 */
export class LocalMediaStorage implements UploadStorage {
  private constructor(
    readonly directory: string,
    readonly tempDirectory: string,
  ) {}

  /** Checks `MEDIA_DIR` once at start and fails loudly: absolute, an existing directory, writable (probe file). */
  static async open(directory: string, now: () => number = Date.now): Promise<LocalMediaStorage> {
    if (!isAbsolute(directory)) {
      throw new Error("MEDIA_DIR must be an absolute path");
    }
    const root = resolve(directory);
    let rootStat;
    try {
      rootStat = await stat(root);
    } catch (error) {
      if (codeOf(error) === "ENOENT") {
        throw new Error(`MEDIA_DIR ${root} does not exist; create it (mode 0750) before starting`, {
          cause: error,
        });
      }
      throw error;
    }
    if (!rootStat.isDirectory()) {
      throw new Error(`MEDIA_DIR ${root} is not a directory`);
    }
    const probe = join(root, `.probe-${randomBytes(8).toString("hex")}`);
    try {
      const handle = await open(probe, "wx", FILE_MODE);
      await handle.close();
      await unlink(probe);
    } catch (error) {
      throw new Error(`MEDIA_DIR ${root} is not writable (${codeOf(error) ?? "unknown error"})`, {
        cause: error,
      });
    }
    const tempDirectory = join(root, TEMP_DIRECTORY);
    await mkdir(tempDirectory, { mode: DIRECTORY_MODE, recursive: true });
    const storage = new LocalMediaStorage(root, tempDirectory);
    await storage.removeStaleTempFiles(now());
    return storage;
  }

  /** The absolute path of a key. Throws a RangeError for anything that is not a key or would leave `MEDIA_DIR`. */
  pathOf(key: MediaKey): string {
    const path = resolve(this.directory, keyToRelativePath(key));
    if (!path.startsWith(this.directory + sep)) {
      throw new RangeError("A media path must stay inside MEDIA_DIR");
    }
    return path;
  }

  async createTempFile(): Promise<TempFile> {
    const path = join(this.tempDirectory, randomBytes(16).toString("hex"));
    const handle = await open(path, "wx", FILE_MODE);
    try {
      // The mode argument of open is reduced by the umask; the files must be exactly 0640.
      await handle.chmod(FILE_MODE);
    } catch (error) {
      await handle.close();
      await unlink(path);
      throw error;
    }
    return { path, handle };
  }

  async put(key: MediaKey, sourcePath: string, contentType: AllowedContentType): Promise<void> {
    const target = this.pathOf(key);
    if (contentTypeOf(typeOfKey(key)) !== contentType) {
      throw new Error("The content type does not match the key's extension");
    }
    const source = resolve(sourcePath);
    if (dirname(source) !== this.tempDirectory) {
      throw new Error("Only a file of the media temp directory can be stored");
    }
    // The bytes must be on disk before the name points at them (a crash must not leave a truncated image).
    const handle = await open(source, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    const shard = dirname(target);
    await mkdir(shard, { mode: DIRECTORY_MODE, recursive: true });
    try {
      await link(source, target);
    } catch (error) {
      if (codeOf(error) === "EEXIST") {
        throw new Error("A media file with this key already exists; it is never overwritten", {
          cause: error,
        });
      }
      throw error;
    }
    await this.syncDirectory(shard);
    await unlink(source);
  }

  async open(key: MediaKey): Promise<{ stream: MediaReadable; byteSize: number } | undefined> {
    const path = this.pathOf(key);
    let handle: FileHandle;
    try {
      // O_NOFOLLOW: a symlink planted at the key's place is never followed.
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      const code = codeOf(error);
      if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
        return undefined;
      }
      throw error;
    }
    try {
      const fileStat = await handle.stat();
      if (!fileStat.isFile()) {
        await handle.close();
        return undefined;
      }
      // The stream owns the handle from here and closes it when it ends or is destroyed.
      return { stream: handle.createReadStream(), byteSize: fileStat.size };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async delete(key: MediaKey): Promise<void> {
    try {
      await unlink(this.pathOf(key));
    } catch (error) {
      if (codeOf(error) !== "ENOENT") {
        throw error;
      }
    }
  }

  private async syncDirectory(path: string): Promise<void> {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async removeStaleTempFiles(nowMs: number): Promise<void> {
    for (const entry of await readdir(this.tempDirectory)) {
      const path = join(this.tempDirectory, entry);
      try {
        const entryStat = await stat(path);
        if (nowMs - entryStat.mtimeMs > STALE_TEMP_AGE_MS) {
          await rm(path, { recursive: true, force: true });
        }
      } catch (error) {
        // Another process removed it between readdir and stat: nothing left to clean.
        if (codeOf(error) !== "ENOENT") {
          throw error;
        }
      }
    }
  }
}

/** `MEDIA_STORAGE_DRIVER=none`: nothing is stored or served; the read route answers 404, the upload route 503 first. */
export class DisabledMediaStorage implements UploadStorage {
  open(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  put(): Promise<void> {
    return Promise.reject(new Error("Media storage is switched off (MEDIA_STORAGE_DRIVER=none)"));
  }

  createTempFile(): Promise<TempFile> {
    return Promise.reject(new Error("Media storage is switched off (MEDIA_STORAGE_DRIVER=none)"));
  }

  delete(): Promise<void> {
    return Promise.resolve();
  }
}
