import type { AdminMe, AdminResult } from "@fluxkit/api-client";
import { failureFromError } from "../lib/failure";
import type { SessionSignal } from "../lib/session-signals";
import type { SessionEvent } from "./session-model";

export interface SessionSync {
  /** Reads `me` again; while one read runs, another call does nothing. */
  reloadMe(): void;
  /** For the signal hub: what a 401 or 403 of any request does to the session. */
  onSignal(signal: SessionSignal): void;
}

/**
 * How the session follows the answers of every request, without React (tested on its own, step 13 review G14): a 401
 * ends the session (the re-sign-in dialog), a 403 reads `me` again, because the role may have changed meanwhile and
 * this read is the only way a role change reaches an open tab. A user change made in another tab is noticed only
 * through such a 401 or 403 (a known limitation, `docs/HANDOFF.md`).
 */
export function createSessionSync(
  getMe: () => Promise<AdminResult<AdminMe>>,
  dispatch: (event: SessionEvent) => void,
): SessionSync {
  let reloading = false;
  function reloadMe(): void {
    if (reloading) return;
    reloading = true;
    getMe()
      .then(
        (result) => {
          if (result.ok) dispatch({ type: "meLoaded", me: result.data });
          else if (result.status === 401) dispatch({ type: "meUnauthorized" });
        },
        (error: unknown) => {
          const failure = failureFromError(error);
          if (failure !== null) dispatch({ type: "meFailed", failure });
        },
      )
      .finally(() => {
        reloading = false;
      });
  }
  return {
    reloadMe,
    onSignal(signal) {
      if (signal === "unauthorized") dispatch({ type: "unauthorized" });
      else reloadMe();
    },
  };
}
