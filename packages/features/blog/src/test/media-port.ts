import { ProblemException, type FieldError } from "@fluxkit/api-kit";
import type { MediaPort, MediaUploadDescription, MediaUploadReference } from "@fluxkit/core";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Executor = Pick<NodePgDatabase, "execute">;

function isExecutor(value: unknown): value is Executor {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { execute?: unknown }).execute === "function"
  );
}

/**
 * TEST ONLY: the `MediaPort` contract of core (docs/contracts/README.md, "Feature extension points") over the scratch
 * database's `media_upload` table, standing in for the API's implementation (`apps/api/src/media/media-port.service.ts`),
 * which a feature package cannot import. Same observable rules: attach inside the caller's transaction, `400
 * validation_failed` with `upload_not_found` at each missing reference's path, describe in the order of the ids, unknown
 * ids left out.
 */
export class TestMediaPort implements MediaPort {
  constructor(
    private readonly db: NodePgDatabase,
    private readonly publicBaseUrl: string,
  ) {}

  async markAttachedByIds(
    transaction: unknown,
    references: readonly MediaUploadReference[],
  ): Promise<void> {
    if (references.length === 0) return;
    if (!isExecutor(transaction)) {
      throw new Error("markAttachedByIds needs the caller's Drizzle transaction.");
    }
    const ids = [...new Set(references.map(({ id }) => id.toLowerCase()))];
    const result = await transaction.execute<{ id: string }>(
      sql`update media_upload set first_attached_at = coalesce(first_attached_at, now())
           where id = any(${sql.param(ids)}::uuid[]) returning id`,
    );
    const found = new Set(result.rows.map((row) => row.id));
    const errors: FieldError[] = references
      .filter(({ id }) => !found.has(id.toLowerCase()))
      .map(({ path }) => ({
        path,
        code: "upload_not_found",
        message: "This id names no uploaded file.",
      }));
    if (errors.length > 0) {
      throw new ProblemException({
        code: "validation_failed",
        detail: "The request is not valid.",
        errors,
      });
    }
  }

  async describeUploads(ids: readonly string[]): Promise<readonly MediaUploadDescription[]> {
    const wanted = [...new Set(ids.map((id) => id.toLowerCase()))].filter((id) => UUID.test(id));
    if (wanted.length === 0) return [];
    const result = await this.db.execute<{
      id: string;
      storage_key: string;
      width: number;
      height: number;
    }>(
      sql`select id, storage_key, width, height from media_upload where id = any(${sql.param(wanted)}::uuid[])`,
    );
    const rows = new Map(result.rows.map((row) => [row.id, row]));
    return wanted.flatMap((id) => {
      const row = rows.get(id);
      return row === undefined
        ? []
        : [
            {
              id: row.id,
              url: `${this.publicBaseUrl}/${row.storage_key}`,
              width: row.width,
              height: row.height,
            },
          ];
    });
  }
}
