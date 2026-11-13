/*
 * The media port of feature packages (ADR 0049, contract `docs/contracts/features.md`). Types only: `apps/api` implements it
 * over its `media_upload` table and provides it under `MEDIA_PORT` of `@fluxkit/api-kit`, so a feature references uploads
 * by id without ever reading that table.
 */

/** An upload id a save references and the request field it came from (`coverUploadId`, `images.1.uploadId`). */
export interface MediaUploadReference {
  readonly path: string;
  readonly id: string;
}

/** What a page needs to show an upload: its public URL and its pixel size. */
export interface MediaUploadDescription {
  readonly id: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export interface MediaPort {
  /**
   * Marks the uploads as attached INSIDE the caller's transaction (the `tx` of `db.transaction(...)` on the database the API
   * provides as `FEATURE_DATABASE`), so a rolled-back save leaves them unattached and the cleanup job may delete them.
   * Every id must name an existing upload, else it throws the API's `400 validation_failed` problem with
   * `upload_not_found` at the reference's `path` (and the caller's transaction rolls back).
   */
  markAttachedByIds(
    transaction: unknown,
    references: readonly MediaUploadReference[],
  ): Promise<void>;

  /**
   * The uploads named by `ids`, in the order of `ids`, each once. An id that names no upload (deleted, never existed, or
   * not a UUID) is left out; the caller decides what a missing picture means.
   */
  describeUploads(ids: readonly string[]): Promise<readonly MediaUploadDescription[]>;
}
