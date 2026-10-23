import type { AllowedContentType } from "./image-types.js";
import type { MediaKey } from "./key.js";

/*
 * The media storage port (ADR 0028 decision 2, ADR 0018 pattern). Types and constants only, so a later storage driver
 * package (for example S3) can implement it without importing `apps/api` (dependency-cruiser forbids it). `apps/api`
 * implements it with the local-disk driver. Internal until listed in `docs/contracts/`; it becomes a contract when the first
 * external driver exists.
 */

/** Injection token of the port: `@Inject(MEDIA_STORAGE_PORT)`, implemented by `apps/api`. */
export const MEDIA_STORAGE_PORT = "fluxkit:media-storage-port";

/**
 * What the read route needs from a file: something to stream and to stop. Core has no Node type definitions, so this is the
 * smallest shape a Node `Readable` already satisfies (it is async-iterable and has `destroy`), instead of importing
 * `node:stream` types.
 */
export interface MediaReadable extends AsyncIterable<Uint8Array> {
  /** Stops reading and releases the file handle (the client went away). */
  destroy(error?: Error): void;
}

export interface MediaStoragePort {
  /**
   * Moves a finished, validated local file at `sourcePath` to its final place under `key`. Atomic, and never overwrites:
   * an existing key is an error. `contentType` is the type the server chose from the sniffed bytes.
   */
  put(key: MediaKey, sourcePath: string, contentType: AllowedContentType): Promise<void>;
  /** A readable stream and the size, or `undefined` when the key is absent. Only the read route uses it. */
  open(key: MediaKey): Promise<{ stream: MediaReadable; byteSize: number } | undefined>;
  /** Idempotent: an absent key is success. */
  delete(key: MediaKey): Promise<void>;
}
