import { randomUUID } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../database/schema/index.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import { retireStaleCandidates } from "./retire-stale-candidates.job.js";

const NOW = new Date("2025-01-01T00:00:00Z");
const OLD = new Date("2024-01-01T00:00:00Z");
describe("stale candidate cleanup (real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const database = drizzle(pool, { schema });
  beforeEach(() => ensureMigrated([], { reset: true }));
  afterAll(() => pool.end());
  async function version(state = "candidate", createdAt = OLD) {
    const id = randomUUID(),
      integrationId = randomUUID();
    await pool.query("insert into integration(id,kind,provider_code) values($1,'email',$2)", [
      integrationId,
      `p${id.replaceAll("-", "")}`,
    ]);
    await pool.query(
      "insert into integration_credential_version(id,integration_id,purpose,generation,state,created_at,revoked_at) values($1,$2,'outbound',7,$3,$4,$5)",
      [id, integrationId, state, createdAt, state === "revoked" ? NOW : null],
    );
    await pool.query(
      "insert into integration_secret(id,version_id,field,key_id,nonce,ciphertext,tag) values($1,$2,'api_key','test',$3,$4,$5)",
      [randomUUID(), id, Buffer.alloc(12), Buffer.from("encrypted-fixture"), Buffer.alloc(16)],
    );
    return { id, integrationId };
  }
  it("retires only candidates strictly older than 90 days; keeps tombstones, audits system reason and advances revision", async () => {
    const old = await version();
    const recent = await version("candidate", NOW);
    const edge = await version("candidate", new Date(NOW.getTime() - 90 * 86400000));
    const active = await version("active"),
      draining = await version("draining"),
      revoked = await version("revoked");
    expect(await retireStaleCandidates({ database }, NOW)).toMatchObject({ retired: 1 });
    const rows = await pool.query(
      "select id,state,generation from integration_credential_version order by id",
    );
    expect(rows.rows).toEqual(
      [old, recent, edge, active, draining, revoked]
        .map((v) => ({
          id: v.id,
          state:
            v === old
              ? "retired"
              : v === active
                ? "active"
                : v === draining
                  ? "draining"
                  : v === revoked
                    ? "revoked"
                    : "candidate",
          generation: 7,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(
      (await pool.query("select 1 from integration_secret where version_id=$1", [old.id])).rows,
    ).toEqual([]);
    expect(
      (
        await pool.query(
          "select admin_user_id,detail from admin_audit_event where action='integration.secret_retired'",
        )
      ).rows,
    ).toEqual([
      {
        admin_user_id: null,
        detail: expect.objectContaining({ version: old.id, reason: "stale_candidate" }),
      },
    ]);
    expect((await pool.query("select revision::int from integration_revision")).rows).toEqual([
      { revision: 1 },
    ]);
  });
  it("keeps even an incorrectly bound candidate", async () => {
    const bound = await version();
    await pool.query(
      "insert into email_message(template_key,template_version,locale,to_address,recipient_kind,variables,deadline_at,integration_credential_version_id) values('test.message',1,'uk','fixture@example.com','admin','{}',now()+interval '1 hour',$1)",
      [bound.id],
    );
    expect(await retireStaleCandidates({ database }, NOW)).toMatchObject({ retired: 0 });
    expect(
      (await pool.query("select state from integration_credential_version where id=$1", [bound.id]))
        .rows,
    ).toEqual([{ state: "candidate" }]);
    expect(
      (await pool.query("select 1 from integration_secret where version_id=$1", [bound.id])).rows,
    ).toHaveLength(1);
  });
  it("scans at most 100 per run and resumes on the next tick", async () => {
    for (let n = 0; n < 101; n++) await version();
    expect(await retireStaleCandidates({ database }, NOW)).toEqual({
      scanned: 100,
      retired: 100,
      truncated: true,
    });
    expect(await retireStaleCandidates({ database }, NOW)).toEqual({
      scanned: 1,
      retired: 1,
      truncated: false,
    });
  });
  it("concurrent activation wins before cleanup's state re-check", async () => {
    const candidate = await version();
    const activation = await pool.connect();
    let pending: ReturnType<typeof retireStaleCandidates> | undefined;
    try {
      await activation.query("begin");
      await activation.query("select id from integration_revision where id=1 for update");
      await activation.query("select id from integration where id=$1 for update", [
        candidate.integrationId,
      ]);
      const pid = (await activation.query<{ pid: number }>("select pg_backend_pid() pid")).rows[0]
        ?.pid;
      pending = retireStaleCandidates({ database }, NOW);
      void pending.catch(() => undefined);
      await expect
        .poll(
          async () =>
            (
              await pool.query<{ waiting: boolean }>(
                "select exists(select 1 from pg_stat_activity where $1::int=any(pg_blocking_pids(pid))) waiting",
                [pid],
              )
            ).rows[0]?.waiting,
        )
        .toBe(true);
      await activation.query(
        "update integration_credential_version set state='active' where id=$1",
        [candidate.id],
      );
      await activation.query(
        "update integration set enabled=true,active_outbound_version_id=$2 where id=$1",
        [candidate.integrationId, candidate.id],
      );
      await activation.query("update integration_revision set revision=revision+1");
      await activation.query("commit");
      expect(await pending).toMatchObject({ retired: 0 });
      expect(
        (
          await pool.query("select state from integration_credential_version where id=$1", [
            candidate.id,
          ])
        ).rows,
      ).toEqual([{ state: "active" }]);
      expect(
        (await pool.query("select 1 from integration_secret where version_id=$1", [candidate.id]))
          .rows,
      ).toHaveLength(1);
    } finally {
      await activation.query("rollback");
      activation.release();
      if (pending !== undefined) await Promise.allSettled([pending]);
    }
  });
});
