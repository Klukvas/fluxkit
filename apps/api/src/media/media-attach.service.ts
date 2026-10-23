import { Inject, Injectable } from "@nestjs/common";
import type { MediaKey } from "@fluxkit/core";
import { validationFailed, type FieldError } from "../common/problem.js";
import type { DbExecutor } from "../common/transaction.js";
import { MEDIA_CONFIG, type MediaConfig } from "./media-config.js";
import { classifyMediaUrl } from "./media-url.js";
import { MediaUploadRepository } from "./media-upload.repository.js";

/** A URL of a save and the request field it came from (`media.3.url`, `logoUrl`). */
export interface MediaReference {
  readonly path: string;
  readonly url: string;
}

/**
 * Attach marking (ADR 0028 decision 5), called by the product media and brand saves inside THEIR transaction: every URL
 * under `MEDIA_PUBLIC_BASE_URL` must name an existing upload, else the save fails with `400 validation_failed`,
 * `upload_not_found` at the URL's field (and rolls back); the uploads it names get `first_attached_at` where it is null.
 * URLs on other prefixes are not looked at. Without a public base URL (driver `none` and none configured) nothing is ours.
 */
@Injectable()
export class MediaAttachService {
  constructor(
    @Inject(MEDIA_CONFIG) private readonly config: MediaConfig,
    private readonly uploads: MediaUploadRepository,
  ) {}

  async markAttached(db: DbExecutor, references: readonly MediaReference[]): Promise<void> {
    const base = this.config.publicBaseUrl;
    if (base === undefined) {
      return;
    }
    const wanted: { path: string; key: MediaKey | undefined }[] = [];
    for (const reference of references) {
      const classified = classifyMediaUrl(reference.url, base);
      if (classified.kind === "upload") {
        wanted.push({ path: reference.path, key: classified.key });
      } else if (classified.kind === "invalid") {
        wanted.push({ path: reference.path, key: undefined });
      }
    }
    if (wanted.length === 0) {
      return;
    }
    const keys = [...new Set(wanted.flatMap(({ key }) => (key === undefined ? [] : [key])))];
    const found = await this.uploads.markAttached(db, keys);
    const errors: FieldError[] = wanted
      .filter(({ key }) => key === undefined || !found.has(key))
      .map(({ path }) => ({
        path,
        code: "upload_not_found",
        message: "This media URL names no uploaded file.",
      }));
    if (errors.length > 0) {
      throw validationFailed(errors);
    }
  }
}
