import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../database/schema/index.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import { IntegrationRuntime } from "./integration-runtime.js";
import { IntegrationsRepository } from "./integrations.repository.js";
import { InstalledIntegrations } from "./installed-integrations.js";
import { SecretCipher } from "./secret-cipher.js";

describe("final transport gate (real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const db = drizzle(pool, { schema });
  const repository = new IntegrationsRepository(db);
  const installed = new InstalledIntegrations({
    keyRing: null,
    providersDir: "",
    isProduction: false,
    environment: {},
    emailRouteDelegated: false,
    emailFromAddress: null,
    paymentDelegated: false,
    shippingDelegated: false,
    shopCurrency: "UAH",
    orderPaymentTtlMinutes: 30,
    storefrontPublicUrl: null,
  });
  const runtime = new IntegrationRuntime(db, repository, installed, new SecretCipher(null));
  beforeAll(async () => {
    await ensureMigrated();
  });
  afterAll(async () => {
    await pool.end();
  });
  async function version() {
    const integrationId = randomUUID();
    const id = randomUUID();
    await pool.query("insert into integration(id,kind,provider_code) values($1,'payment',$2)", [
      integrationId,
      `gate_${integrationId.replaceAll("-", "")}`,
    ]);
    await pool.query(
      "insert into integration_credential_version(id,integration_id,generation,purpose,state) values($1,$2,1,'outbound','candidate')",
      [id, integrationId],
    );
    return { integrationId, id };
  }
  it("never begins after revocation committed first", async () => {
    const { id } = await version();
    let began = false;
    await pool.query(
      "update integration_credential_version set state='revoked',revoked_at=now() where id=$1",
      [id],
    );
    await expect(
      runtime.gateFor(id, ["candidate"]).start(new AbortController().signal, () => {
        began = true;
        return { completion: Promise.resolve("bad") };
      }),
    ).rejects.toMatchObject({ code: "credential_revoked" });
    expect(began).toBe(false);
  });
  it("releases locks before awaiting completion; an already-started call can finish after revoke", async () => {
    const { id, integrationId } = await version();
    const began = deferred<undefined>();
    const remote = deferred<string>();
    const completion = runtime
      .gateFor(id, ["candidate"])
      .start(new AbortController().signal, () => {
        began.resolve(undefined);
        return { completion: remote.promise };
      });
    await began.promise;
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local lock_timeout='1s'");
      await client.query("select id from integration where id=$1 for update", [integrationId]);
      await client.query("select id from integration_credential_version where id=$1 for update", [
        id,
      ]);
      await client.query(
        "update integration_credential_version set state='revoked',revoked_at=now() where id=$1",
        [id],
      );
      await client.query("commit");
    } finally {
      await client.query("rollback");
      client.release();
      remote.resolve("finished");
    }
    expect(await completion).toBe("finished");
  });
  it("observes a rejected async begin without awaiting it under locks or leaking its error", async () => {
    const { id } = await version();
    const rejected = Promise.reject(new Error("SECRET_SENTINEL"));
    // Keep the regression's red run safe; spy only on boundary-installed handlers.
    void rejected.catch(() => undefined);
    const observed = vi.spyOn(rejected, "catch");
    const invalidBegin = (() => rejected) as unknown as () => { completion: Promise<string> };
    await expect(
      runtime.gateFor(id, ["candidate"]).start(new AbortController().signal, invalidBegin),
    ).rejects.toThrow("credential_transport_unavailable");
    expect(observed).toHaveBeenCalledWith(expect.any(Function));
  });
  it("refuses an aborted signal without calling begin", async () => {
    const { id } = await version();
    let began = false;
    const controller = new AbortController();
    controller.abort();
    await expect(
      runtime.gateFor(id, ["candidate"]).start(controller.signal, () => {
        began = true;
        return { completion: Promise.resolve() };
      }),
    ).rejects.toMatchObject({ code: "credential_unavailable" });
    expect(began).toBe(false);
  });
});

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {
    throw new Error("not_initialized");
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
