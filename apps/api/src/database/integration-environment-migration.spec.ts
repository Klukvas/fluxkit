import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";

const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));
describe("credential environment and immutable lifecycle migration 0022 (real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let generation = 0;
  let integrationId: string;
  beforeAll(async () => {
    await ensureMigrated([], { reset: true });
    integrationId = randomUUID();
    await pool.query(
      "insert into integration(id, kind, provider_code) values($1, 'payment', 'bundle')",
      [integrationId],
    );
  });
  afterAll(async () => {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    await pool.end();
  });
  async function version(state = "candidate") {
    generation += 1;
    const id = randomUUID();
    await pool.query(
      `insert into integration_credential_version(id,integration_id,generation,purpose,state,retired_at,revoked_at) values($1,$2,$3,'outbound',$4,case when $4='retired' then now() end,case when $4='revoked' then now() end)`,
      [id, integrationId, generation, state],
    );
    return id;
  }
  it("refuses changes to a version's identity", async () => {
    const id = await version();
    await expect(
      pool.query("update integration_credential_version set purpose='webhook' where id=$1", [id]),
    ).rejects.toThrow(/integration_credential_identity_immutable/);
    await expect(
      pool.query(
        "update integration_credential_version set generation=generation+100 where id=$1",
        [id],
      ),
    ).rejects.toThrow(/integration_credential_identity_immutable/);
    await pool.query(
      "update integration_credential_version set state='retired',retired_at=now() where id=$1",
      [id],
    );
  });
  it("allows only the declared transitions and terminal states never return", async () => {
    const id = await version();
    await expect(
      pool.query("update integration_credential_version set state='draining' where id=$1", [id]),
    ).rejects.toThrow(/integration_credential_transition_invalid/);
    await pool.query("update integration_credential_version set state='active' where id=$1", [id]);
    await pool.query("update integration_credential_version set state='draining' where id=$1", [
      id,
    ]);
    await pool.query("update integration_credential_version set state='active' where id=$1", [id]);
    await pool.query(
      "update integration_credential_version set state='revoked',revoked_at=now() where id=$1",
      [id],
    );
    await expect(
      pool.query(
        "update integration_credential_version set state='active',revoked_at=null where id=$1",
        [id],
      ),
    ).rejects.toThrow(/integration_credential_transition_invalid/);
    const retired = await version("retired");
    await expect(
      pool.query(
        "update integration_credential_version set state='candidate',retired_at=null where id=$1",
        [retired],
      ),
    ).rejects.toThrow(/integration_credential_transition_invalid/);
  });
  it("bounds environment codes and refuses identity changes", async () => {
    const id = await version();
    expect(
      (await pool.query("select environment from integration_credential_version where id=$1", [id]))
        .rows,
    ).toEqual([{ environment: "default" }]);
    await expect(
      pool.query("update integration_credential_version set environment='sandbox' where id=$1", [
        id,
      ]),
    ).rejects.toThrow(/integration_credential_identity_immutable/);
    await expect(
      pool.query(
        "insert into integration_credential_version(id,integration_id,generation,purpose,state,environment) values($1,$2,1000,'webhook','candidate','Bad')",
        [randomUUID(), integrationId],
      ),
    ).rejects.toThrow(/integration_credential_version_environment_check/);
    await pool.query(
      "update integration_credential_version set state='retired',retired_at=now() where id=$1",
      [id],
    );
  });
  it("does not alter email_message in either direction", async () => {
    for (const suffix of ["sql", "down.sql"]) {
      const script = await readFile(
        `${folder}/0022_integration_credential_environment.${suffix}`,
        "utf8",
      );
      expect(script).not.toContain("email_message");
    }
  });
  it("refuses rollback while a multi-field default-environment bundle exists", async () => {
    const id = await version();
    for (const field of ["public_key", "private_key"]) {
      await pool.query(
        "insert into integration_secret(id,version_id,field,key_id,nonce,ciphertext,tag) values($1,$2,$3,'test',decode(repeat('00',12),'hex'),decode('00','hex'),decode(repeat('00',16),'hex'))",
        [randomUUID(), id, field],
      );
    }
    const down = await readFile(
      `${folder}/0022_integration_credential_environment.down.sql`,
      "utf8",
    );
    const client = await pool.connect();
    try {
      await expect(client.query(down)).rejects.toThrow(
        "integration_environment_rollback_incompatible",
      );
    } finally {
      await client.query("rollback");
      client.release();
      await pool.query("delete from integration_secret where version_id=$1", [id]);
    }
    expect(
      (await pool.query("select environment from integration_credential_version where id=$1", [id]))
        .rows,
    ).toEqual([{ environment: "default" }]);
  });
  it("runs up, down, up, down and preserves non-default generations", async () => {
    const down = await readFile(
      `${folder}/0022_integration_credential_environment.down.sql`,
      "utf8",
    );
    const journal = JSON.parse(await readFile(`${folder}/meta/_journal.json`, "utf8")) as {
      entries: { tag: string; when: number }[];
    };
    const when = journal.entries.find(
      (entry) => entry.tag === "0022_integration_credential_environment",
    )?.when;
    const id = randomUUID();
    await pool.query(
      "insert into integration_credential_version(id,integration_id,generation,purpose,state,environment) values($1,$2,1001,'webhook','candidate','sandbox')",
      [id, integrationId],
    );
    const client = await pool.connect();
    try {
      await expect(client.query(down)).rejects.toThrow(
        "integration_environment_rollback_incompatible",
      );
    } finally {
      await client.query("rollback");
      client.release();
    }
    await pool.query("delete from integration_credential_version where id=$1", [id]);
    for (let pass = 0; pass < 2; pass += 1) {
      await pool.query(down);
      expect(
        (await pool.query("select 1 from drizzle.__drizzle_migrations where created_at=$1", [when]))
          .rows,
      ).toEqual([]);
      expect(
        (
          await pool.query(
            "select column_name from information_schema.columns where table_name='integration_credential_version' and column_name='environment'",
          )
        ).rows,
      ).toEqual([]);
      await migrate(drizzle(pool), { migrationsFolder: folder });
      expect(
        (await pool.query("select environment from integration_credential_version limit 1")).rows,
      ).toEqual([{ environment: "default" }]);
    }
  });
});
