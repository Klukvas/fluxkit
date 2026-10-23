import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { keyToRelativePath, type MediaKey } from "@fluxkit/core";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import { JobsRepository } from "./jobs.repository.js";
import { JOB_NAMES } from "./jobs-runner.js";
import { SCHEDULER_LOCK_KEY } from "./scheduler-lock.js";
import {
  RUN_ONCE_EXIT,
  RunOnceUsageError,
  describeFailedJobs,
  exitCodeOf,
  formatRunOnce,
  runJobsOnceCommand,
} from "./run-once-command.js";

// The built entry, exactly as `pnpm jobs:run-once` runs it (`pnpm test` builds first; a missing build fails loudly).
const ENTRY = fileURLToPath(new URL("../../dist/jobs/run-once.js", import.meta.url));

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

describe("pnpm jobs:run-once (real Postgres)", () => {
  const databaseUrl = requireTestDatabaseUrl();
  const env = { DATABASE_URL: databaseUrl };
  let holder: pg.Client | undefined;

  beforeAll(async () => {
    if (!existsSync(ENTRY)) {
      throw new Error(`${ENTRY} does not exist: run "pnpm build" first (pnpm test does).`);
    }
    await ensureMigrated();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await holder?.end();
    holder = undefined;
  });

  async function holdTheLock(): Promise<void> {
    holder = new pg.Client({ connectionString: databaseUrl });
    await holder.connect();
    const result = await holder.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [SCHEDULER_LOCK_KEY],
    );
    expect(result.rows[0]?.locked).toBe(true);
  }

  describe("the built entry (a real process)", () => {
    it("runs every job once, prints one line of counts per job and exits 0", async () => {
      const result = await runEntry([], env);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      const lines = result.stdout.trim().split("\n");
      expect(lines.map((line) => line.split(":")[0])).toEqual([...JOB_NAMES]);
      expect(lines[0]).toMatch(
        /^expire-orders: scanned=\d+ expired=\d+ notDue=\d+ failures=0 truncated=false$/,
      );
      expect(lines.every((line) => !line.includes("FAILED"))).toBe(true);
    });

    it("deletes an abandoned upload and its file in a real process (a real MEDIA_DIR)", async () => {
      const mediaDir = await mkdtemp(join(tmpdir(), "fluxkit-run-once-media-"));
      const pool = new pg.Pool({ connectionString: databaseUrl });
      const key = `${randomBytes(16).toString("hex")}.png` as MediaKey;
      const path = join(mediaDir, keyToRelativePath(key));
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, "png-bytes");
        await pool.query(
          `insert into media_upload (storage_key, content_type, byte_size, width, height, sha256, created_at)
           values ($1, 'image/png', 9, 1, 1, $2, now() - interval '3 days')`,
          [key, "c".repeat(64)],
        );
        const result = await runEntry([], {
          ...env,
          MEDIA_DIR: mediaDir,
          MEDIA_PUBLIC_BASE_URL: "https://shop.example.test/media",
        });
        expect(result.stderr).toBe("");
        expect(result.code).toBe(0);
        const line = result.stdout
          .split("\n")
          .find((candidate) => candidate.startsWith("delete-abandoned-uploads:"));
        expect(line).toMatch(
          /^delete-abandoned-uploads: deleted=[1-9]\d* truncated=false fileErrors=0$/,
        );
        const left = await pool.query("select 1 from media_upload where storage_key = $1", [key]);
        expect(left.rowCount).toBe(0);
        expect(existsSync(path)).toBe(false);
      } finally {
        await pool.query("delete from media_upload where storage_key = $1", [key]);
        await pool.end();
        await rm(mediaDir, { recursive: true, force: true });
      }
    });

    it("does not wait for a running scheduler: it says so, runs nothing and exits 2", async () => {
      await holdTheLock();
      const result = await runEntry([], env);
      expect(result.code).toBe(RUN_ONCE_EXIT.lockHeld);
      expect(result.code).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("holds the scheduler lock");
      expect(result.stderr).toContain("Nothing was run");
    });

    it("runs again once the lock is free", async () => {
      await holdTheLock();
      await holder?.query("select pg_advisory_unlock($1)", [SCHEDULER_LOCK_KEY]);
      expect((await runEntry([], env)).code).toBe(0);
    });

    it("exits 1 with a clear message for a malformed setting, like the API would at startup", async () => {
      const result = await runEntry([], { ...env, SCHEDULER_INTERVAL_SECONDS: "5" });
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("SCHEDULER_INTERVAL_SECONDS");
    });

    it("exits 1 when DATABASE_URL is missing, and takes no arguments", async () => {
      const missing = await runEntry([], {});
      expect(missing.code).toBe(1);
      expect(missing.stderr).toContain("DATABASE_URL is not set");
      const extra = await runEntry(["--now"], env);
      expect(extra.code).toBe(1);
      expect(extra.stderr).toContain("takes no arguments");
    });

    it("exits 1 without leaking the connection string when the database is unreachable", async () => {
      const result = await runEntry([], {
        DATABASE_URL: "postgres://fluxkit:hunter2secret@127.0.0.1:1/none",
      });
      expect(result.code).toBe(1);
      expect(result.stderr).not.toContain("hunter2secret");
    });
  });

  describe("runJobsOnceCommand", () => {
    it("reports a failing job with its full error, exits 1, and the other jobs still ran", async () => {
      vi.spyOn(JobsRepository.prototype, "deleteExpiredCarts").mockRejectedValue(
        new Error(`connect failed for ${databaseUrl}`),
      );
      const outcome = await runJobsOnceCommand([], env);
      expect(outcome.kind).toBe("ran");
      expect(exitCodeOf(outcome)).toBe(RUN_ONCE_EXIT.jobFailed);
      const text = formatRunOnce(outcome).split("\n");
      expect(text).toHaveLength(JOB_NAMES.length);
      expect(text.filter((line) => line.endsWith("FAILED"))).toEqual(["delete-carts: FAILED"]);
      const failures = describeFailedJobs(outcome, databaseUrl);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain("delete-carts:");
      expect(failures[0]).toContain("connect failed");
      expect(failures[0]).toContain("Error: ");
      expect(failures[0]).not.toContain(databaseUrl);
    });

    it("answers lock_held (exit 2) without running a job while the lock is taken elsewhere", async () => {
      await holdTheLock();
      const outcome = await runJobsOnceCommand([], env);
      expect(outcome).toEqual({ kind: "lock_held" });
      expect(exitCodeOf(outcome)).toBe(2);
      expect(describeFailedJobs(outcome, databaseUrl)).toEqual([]);
    });

    it("refuses arguments and a missing database URL with a usage error", async () => {
      await expect(runJobsOnceCommand(["x"], env)).rejects.toThrow(RunOnceUsageError);
      await expect(runJobsOnceCommand([], { DATABASE_URL: " " })).rejects.toThrow(
        RunOnceUsageError,
      );
    });
  });
});
