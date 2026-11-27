import type pg from "pg";
import { expect } from "vitest";

/**
 * Two real write transactions, explicitly interleaved: lifecycle holds the step-up admin lock, work reaches its
 * conflicting FK/early admin lock, then lifecycle takes integration/version locks. pg_blocking_pids is the barrier;
 * no sleeps or fabricated database answers. A shorter detector interval makes lifecycle expose the old inversion.
 */
export async function raceAdminRevocation<T>(
  pool: pg.Pool,
  adminId: string,
  integrationId: string,
  versionId: string,
  work: () => Promise<T>,
  action: "disable" | "revoke" = "revoke",
): Promise<{ revocationError: unknown; result: T }> {
  const lifecycle = await pool.connect();
  let pending: Promise<T> | undefined;
  let revocationError: unknown;
  try {
    await lifecycle.query("begin");
    await lifecycle.query("set local deadlock_timeout='50ms'");
    const pid = (await lifecycle.query<{ pid: number }>("select pg_backend_pid() pid")).rows[0]
      ?.pid;
    await lifecycle.query("select id from admin_user where id=$1 for update", [adminId]);
    pending = work();
    // Attach a rejection observer while the two transactions are deliberately suspended.
    void pending.catch(() => undefined);
    await expect
      .poll(
        async () => {
          const blocked = await pool.query<{ waiting: boolean }>(
            "select exists(select 1 from pg_stat_activity where $1::int=any(pg_blocking_pids(pid))) waiting",
            [pid],
          );
          return blocked.rows[0]?.waiting;
        },
        { timeout: 5000 },
      )
      .toBe(true);
    try {
      await lifecycle.query("select id from integration where id=$1 for update", [integrationId]);
      await lifecycle.query(
        "update integration_credential_version set state=$2,revoked_at=$3 where id=$1",
        [
          versionId,
          action === "revoke" ? "revoked" : "draining",
          action === "revoke" ? new Date() : null,
        ],
      );
      await lifecycle.query(
        "update integration set enabled=false,active_outbound_version_id=$2 where id=$1",
        [integrationId, action === "revoke" ? null : versionId],
      );
      await lifecycle.query("update integration_revision set revision=revision+1");
      await lifecycle.query("commit");
    } catch (error) {
      revocationError = error;
      await lifecycle.query("rollback");
    }
    return { revocationError, result: await pending };
  } finally {
    await lifecycle.query("rollback");
    lifecycle.release();
    if (pending !== undefined) await Promise.allSettled([pending]);
  }
}
