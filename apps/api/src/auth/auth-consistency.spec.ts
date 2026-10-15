import {
  DEFAULT_ADMIN_SESSION_IDLE_MINUTES,
  DEFAULT_ADMIN_SESSION_MAX_HOURS,
} from "@fluxkit/config";
import { ROLES, SESSION_DEFAULTS } from "@fluxkit/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import { DEFAULT_ADMIN_AUTH_CONFIG } from "./auth-config.js";

describe("auth rules and their copies agree", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("ROLES of @fluxkit/core equal the roles the admin_user_role_check constraint allows", async () => {
    const result = await pool.query<{ definition: string }>(
      `select pg_get_constraintdef(c.oid) as definition
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
        where t.relname = 'admin_user' and c.conname = 'admin_user_role_check'`,
    );
    expect(result.rows).toHaveLength(1);
    const definition = result.rows[0]?.definition ?? "";
    const allowed = [...definition.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? "");
    expect(allowed.length).toBeGreaterThan(0);
    expect([...allowed].sort()).toEqual([...ROLES].sort());
  });

  it("the config package defaults equal SESSION_DEFAULTS of @fluxkit/core", () => {
    expect(DEFAULT_ADMIN_SESSION_IDLE_MINUTES).toBe(SESSION_DEFAULTS.idleMinutes);
    expect(DEFAULT_ADMIN_SESSION_MAX_HOURS).toBe(SESSION_DEFAULTS.maxHours);
    expect(DEFAULT_ADMIN_AUTH_CONFIG).toEqual({
      cookieSecure: true,
      idleMinutes: SESSION_DEFAULTS.idleMinutes,
      maxHours: SESSION_DEFAULTS.maxHours,
    });
  });
});
