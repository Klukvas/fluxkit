import { describeError, formatSummary, runSeedCommand } from "./seed-command.js";

// Entry point of `pnpm seed`. Built output is run with plain Node; see seeds/README.md.
runSeedCommand(process.argv.slice(2), process.env)
  .then((summary) => {
    console.log(formatSummary(summary));
  })
  .catch((error: unknown) => {
    console.error(`Seed failed.\n${describeError(error)}`);
    process.exit(1);
  });
