import { loadEnv } from "@fluxkit/config";
import { createApp } from "../app.factory.js";
import { describeMigrateError } from "../database/migrate-command.js";
import { describeAllCounts, type JobReport } from "./jobs-runner.js";
import { SchedulerService } from "./scheduler.service.js";

const USAGE =
  "Usage: pnpm jobs:run-once (takes no arguments; DATABASE_URL comes from the environment or .env)";

/** The person running the command can fix this (bad input, missing variable): the message is the whole output. */
export class RunOnceUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunOnceUsageError";
  }
}

export type RunOnceOutcome =
  | { kind: "ran"; reports: JobReport[] }
  /** The scheduler lock is held by a running scheduler (or another `jobs:run-once`): nothing was run. */
  | { kind: "lock_held" };

/** Exit codes of `pnpm jobs:run-once`. */
export const RUN_ONCE_EXIT = Object.freeze({ ok: 0, jobFailed: 1, lockHeld: 2 });

/**
 * Runs every job once with `now` = the system clock, under the SAME advisory lock as the in-process scheduler. It does
 * NOT wait for the lock: when a running scheduler holds it (a tick takes seconds), the command reports that and runs
 * nothing, because that scheduler is doing exactly this work. The application is built without the HTTP listener, the
 * timer and the startup cleanup of admin sessions.
 */
export async function runJobsOnceCommand(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<RunOnceOutcome> {
  if (argv.length > 0) {
    throw new RunOnceUsageError(
      `pnpm jobs:run-once takes no arguments, got: ${argv.join(" ")}. ${USAGE}`,
    );
  }
  const rawUrl = env["DATABASE_URL"];
  if (rawUrl === undefined || rawUrl.trim() === "") {
    throw new RunOnceUsageError(
      `DATABASE_URL is not set. Put it in the root .env (see .env.example) or export it. ${USAGE}`,
    );
  }
  const config = loadEnv({ ...env });
  const app = await createApp(
    { ...config, schedulerEnabled: false },
    { cleanExpiredSessionsOnBootstrap: false, logLevels: ["error", "warn"] },
  );
  try {
    await app.init();
    const outcome = await app.get(SchedulerService).runOnce();
    return outcome.status === "ran"
      ? { kind: "ran", reports: outcome.reports }
      : { kind: "lock_held" };
  } finally {
    await app.close();
  }
}

/** One line per job: its counts, or `FAILED`. */
export function formatRunOnce(outcome: RunOnceOutcome): string {
  if (outcome.kind === "lock_held") {
    return "Another process holds the scheduler lock (a running scheduler or another jobs:run-once); it is doing this work. Nothing was run.";
  }
  return outcome.reports
    .map((report) =>
      report.ok ? `${report.name}: ${describeAllCounts(report.result)}` : `${report.name}: FAILED`,
    )
    .join("\n");
}

/** The full error of every failed job (stack, Postgres fields, causes), with the connection string removed. */
export function describeFailedJobs(outcome: RunOnceOutcome, databaseUrl: string): string[] {
  if (outcome.kind !== "ran") {
    return [];
  }
  return outcome.reports.flatMap((report) =>
    report.ok ? [] : [`${report.name}:\n${describeMigrateError(report.error, [databaseUrl])}`],
  );
}

export function exitCodeOf(outcome: RunOnceOutcome): number {
  if (outcome.kind === "lock_held") {
    return RUN_ONCE_EXIT.lockHeld;
  }
  return outcome.reports.some((report) => !report.ok) ? RUN_ONCE_EXIT.jobFailed : RUN_ONCE_EXIT.ok;
}
