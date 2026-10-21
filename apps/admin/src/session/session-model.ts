import type { AdminMe } from "@fluxkit/api-client";
import type { Failure } from "../lib/failure";
import { PATHS } from "../router/paths";

/**
 * The session as the SPA knows it (plan, "Session expiry, sign-in and CSRF"). Pure, so the rules are tested without a
 * browser; `SessionProvider` feeds it the answers of `GET /admin/auth/me` and the session signals of every request.
 *
 * - `loading`: the first `me` is on its way. `failed`: it could not be read (network, timeout); retryable.
 * - `signedOut`: nobody is signed in; the sign-in page shows.
 * - `signedIn`: `me` holds the user and the permissions.
 * - `expired`: a request answered 401 while signed in. The page stays mounted under the re-sign-in dialog, so unsaved
 *   input survives; the failed write is not replayed.
 *
 * `generation` changes whenever all page state must go (sign-out, another user signed in): the shell keys the pages
 * with it. `redirect` is a one-shot navigation for the provider to perform, told apart by `id`.
 */
export type SessionStatus = "loading" | "failed" | "signedOut" | "signedIn" | "expired";

export interface SessionState {
  status: SessionStatus;
  me: AdminMe | null;
  failure: Failure | null;
  generation: number;
  redirect: { to: string; id: number } | null;
}

export type SessionEvent =
  | { type: "meLoaded"; me: AdminMe }
  | { type: "meUnauthorized" }
  | { type: "meFailed"; failure: Failure }
  | { type: "unauthorized" }
  | { type: "signedOut" }
  | { type: "retry" };

export const initialSessionState: SessionState = {
  status: "loading",
  me: null,
  failure: null,
  generation: 0,
  redirect: null,
};

function redirectTo(state: SessionState, to: string): SessionState["redirect"] {
  return { to, id: (state.redirect?.id ?? 0) + 1 };
}

export function sessionReducer(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case "meLoaded": {
      const previous = state.me;
      if (previous !== null && previous.user.id !== event.me.user.id) {
        // Another user now holds the cookie: nothing of the previous user's screens may survive. This is seen only when
        // `me` is read again: after a sign-in through the re-sign-in dialog, or after a 403. A user change made in another
        // tab is NOT detected by itself (no polling, no focus check): the tab keeps the old user's screens until a 401 or
        // 403 (step 13 review L2, a known limitation in docs/HANDOFF.md).
        return {
          status: "signedIn",
          me: event.me,
          failure: null,
          generation: state.generation + 1,
          redirect: redirectTo(state, PATHS.home),
        };
      }
      return { ...state, status: "signedIn", me: event.me, failure: null };
    }
    case "meUnauthorized":
      if (state.status === "signedIn" || state.status === "expired") {
        return { ...state, status: "expired" };
      }
      return { ...state, status: "signedOut", me: null, failure: null };
    case "meFailed":
      return state.status === "loading"
        ? { ...state, status: "failed", failure: event.failure }
        : state;
    case "unauthorized":
      return state.status === "signedIn" ? { ...state, status: "expired" } : state;
    case "signedOut":
      return {
        status: "signedOut",
        me: null,
        failure: null,
        generation: state.generation + 1,
        redirect: redirectTo(state, PATHS.login),
      };
    case "retry":
      return state.status === "failed" ? { ...state, status: "loading", failure: null } : state;
  }
}
