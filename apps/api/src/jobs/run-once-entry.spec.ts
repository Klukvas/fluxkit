import { expect, it, vi } from "vitest";
import * as command from "./run-once-command.js";
import { SchedulerLockLostError } from "./scheduler-lock.js";

it("prints only the friendly lock-loss message and exits 1", async () => {
  const previousExitCode = process.exitCode;
  const error = new SchedulerLockLostError();
  error.cause = new Error("secret connection details");
  vi.spyOn(command, "runJobsOnceCommand").mockRejectedValue(error);
  const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await import("./run-once.js");
    await vi.waitFor(() => {
      expect(stderr).toHaveBeenCalledExactlyOnceWith(`Could not run the jobs.\n${error.message}`);
      expect(process.exitCode).toBe(1);
    });
  } finally {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
  }
});
