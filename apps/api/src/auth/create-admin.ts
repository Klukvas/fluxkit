import {
  describeCreateAdminError,
  formatCreated,
  runCreateAdminCommand,
} from "./create-admin-command.js";
import { createHiddenPrompter, type HiddenPrompter } from "./create-admin-prompt.js";

// Entry point of `pnpm admin:create`. Built output is run with plain Node; see README.md (Admin sign-in).
let prompter: HiddenPrompter | undefined;

runCreateAdminCommand(process.argv.slice(2), process.env, {
  stdinIsTty: process.stdin.isTTY === true,
  ask: (question) => {
    prompter ??= createHiddenPrompter(process.stdin, process.stdout);
    return prompter.ask(question);
  },
})
  .then((created) => {
    console.log(formatCreated(created));
  })
  .catch((error: unknown) => {
    console.error(`Could not create the admin user.\n${describeCreateAdminError(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    prompter?.close();
  });
