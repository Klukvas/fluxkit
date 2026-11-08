import { datasetOf, describeError, formatSummary, runSeedCommand } from "./seed-command.js";

// Entry point of `pnpm seed` (`--dataset coffee`, the default) and `pnpm seed:test` (`--dataset test`). Built output is run
// with plain Node; see seeds/README.md.
const argv = process.argv.slice(2);
runSeedCommand(argv, process.env)
  .then((summary) => {
    console.log(formatSummary(summary, datasetOf(argv)));
  })
  .catch((error: unknown) => {
    console.error(`Seed failed.\n${describeError(error)}`);
    process.exit(1);
  });
