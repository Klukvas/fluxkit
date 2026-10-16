import {
  MigrateFailure,
  MigrateRefusal,
  MigrateUsageError,
  formatMigrateResult,
  runMigrateCommand,
} from "./migrate-command.js";

// Entry point of `pnpm db:migrate`. Built output is run with plain Node; see README.md (quick start).
runMigrateCommand(process.argv.slice(2), process.env, { log: (line) => console.log(line) })
  .then((result) => {
    console.log(formatMigrateResult(result));
  })
  .catch((error: unknown) => {
    // Known errors carry their own, already redacted text; anything else is a bug and keeps its full stack.
    const known =
      error instanceof MigrateUsageError ||
      error instanceof MigrateRefusal ||
      error instanceof MigrateFailure;
    console.error(`Migration failed.\n${known ? error.message : String(error)}`);
    process.exitCode = 1;
  });
