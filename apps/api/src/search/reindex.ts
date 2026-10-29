import { describeMigrateError } from "../database/migrate-command.js";
import {
  formatReindex,
  ReindexUsageError,
  reindexExitCode,
  runReindexCommand,
} from "./reindex-command.js";

// Entry point of `pnpm search:reindex`. Built output is run with plain Node; see README.md (Catalog search).
runReindexCommand(process.argv.slice(2), process.env)
  .then((outcome) => {
    const text = formatReindex(outcome);
    if (reindexExitCode(outcome) === 0) {
      console.log(text);
    } else {
      console.error(text);
    }
    process.exitCode = reindexExitCode(outcome);
  })
  .catch((error: unknown) => {
    const text =
      error instanceof ReindexUsageError
        ? error.message
        : describeMigrateError(error, [process.env["DATABASE_URL"] ?? ""]);
    console.error(`Could not rebuild the search index.\n${text}`);
    process.exitCode = 1;
  });
