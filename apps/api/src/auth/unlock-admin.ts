import {
  describeUnlockAdminError,
  formatUnlocked,
  runUnlockAdminCommand,
} from "./unlock-admin-command.js";

// Entry point of `pnpm admin:unlock`. Built output is run with plain Node; see README.md (Admin sign-in).
runUnlockAdminCommand(process.argv.slice(2), process.env)
  .then((result) => {
    console.log(formatUnlocked(result));
  })
  .catch((error: unknown) => {
    console.error(`Could not unlock the admin user.\n${describeUnlockAdminError(error)}`);
    process.exitCode = 1;
  });
