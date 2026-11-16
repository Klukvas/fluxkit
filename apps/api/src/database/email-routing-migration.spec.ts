import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";

const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const when = 1794837706505;

describe("email routing migration 0018 (real disposable Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  beforeAll(async () => {
    await ensureMigrated([], { reset: true });
  });
  afterAll(async () => {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    await pool.end();
  });

  it("guards active routes, validates metadata, and runs up/down/up/down with the exact journal row", async () => {
    const down = await readFile(`${folder}/0018_email_provider_routing.down.sql`, "utf8");
    const id = randomUUID();
    await pool.query(
      `insert into email_message(id,template_key,template_version,locale,to_address,recipient_kind,variables,deadline_at,route_provider_code)
      values($1,'admin.test',1,'en','operator@example.net','admin','{}',now()+interval '1 hour','brevo')`,
      [id],
    );
    for (const status of ["pending", "sending"]) {
      await pool.query(
        "update email_message set status=$2,attempts=1,lease_until=now()+interval '1 minute' where id=$1",
        [id, status],
      );
      const client = await pool.connect();
      try {
        await expect(client.query(down)).rejects.toThrow(
          "email_provider_routing_rollback_incompatible",
        );
      } finally {
        // A failed explicit transaction must be rolled back on the same connection.
        await client.query("rollback");
        client.release();
      }
      expect(
        (await pool.query("select route_provider_code from email_message where id=$1", [id]))
          .rows[0]?.route_provider_code,
      ).toBe("brevo");
    }
    await expect(
      pool.query("update email_message set route_provider_code='bad code' where id=$1", [id]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        "insert into email_provider_state(provider_code,unavailable_until,reason,probe_token) values('resend',now(),'quota_exceeded',$1)",
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        "insert into email_provider_state(provider_code,unavailable_until,reason) values('resend',now(),'unavailable')",
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await pool.query("delete from email_message where id=$1", [id]);
    const index = (
      await pool.query(
        "select indexdef from pg_indexes where indexname='email_message_provider_sent_at_idx'",
      )
    ).rows[0]?.indexdef as string;
    expect(index).toContain("(provider_code, sent_at)");
    expect(index).toContain("status = 'sent'");
    for (let pass = 0; pass < 2; pass += 1) {
      await pool.query(down);
      expect(
        (await pool.query("select * from drizzle.__drizzle_migrations where created_at=$1", [when]))
          .rows,
      ).toEqual([]);
      expect(
        (await pool.query("select to_regclass('email_provider_state') name")).rows[0]?.name,
      ).toBeNull();
      expect(
        (
          await pool.query(
            "select * from drizzle.__drizzle_migrations where created_at=1794827031304",
          )
        ).rows,
      ).toHaveLength(1);
      await migrate(drizzle(pool), { migrationsFolder: folder });
      expect(
        (await pool.query("select * from drizzle.__drizzle_migrations where created_at=$1", [when]))
          .rows,
      ).toHaveLength(1);
    }
  });
});
