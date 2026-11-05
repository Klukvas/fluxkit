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
 * Attach marking (ADR 0028 decision 5), called by the product media, brand and banner saves inside THEIR transaction: every URL
 * under `MEDIA_PUBLIC_BASE_URL` must name an existing upload, else the save fails with `400 validation_failed`,
 * `upload_not_found` at the URL's field (and rolls back); the uploads it names get `first_attached_at` where it is null.
 * URLs on other prefixes are not looked at. Also with the driver `none` (step 9 review M-2): `loadEnv` keeps the prefix there
 * (the development default, or the given value), so a save made while uploads are off still marks the uploads it uses.
 * Without a public base URL (`none` in production with none configured) nothing is ours.
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

  /**
   * Attach marking for uploads referenced by id, not by URL (banner pictures, ADR 0046), with the semantics of
   * `markAttached`: called inside the save's transaction, every id must name an existing upload, else the save fails with
   * `400 validation_failed`, `upload_not_found` at the reference's field; the uploads get `first_attached_at` where it is
   * null, under the row locks of one `UPDATE`. An id is unambiguous, so unlike a URL it is checked whatever
   * `MEDIA_PUBLIC_BASE_URL` and the driver are. Ids must be well-formed UUIDs (the request schema checks them).
   */
  async markAttachedByIds(db: DbExecutor, references: readonly MediaIdReference[]): Promise<void> {
    if (references.length === 0) {
      return;
    }
    // Postgres returns a uuid in lower case; a request may spell it in upper case.
    const found = await this.uploads.markAttachedByIds(db, [
      ...new Set(references.map(({ id }) => id.toLowerCase())),
    ]);
    const errors: FieldError[] = references
      .filter(({ id }) => !found.has(id.toLowerCase()))
      .map(({ path }) => ({
        path,
        code: "upload_not_found",
        message: "This id names no uploaded file.",
      }));
    if (errors.length > 0) {
      throw validationFailed(errors);
    }
  }
}

/** An upload id of a save and the request field it came from (`imageUploadId`, `images.1.imageUploadId`). */
export interface MediaIdReference {
  readonly path: string;
  readonly id: string;
}
