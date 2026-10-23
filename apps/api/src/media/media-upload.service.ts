import { createHash, randomBytes } from "node:crypto";
import { unlink, type FileHandle } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  contentTypeOf,
  generateMediaKey,
  MEDIA_LIMITS,
  MEDIA_STORAGE_PORT,
  type MediaKey,
} from "@fluxkit/core";
import type { AdminPrincipal } from "../auth/admin-authenticator.js";
import { ProblemException } from "../common/problem.js";
import { processImageFile } from "./image-pipeline.js";
import type { UploadStorage } from "./local-media-storage.js";
import { MEDIA_CONFIG, type MediaConfig } from "./media-config.js";
import {
  isStorageUnavailableError,
  mediaRefused,
  storageUnavailable,
  uploadInterrupted,
  uploadsBusy,
  uploadsDisabled,
} from "./media-problems.js";
import type { MediaUploadResponse } from "./media.schemas.js";
import { MediaUploadRepository } from "./media-upload.repository.js";
import { ProcessingSlots } from "./processing-slots.js";
import { checkUploadLength, readBodyToFile, UploadInterruptedError } from "./upload-body.js";

/** The request as the upload needs it: its head and its body stream. */
export interface UploadRequest extends AsyncIterable<Uint8Array> {
  readonly headers: IncomingHttpHeaders;
}

/** What the controller must do with the connection after an early refusal (see `upload`). */
export interface UploadResponseControl {
  /** Asks Node to close the connection after the answer instead of reading an unread body to its end. */
  closeConnection(): void;
}

function codeOf(error: unknown): string {
  const code: unknown = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "unknown";
}

/**
 * The upload flow (ADR 0028 decisions 3 and 7). Authentication, the permission, the CSRF rule and the rate limit already
 * ran (guards). Order: switched off? -> length rules from the head -> body streamed into a temp file with a counter ->
 * a processing slot -> gate, decode, re-encode -> output temp file (fsync) -> random key -> atomic no-overwrite move ->
 * row insert (the file is removed again if the insert fails) -> one log line. Temp files are removed in every case.
 */
@Injectable()
export class MediaUploadService {
  private readonly logger = new Logger("MediaUpload");

  constructor(
    @Inject(MEDIA_CONFIG) private readonly config: MediaConfig,
    @Inject(MEDIA_STORAGE_PORT) private readonly storage: UploadStorage,
    @Inject(ProcessingSlots) private readonly slots: ProcessingSlots,
    @Inject(MediaUploadRepository) private readonly uploads: MediaUploadRepository,
  ) {}

  async upload(
    request: UploadRequest,
    admin: AdminPrincipal,
    connection: UploadResponseControl,
  ): Promise<MediaUploadResponse> {
    const startedAt = Date.now();
    if (this.config.driver === "none") {
      connection.closeConnection();
      throw uploadsDisabled();
    }
    try {
      checkUploadLength(request.headers, this.config.maxBytes);
    } catch (error) {
      connection.closeConnection();
      throw error;
    }
    const temps: string[] = [];
    try {
      const input = await this.writeTemp(temps, async (file) => {
        try {
          return await readBodyToFile(request, file, this.config.maxBytes);
        } catch (error) {
          if (error instanceof UploadInterruptedError) {
            throw uploadInterrupted();
          }
          if (error instanceof ProblemException) {
            connection.closeConnection();
          }
          throw error;
        }
      });
      if (input.bytes === 0) {
        throw mediaRefused("empty_file");
      }
      const release = await this.slots.acquire();
      if (release === undefined) {
        throw uploadsBusy(this.config.tuning.busyRetryAfterSeconds);
      }
      let result;
      try {
        result = await processImageFile(
          input.path,
          {
            maxPixels: this.config.maxPixels,
            maxSide: MEDIA_LIMITS.maxSide,
            outputMaxSide: MEDIA_LIMITS.outputMaxSide,
          },
          this.config.tuning.processingBudgetMs,
        );
      } finally {
        release();
      }
      if (!result.ok) {
        throw mediaRefused(result.reason);
      }
      const { image } = result;
      const output = await this.writeTemp(temps, async (file) => {
        await file.writeFile(image.data);
        await file.sync();
        return image.data.length;
      });
      const contentType = contentTypeOf(image.type);
      const key = generateMediaKey((size) => randomBytes(size), image.type);
      await this.storeFile(key, output.path, contentType);
      const row = await this.insertOrRemove(key, {
        storageKey: key,
        contentType,
        byteSize: image.data.length,
        width: image.width,
        height: image.height,
        sha256: createHash("sha256").update(image.data).digest("hex"),
        createdBy: admin.userId,
      });
      // Ids and numbers only: never bytes, a file name or a client-supplied header value.
      this.logger.log(
        `Stored upload id=${row.id} admin=${admin.userId} type=${image.type} bytesIn=${input.bytes} bytesOut=${image.data.length} width=${image.width} height=${image.height} durationMs=${Date.now() - startedAt}`,
      );
      return {
        id: row.id,
        url: `${this.config.publicBaseUrl ?? ""}/${key}`,
        contentType,
        byteSize: row.byteSize,
        width: row.width,
        height: row.height,
        createdAt: row.createdAt.toISOString(),
      };
    } finally {
      await Promise.all(temps.map((path) => this.removeTemp(path)));
    }
  }

  /** Creates a temp file (recorded for removal), lets `fill` write it, closes it. Storage failures answer `503`. */
  private async writeTemp(
    temps: string[],
    fill: (file: FileHandle) => Promise<number>,
  ): Promise<{ path: string; bytes: number }> {
    let temp;
    try {
      temp = await this.storage.createTempFile();
    } catch (error) {
      throw this.storageFailure(error);
    }
    temps.push(temp.path);
    try {
      return { path: temp.path, bytes: await fill(temp.handle) };
    } catch (error) {
      throw this.storageFailure(error);
    } finally {
      await temp.handle.close();
    }
  }

  private async storeFile(
    key: MediaKey,
    path: string,
    contentType: ReturnType<typeof contentTypeOf>,
  ): Promise<void> {
    try {
      await this.storage.put(key, path, contentType);
    } catch (error) {
      throw this.storageFailure(error);
    }
  }

  private async insertOrRemove(
    key: MediaKey,
    values: Parameters<MediaUploadRepository["insert"]>[0],
  ): ReturnType<MediaUploadRepository["insert"]> {
    try {
      return await this.uploads.insert(values);
    } catch (error) {
      // No row, no file: an unrecorded file would never be found by anyone (or by the cleanup job).
      await this.storage.delete(key);
      throw error;
    }
  }

  /** A disk-full or vanished-directory error becomes `503 storage_unavailable` (logged by code); anything else is rethrown. */
  private storageFailure(error: unknown): unknown {
    if (error instanceof ProblemException || !isStorageUnavailableError(error)) {
      return error;
    }
    this.logger.error(`Media storage failure code=${codeOf(error)}`);
    return storageUnavailable();
  }

  private async removeTemp(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      // Moved into place (put unlinks its source) or never created: nothing to remove.
      if (codeOf(error) !== "ENOENT") {
        this.logger.error(`Could not remove a media temp file code=${codeOf(error)}`);
      }
    }
  }
}
