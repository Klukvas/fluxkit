import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startApp } from "../test/app.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import { SecretCipher, type SecretBinding } from "./secret-cipher.js";
import { DISABLED_INTEGRATIONS_CONFIG } from "./integrations.config.js";
import { MerchantBaselineCipher } from "./merchant-baseline-cipher.js";
import { rewrapEnvelope, rewrapEnvelopes } from "./rewrap-envelopes.js";
import { REWRAP_LOCK_KEY, runRewrapCommand } from "./rewrap-command.js";

const oldKey = { id: "old", bytes: randomBytes(32) };
const newKey = { id: "new", bytes: randomBytes(32) };
const ring = { current: newKey, previous: oldKey };
const oldCipher = new SecretCipher({ current: oldKey, previous: null });
const newCipher = new SecretCipher({ current: newKey, previous: null });
const url = requireTestDatabaseUrl();
const env = {
  DATABASE_URL: url,
  SECRETS_ENCRYPTION_KEY: `${newKey.id}:${newKey.bytes.toString("base64")}`,
  SECRETS_ENCRYPTION_KEY_PREVIOUS: `${oldKey.id}:${oldKey.bytes.toString("base64")}`,
};

describe("operator rewrap command (real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: url });
  beforeAll(() => ensureMigrated());
  beforeEach(() => ensureMigrated([], { reset: true }));
  afterAll(() => pool.end());

  async function secret(state = "candidate"): Promise<SecretBinding> {
    const integrationId = randomUUID(),
      versionId = randomUUID(),
      secretId = randomUUID();
    await pool.query("insert into integration(id,kind,provider_code) values($1,'email',$2)", [
      integrationId,
      `p${integrationId.replaceAll("-", "")}`,
    ]);
    await pool.query(
      "insert into integration_credential_version(id,integration_id,purpose,generation,state,revoked_at) values($1,$2,'outbound',1,$3,$4)",
      [versionId, integrationId, state, state === "revoked" ? new Date() : null],
    );
    const binding: SecretBinding = {
      secretId,
      integrationId,
      kind: "email",
      providerCode: `p${integrationId.replaceAll("-", "")}`,
      field: "api_key",
      generation: 1,
    };
    const sealed = oldCipher.seal(binding, "credential-fixture");
    await pool.query(
      "insert into integration_secret(id,version_id,field,key_id,nonce,ciphertext,tag) values($1,$2,'api_key',$3,$4,$5,$6)",
      [secretId, versionId, sealed.keyId, sealed.nonce, sealed.ciphertext, sealed.tag],
    );
    return binding;
  }
  async function envelope(id: string) {
    const result = await pool.query<{
      keyId: string;
      nonce: Buffer;
      ciphertext: Buffer;
      tag: Buffer;
    }>(`select key_id as "keyId", nonce, ciphertext, tag from integration_secret where id=$1`, [
      id,
    ]);
    const row = result.rows[0];
    if (row === undefined) throw new Error("fixture_missing");
    return row;
  }

  it("rewraps every state including revoked under fresh AAD/nonces, retaining version metadata; rerun is a no-op", async () => {
    const bindings = await Promise.all(["candidate", "active", "draining", "revoked"].map(secret));
    const before = await pool.query("select * from integration_credential_version order by id");
    const envelopes = await Promise.all(bindings.map((b) => envelope(b.secretId)));
    const result = await runRewrapCommand([], env);
    expect(result.exitCode).toBe(0);
    expect(result.tables.integration_secret).toMatchObject({
      rewrapped: 4,
      alreadyCurrent: 0,
      failed: 0,
      remainingPrevious: 0,
    });
    for (const [index, binding] of bindings.entries()) {
      const sealed = await envelope(binding.secretId);
      expect(sealed.nonce).not.toEqual(envelopes[index]?.nonce);
      expect(newCipher.open(binding, sealed)).toBe("credential-fixture");
    }
    expect(
      (await pool.query("select * from integration_credential_version order by id")).rows,
    ).toEqual(before.rows);
    const running = await startApp({ secretsKeyRing: { current: newKey, previous: null } });
    try {
      const apiCipher = running.app.get(SecretCipher);
      for (const binding of bindings)
        expect(apiCipher.open(binding, await envelope(binding.secretId))).toBe(
          "credential-fixture",
        );
    } finally {
      await running.app.close();
    }
    expect((await runRewrapCommand([], env)).tables.integration_secret).toMatchObject({
      rewrapped: 0,
      alreadyCurrent: 4,
      failed: 0,
    });
  });
  it("rewraps permanent baselines, proving the exact identity survives", async () => {
    const integrationId = randomUUID(),
      id = randomUUID();
    await pool.query(
      "insert into integration(id,kind,provider_code) values($1,'payment','testpay')",
      [integrationId],
    );
    const binding = {
      baselineId: id,
      integrationId,
      kind: "payment" as const,
      providerCode: "testpay",
      environment: "default",
    };
    const old = new MerchantBaselineCipher({
      ...DISABLED_INTEGRATIONS_CONFIG,
      keyRing: { current: oldKey, previous: null },
    });
    const sealed = old.seal(binding, "merchant-fixture-é");
    await pool.query(
      "insert into integration_merchant_baseline(id,integration_id,kind,provider_code,environment,enrollment_source,key_id,nonce,ciphertext,tag) values($1,$2,'payment','testpay','default','first_save',$3,$4,$5,$6)",
      [id, integrationId, sealed.keyId, sealed.nonce, sealed.ciphertext, sealed.tag],
    );
    const result = await runRewrapCommand([], env);
    expect(result.tables.integration_merchant_baseline.rewrapped).toBe(1);
    expect(result.exitCode).toBe(0);
    const rows = await pool.query<{
      keyId: string;
      nonce: Buffer;
      ciphertext: Buffer;
      tag: Buffer;
    }>(
      `select key_id as "keyId", nonce, ciphertext, tag from integration_merchant_baseline where id=$1`,
      [id],
    );
    const updated = rows.rows[0];
    if (!updated) throw new Error("fixture_missing");
    const current = new MerchantBaselineCipher({
      ...DISABLED_INTEGRATIONS_CONFIG,
      keyRing: { current: newKey, previous: null },
    });
    expect(current.open(binding, updated)).toBe("merchant-fixture-é");
  });

  it("dry-run reports counts without changing a byte; missing/malformed keys and unknown IDs refuse", async () => {
    const binding = await secret();
    const before = await envelope(binding.secretId);
    expect((await runRewrapCommand(["--dry-run"], env)).tables.integration_secret).toMatchObject({
      eligible: 1,
      rewrapped: 0,
      remainingPrevious: 1,
    });
    expect(await envelope(binding.secretId)).toEqual(before);
    for (const key of ["SECRETS_ENCRYPTION_KEY", "SECRETS_ENCRYPTION_KEY_PREVIOUS"] as const) {
      await expect(runRewrapCommand([], { ...env, [key]: "" })).rejects.toThrow(
        /^integration_rewrap_[a-z_]+$/,
      );
      await expect(
        runRewrapCommand([], { ...env, [key]: "hostile-secret-sentinel" }),
      ).rejects.toThrow("integration_rewrap_keys_invalid");
    }
    await pool.query("update integration_secret set key_id='unknown' where id=$1", [
      binding.secretId,
    ]);
    expect(await runRewrapCommand([], env)).toMatchObject({
      exitCode: 1,
      tables: { integration_secret: { unknown: 1, rewrapped: 0 } },
    });
  });
  it("a tampered row fails without preventing other rows; errors expose counts only", async () => {
    const bad = await secret(),
      good = await secret();
    await pool.query("update integration_secret set tag=$2 where id=$1", [
      bad.secretId,
      randomBytes(16),
    ]);
    const before = await envelope(bad.secretId);
    const outcome = await runRewrapCommand([], env);
    expect(outcome).toMatchObject({
      exitCode: 1,
      tables: { integration_secret: { rewrapped: 1, failed: 1, remainingPrevious: 1 } },
    });
    expect(await envelope(bad.secretId)).toEqual(before);
    expect(newCipher.open(good, await envelope(good.secretId))).toBe("credential-fixture");
    expect(JSON.stringify(outcome)).not.toContain("credential-fixture");
  });
  it("CAS skips a row moved by a concurrent writer", async () => {
    const binding = await secret();
    const read = {
      ...(await envelope(binding.secretId)),
      ...binding,
      id: binding.secretId,
      environment: "default",
    };
    const current = newCipher.seal(binding, "credential-fixture");
    await pool.query(
      "update integration_secret set key_id=$2,nonce=$3,ciphertext=$4,tag=$5 where id=$1",
      [binding.secretId, current.keyId, current.nonce, current.ciphertext, current.tag],
    );
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      expect(await rewrapEnvelope(client, "integration_secret", read, ring)).toBe(false);
    } finally {
      await client.end();
    }
    expect(await envelope(binding.secretId)).toEqual(current);
  });
  it("an interrupted run resumes and a concurrent command exits on the advisory lock", async () => {
    const bindings = await Promise.all([secret(), secret(), secret()]);
    const sorted = [...bindings].sort((a, b) => a.secretId.localeCompare(b.secretId));
    const blocker = await pool.connect();
    const worker = new pg.Client({ connectionString: url });
    await worker.connect();
    const controller = new AbortController();
    let pending: Promise<unknown> | undefined;
    try {
      await blocker.query("begin");
      await blocker.query("select id from integration_secret where id=$1 for update", [
        sorted[1]?.secretId,
      ]);
      const pid = (await blocker.query<{ pid: number }>("select pg_backend_pid() pid")).rows[0]
        ?.pid;
      await worker.query("select pg_advisory_lock($1)", [REWRAP_LOCK_KEY]);
      pending = rewrapEnvelopes(worker, ring, { signal: controller.signal });
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
      await expect(runRewrapCommand([], env)).rejects.toThrow("integration_rewrap_lock_held");
      expect(
        (await pool.query("select 1 from integration_secret where key_id='new'")).rows,
      ).toHaveLength(1);
      controller.abort();
      await blocker.query("commit");
      await expect(pending).rejects.toThrow("integration_rewrap_interrupted");
    } finally {
      await blocker.query("rollback");
      blocker.release();
      await worker.end();
      if (pending !== undefined) await Promise.allSettled([pending]);
    }
    const outcome = await runRewrapCommand([], env);
    expect(outcome).toMatchObject({
      exitCode: 0,
      tables: { integration_secret: { rewrapped: 1, alreadyCurrent: 2, remainingPrevious: 0 } },
    });
    for (const b of bindings)
      expect(newCipher.open(b, await envelope(b.secretId))).toBe("credential-fixture");
  });
  it("pages past 100 envelopes without losing any row", async () => {
    const bindings = await Promise.all(Array.from({ length: 101 }, () => secret()));
    expect((await runRewrapCommand([], env)).tables.integration_secret).toMatchObject({
      rewrapped: 101,
      failed: 0,
      remainingPrevious: 0,
    });
    for (const b of bindings)
      expect(newCipher.open(b, await envelope(b.secretId))).toBe("credential-fixture");
  });
});
