import { Inject, Injectable } from "@nestjs/common";
import type { MediaPort, MediaUploadDescription, MediaUploadReference } from "@fluxkit/core";
import type { DbExecutor } from "../common/transaction.js";
import { MediaAttachService } from "./media-attach.service.js";
import { MEDIA_CONFIG, type MediaConfig } from "./media-config.js";
import { MediaUploadRepository } from "./media-upload.repository.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A feature passes the transaction of the API's own Drizzle database (`FEATURE_DATABASE`). Core types it `unknown`, so it is
 * checked here: anything without the query builder is a programming error of the feature, never a silent no-op.
 */
function assertDbExecutor(value: unknown): asserts value is DbExecutor {
  const candidate = value as { update?: unknown; select?: unknown } | null;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof candidate.update !== "function" ||
    typeof candidate.select !== "function"
  ) {
    throw new TypeError(
      "MediaPort.markAttachedByIds needs the transaction of the FEATURE_DATABASE (the tx of db.transaction).",
    );
  }
}

/**
 * The `MEDIA_PORT` of feature packages (ADR 0049): the existing attach rule of ADR 0046 decision 4 and a read of the upload
 * rows a feature references, with URLs built like `POST /admin/media/uploads` builds them (ADR 0028).
 */
@Injectable()
export class MediaPortService implements MediaPort {
  constructor(
    @Inject(MEDIA_CONFIG) private readonly config: MediaConfig,
    private readonly attach: MediaAttachService,
    private readonly uploads: MediaUploadRepository,
  ) {}

  async markAttachedByIds(
    transaction: unknown,
    references: readonly MediaUploadReference[],
  ): Promise<void> {
    assertDbExecutor(transaction);
    await this.attach.markAttachedByIds(transaction, references);
  }

  async describeUploads(ids: readonly string[]): Promise<readonly MediaUploadDescription[]> {
    // Postgres returns a uuid in lower case; a malformed id names no upload (and would fail the uuid cast).
    const wanted = [...new Set(ids.map((id) => id.toLowerCase()))].filter((id) => UUID.test(id));
    if (wanted.length === 0) {
      return [];
    }
    const rows = new Map(
      (await this.uploads.describeByIds(wanted)).map((row) => [row.id, row] as const),
    );
    return wanted.flatMap((id) => {
      const row = rows.get(id);
      return row === undefined
        ? []
        : [
            {
              id: row.id,
              url: `${this.config.publicBaseUrl ?? ""}/${row.storageKey}`,
              width: row.width,
              height: row.height,
            },
          ];
    });
  }
}
