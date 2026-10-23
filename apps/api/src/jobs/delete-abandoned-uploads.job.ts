import { Logger } from "@nestjs/common";
import type { MediaKey, MediaStoragePort } from "@fluxkit/core";
import { errorCode, innermostCause } from "../common/error-summary.js";
import { withJobTransaction } from "../common/job-limits.js";
import type { Database } from "../database/database.module.js";
import type { MediaConfig } from "../media/media-config.js";
import { drainInBatches, type BatchLimits, type CleanupResult } from "./batches.js";
import type { JobBudget } from "./job-budget.js";
import type { JobsRepository } from "./jobs.repository.js";

/** An upload that was never attached is abandoned once it is STRICTLY older than this (ADR 0028 decision 7). */
export const ABANDONED_UPLOAD_AGE_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

/** Pages of 100 rows, at most 50 pages (5000 uploads) per run; what is left waits for the next tick. */
export const ABANDONED_UPLOAD_LIMITS: Readonly<BatchLimits> = Object.freeze({
  batchSize: 100,
  maxBatches: 50,
});

export interface AbandonedUploadsResult extends CleanupResult {
  /** Rows were deleted but their file could not be: the file stays on disk and is logged by key and error code. */
  fileErrors: number;
}

export interface AbandonedUploadsDeps {
  database: Database;
  repository: Pick<JobsRepository, "lockAbandonedUploadIds" | "deleteAbandonedUploadsByIds">;
  storage: Pick<MediaStoragePort, "delete">;
  config: Pick<MediaConfig, "driver">;
}

const logger = new Logger("Jobs");

/**
 * Deletes uploads that were never attached within 24 hours, row first, file second (ADR 0028 decision 7). Each page is
 * ONE transaction that locks the page (skipping rows a save is attaching right now) and deletes it with the unattached
 * and age conditions repeated; the files are deleted only AFTER that transaction committed, so a save that attaches an
 * upload either committed first (the row stays, so does the file) or finds the row gone and answers `upload_not_found`.
 * A file is never touched for a row that is still there.
 *
 * A file that cannot be deleted (anything but "already absent", which the port treats as success) is logged with its
 * key and error code and left: its row is gone, so nothing links to it, and one bad file never stops the run. With
 * `MEDIA_STORAGE_DRIVER=none` there is no storage to clean, so no row is deleted either: a row without its file deleted
 * would be an untracked file the day the driver is switched back on.
 */
export async function deleteAbandonedUploads(
  deps: AbandonedUploadsDeps,
  now: Date,
  limits: BatchLimits = ABANDONED_UPLOAD_LIMITS,
  budget?: JobBudget,
): Promise<AbandonedUploadsResult> {
  if (deps.config.driver === "none") {
    return { deleted: 0, truncated: false, fileErrors: 0 };
  }
  const cutoff = new Date(now.getTime() - ABANDONED_UPLOAD_AGE_HOURS * HOUR_MS);
  let fileErrors = 0;
  const drained = await drainInBatches(
    async (batchSize) => {
      const keys = await withJobTransaction(deps.database, async (tx) => {
        const ids = await deps.repository.lockAbandonedUploadIds(tx, cutoff, batchSize);
        return deps.repository.deleteAbandonedUploadsByIds(tx, ids, cutoff);
      });
      // The transaction is committed here: only now may a file go.
      for (const key of keys) {
        if (!(await deleteFile(deps.storage, key))) {
          fileErrors += 1;
        }
      }
      return keys.length;
    },
    limits,
    budget,
  );
  return { deleted: drained.total, truncated: drained.truncated, fileErrors };
}

/** Whether the file is gone. A failure is logged by key and error code only (a message can hold a server path). */
async function deleteFile(
  storage: Pick<MediaStoragePort, "delete">,
  key: string,
): Promise<boolean> {
  try {
    await storage.delete(key as MediaKey);
    return true;
  } catch (error) {
    logger.error(
      `Job delete-abandoned-uploads: file ${key} left on disk (${describeFileError(error)})`,
    );
    return false;
  }
}

function describeFileError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "non-error value";
  }
  const innermost = innermostCause(error);
  return errorCode(innermost) ?? innermost.name;
}
