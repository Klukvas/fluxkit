import { describeMigrateError } from "../database/migrate-command.js";
import {
  RunOnceUsageError,
  describeFailedJobs,
  exitCodeOf,
  formatRunOnce,
  runJobsOnceCommand,
} from "./run-once-command.js";

// Entry point of `pnpm jobs:run-once`. Built output is run with plain Node; see README.md (Scheduler and jobs).
runJobsOnceCommand(process.argv.slice(2), process.env)
  .then((outcome) => {
    const code = exitCodeOf(outcome);
    if (outcome.kind === "lock_held") {
      console.error(formatRunOnce(outcome));
    } else {
      console.log(formatRunOnce(outcome));
    }
    for (const failure of describeFailedJobs(outcome, process.env["DATABASE_URL"] ?? "")) {
      console.error(`Job failed.\n${failure}`);
    }
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const text =
      error instanceof RunOnceUsageError
        ? error.message
        : describeMigrateError(error, [process.env["DATABASE_URL"] ?? ""]);
    console.error(`Could not run the jobs.\n${text}`);
    process.exitCode = 1;
  });
