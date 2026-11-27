import { runRewrapCommand } from "./rewrap-command.js";

runRewrapCommand(process.argv.slice(2), process.env)
  .then((outcome) => {
    for (const [table, counts] of Object.entries(outcome.tables)) {
      process.stdout.write(
        `${table}: ${Object.entries(counts)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(" ")}\n`,
      );
    }
    process.exitCode = outcome.exitCode;
  })
  .catch((error: unknown) => {
    // Never pass raw DB, configuration or cryptographic errors to stdout/stderr.
    const code =
      error instanceof Error && /^integration_rewrap_[a-z_]+$/.test(error.message)
        ? error.message
        : "integration_rewrap_failed";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
