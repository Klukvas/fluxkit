import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";

// The built entry, exactly as `pnpm admin:unlock` runs it (`pnpm test` builds first; a missing build fails loudly).
const ENTRY = fileURLToPath(new URL("../../dist/auth/unlock-admin.js", import.meta.url));
const prefix = "unlock-entry-";
const HASH = "scrypt$16$8$1$c2FsdA$aGFzaGhhc2g";

interface Outcome {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runEntry(args: string[], env: Record<string, string | undefined>): Promise<Outcome> {
  return new Promise((resolve, reject) => {
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

describe("built admin:unlock entry (real process, real Postgres)", () => {
  const databaseUrl = requireTestDatabaseUrl();
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const env = { DATABASE_URL: databaseUrl };

  async function insertUser(name: string, locked: boolean): Promise<void> {
    await pool.query(
      `insert into admin_user (email, password_hash, role, failed_login_count, locked_until)
       values ($1, $2, 'owner', $3, $4)`,
      [
        `${prefix}${name}@example.com`,
        HASH,
        locked ? 5 : 0,
        locked ? new Date("2099-01-01") : null,
      ],
    );
  }

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

  it("unlocks, prints exactly one line without secrets and exits 0", async () => {
    await insertUser("locked", true);
    const outcome = await runEntry(["--email", `${prefix}Locked@Example.com`], env);
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toBe(`Unlocked ${prefix}locked@example.com\n`);
    expect(outcome.stderr).toBe("");
    expect(`${outcome.stdout}${outcome.stderr}`).not.toContain(HASH);
    const { rows } = await pool.query<{ failed_login_count: number; locked_until: Date | null }>(
      "select failed_login_count, locked_until from admin_user where email like $1",
      [`${prefix}%`],
    );
    expect(rows).toEqual([{ failed_login_count: 0, locked_until: null }]);
  });

  it("says the account was not locked and exits 0", async () => {
    await insertUser("open", false);
    const outcome = await runEntry(["--email", `${prefix}open@example.com`], env);
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toBe(`${prefix}open@example.com was not locked\n`);
  });

  it("exits 1 for an unknown email, with a message and nothing on stdout", async () => {
    const outcome = await runEntry(["--email", `${prefix}ghost@example.com`], env);
    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toMatch(/No admin user with the email/);
  });

  it("exits 1 on bad arguments and on a password argument, without echoing it", async () => {
    const missing = await runEntry([], env);
    const unknown = await runEntry(["--email", "a@b.co", "--role", "owner"], env);
    const password = await runEntry(["--email", "a@b.co", "--password", "hunter2hunter2"], env);
    expect([missing.code, unknown.code, password.code]).toEqual([1, 1, 1]);
    expect(password.stderr).toMatch(/process list and shell history/);
    expect(`${password.stdout}${password.stderr}`).not.toContain("hunter2");
  });

  it("exits 1 without DATABASE_URL and says so", async () => {
    const outcome = await runEntry(["--email", "a@b.co"], {});
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toMatch(/DATABASE_URL/);
  });
});
