import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emailProviderOk, type EmailProviderPort } from "@fluxkit/core";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { ensureMigrated } from "../../test/migrate.js";
import {
  assertEmailFallbackReadiness,
  EMAIL_SUPPRESSION_MIGRATION_WHEN,
} from "./email-fallback-readiness.js";

const provider = (code: string, verifier = true): EmailProviderPort => ({
  code,
  capabilities: { idempotencyKeys: true, maxRecipients: 1 },
  send: () => Promise.resolve(emailProviderOk({ providerMessageId: "unused" })),
  ...(verifier
    ? { webhookVerifier: () => ({ ok: false as const, reason: "unauthenticated" as const }) }
    : {}),
});
const chain = [provider("resend"), provider("brevo")];

describe("fallback startup prerequisite (real Postgres, read-only checks)", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    await ensureMigrated();
    pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  });
  afterAll(async () => {
    await pool.end();
  });

  it("accepts the applied schema even when suppression tables are empty", async () => {
    await expect(assertEmailFallbackReadiness(pool, chain, true, true)).resolves.toBeUndefined();
  });
  it("keeps legacy one-provider and off startup without new prerequisites", async () => {
    await expect(assertEmailFallbackReadiness(pool, [], false, false)).resolves.toBeUndefined();
    await expect(
      assertEmailFallbackReadiness(pool, [provider("resend", false)], false, false),
    ).resolves.toBeUndefined();
  });
  it.each([0, 1])("refuses a missing verifier/secret at chain position %s", async (position) => {
    const selected = chain.map((port, index) => provider(port.code, index !== position));
    await expect(assertEmailFallbackReadiness(pool, selected, true, true)).rejects.toThrow(
      /webhook verifier and webhook secret/,
    );
  });
  it("refuses an unwired sender guard and an unregistered route", async () => {
    await expect(assertEmailFallbackReadiness(pool, chain, false, true)).rejects.toThrow(
      /sender guard/,
    );
    await expect(assertEmailFallbackReadiness(pool, chain, true, false)).rejects.toThrow(
      /webhook routes/,
    );
  });
  it("accepts an empty suppression/receipt installation without requiring recipient history", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from email_webhook_receipt");
      await client.query("delete from email_suppression");
      await expect(
        assertEmailFallbackReadiness(client, chain, true, true),
      ).resolves.toBeUndefined();
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("requires the exact step-1b journal entry", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from drizzle.__drizzle_migrations where created_at = $1", [
        EMAIL_SUPPRESSION_MIGRATION_WHEN,
      ]);
      await expect(assertEmailFallbackReadiness(client, chain, true, true)).rejects.toThrow(
        /migration 0017_email_suppression/,
      );
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
  it("queries required schema, instead of interpreting an empty/missing relation as ready", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local search_path = pg_catalog");
      await expect(assertEmailFallbackReadiness(client, chain, true, true)).rejects.toThrow(
        /queryable suppression\/receipt schema/,
      );
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
