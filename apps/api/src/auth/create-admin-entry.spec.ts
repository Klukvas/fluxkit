import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import { PasswordHasher } from "./password-hasher.js";

// The built entry, exactly as `pnpm admin:create` runs it (`pnpm test` builds first; a missing build fails loudly).
const ENTRY = fileURLToPath(new URL("../../dist/auth/create-admin.js", import.meta.url));
const STRONG = "correct horse battery staple";
const prefix = "cli-entry-";

interface Outcome {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runEntry(args: string[], env: Record<string, string | undefined>): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    // stdin is not a terminal here (ignored), which is the situation of CI and scripts.
    const child = spawn(process.execPath, [ENTRY, ...args], {
      env: { PATH: process.env["PATH"], ...env } as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("built admin:create entry (real process, real Postgres)", () => {
  const databaseUrl = requireTestDatabaseUrl();
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const env = { DATABASE_URL: databaseUrl, ADMIN_PASSWORD: STRONG };

  async function cleanUp(): Promise<void> {
    await pool.query("delete from admin_user where email like $1", [`${prefix}%`]);
  }

  beforeAll(async () => {
    if (!existsSync(ENTRY)) {
      throw new Error(`${ENTRY} does not exist: run "pnpm build" first (pnpm test does).`);
    }
    await ensureMigrated();
    await cleanUp();
  });
  afterEach(cleanUp);
  afterAll(async () => {
    await cleanUp();
    await pool.end();
  });

  it("creates the user, prints one line without secrets and exits 0", async () => {
    const outcome = await runEntry(["--email", `${prefix}Owner@Example.com`], env);
    const { rows } = await pool.query<{
      id: string;
      email: string;
      role: string;
      password_hash: string;
    }>("select id, email, role, password_hash from admin_user where email like $1", [`${prefix}%`]);
    expect(outcome.code).toBe(0);
    expect(rows).toHaveLength(1);
    expect(outcome.stdout).toBe(`Created owner ${prefix}owner@example.com (id ${rows[0]?.id})\n`);
    expect(outcome.stderr).toBe("");
    expect(`${outcome.stdout}${outcome.stderr}`).not.toContain(STRONG);
    expect(`${outcome.stdout}${outcome.stderr}`).not.toContain(
      rows[0]?.password_hash ?? "unreachable",
    );
    await expect(new PasswordHasher().verify(STRONG, rows[0]?.password_hash ?? "")).resolves.toBe(
      true,
    );
  });

  it("exits 1 and leaves an existing user untouched", async () => {
    await runEntry(["--email", `${prefix}dup@example.com`], env);
    const before = await pool.query("select * from admin_user where email like $1", [`${prefix}%`]);
    const outcome = await runEntry(["--email", `${prefix}dup@example.com`], {
      ...env,
      ADMIN_PASSWORD: "a completely different password",
    });
    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toMatch(/already exists/);
    expect(outcome.stderr).not.toContain("a completely different password");
    const after = await pool.query("select * from admin_user where email like $1", [`${prefix}%`]);
    expect(after.rows).toEqual(before.rows);
  });

  it("exits 1 on a --password argument without echoing it", async () => {
    const outcome = await runEntry(
      ["--email", `${prefix}arg@example.com`, "--password", "hunter2hunter2"],
      env,
    );
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toMatch(/process list and shell history/);
    expect(`${outcome.stdout}${outcome.stderr}`).not.toContain("hunter2");
    expect(
      (await pool.query("select 1 from admin_user where email like $1", [`${prefix}%`])).rowCount,
    ).toBe(0);
  });

  it("exits 1 without ADMIN_PASSWORD when stdin is not a terminal", async () => {
    const outcome = await runEntry(["--email", `${prefix}np@example.com`], {
      DATABASE_URL: databaseUrl,
    });
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toMatch(/ADMIN_PASSWORD/);
  });

  it("exits 1 for a weak password, an unknown role and a missing email, creating nothing", async () => {
    const weak = await runEntry(["--email", `${prefix}weak@example.com`], {
      ...env,
      ADMIN_PASSWORD: "short",
    });
    const role = await runEntry(["--email", `${prefix}role@example.com`, "--role", "root"], env);
    const missing = await runEntry([], env);
    expect([weak.code, role.code, missing.code]).toEqual([1, 1, 1]);
    expect(
      (await pool.query("select 1 from admin_user where email like $1", [`${prefix}%`])).rowCount,
    ).toBe(0);
  });
});
