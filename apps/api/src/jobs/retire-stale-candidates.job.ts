import { sql } from "drizzle-orm";
import type { Database } from "../database/database.module.js";
import { IntegrationsRepository } from "../integrations/integrations.repository.js";
import { AdminAuditWriter } from "../privacy/audit/admin-audit.writer.js";
import type { JobBudget } from "./job-budget.js";

export const STALE_CANDIDATE_DAYS = 90;
export const STALE_CANDIDATE_LIMIT = 100;

/** No provider access. Each candidate gets a short transaction in the lifecycle writers' lock order. */
export async function retireStaleCandidates(
  deps: { database: Database },
  now: Date,
  options: { budget?: JobBudget } = {},
): Promise<{ scanned: number; retired: number; truncated: boolean }> {
  const { database } = deps;
  const repository = new IntegrationsRepository(database);
  const audit = new AdminAuditWriter();
  const cutoff = new Date(now.getTime() - STALE_CANDIDATE_DAYS * 86400000);
  const candidates = await database.execute<{ id: string; integrationId: string }>(sql`
    select id, integration_id as "integrationId" from integration_credential_version
    where state = 'candidate' and created_at < ${cutoff}
    order by created_at, id limit ${STALE_CANDIDATE_LIMIT}`);
  let retired = 0,
    scanned = 0;
  for (const candidate of candidates.rows) {
    if (options.budget?.exhausted()) break;
    const didRetire = await database.transaction(async (transaction) => {
      await transaction.execute(sql`set local lock_timeout = '2s'`);
      await transaction.execute(sql`set local statement_timeout = '5s'`);
      // Owner mutations lock the revision before integration, then version. Preserve that order.
      await transaction.execute(sql`select id from integration_revision where id=1 for update`);
      const owner = await transaction.execute<{ kind: string; provider: string }>(sql`
        select kind, provider_code as provider from integration where id=${candidate.integrationId}::uuid for update skip locked`);
      const integration = owner.rows[0];
      if (integration === undefined) return false;
      const version = await repository.findVersionForUpdate(transaction, candidate.id);
      if (version?.state !== "candidate" || version.createdAt >= cutoff) return false;
      if (await repository.isVersionReferenced(transaction, version.id)) return false;
      await repository.retire(transaction, version.id, now);
      const revision = await repository.currentRevision(transaction);
      if ((await repository.advanceRevision(transaction, revision, now)) === undefined)
        throw new Error("integration_revision_stale");
      await audit.record(transaction, null, {
        action: "integration.secret_retired",
        targetKind: "integration",
        targetId: candidate.integrationId,
        detail: {
          kind: integration.kind,
          provider: integration.provider,
          purpose: version.purpose,
          generation: version.generation,
          version: version.id,
          reason: "stale_candidate",
        },
      });
      return true;
    });
    scanned++;
    if (didRetire) retired++;
  }
  return {
    scanned,
    retired,
    truncated: scanned < candidates.rows.length || candidates.rows.length === STALE_CANDIDATE_LIMIT,
  };
}
