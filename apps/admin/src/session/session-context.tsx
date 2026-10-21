import type { AdminLoginBody, AdminOperationPermission } from "@fluxkit/api-client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { adminClient, sessionSignals } from "../lib/api";
import { failureFromError, type Failure } from "../lib/failure";
import { retryAfterMinutes } from "../lib/retry-after";
import { canAccess } from "../permissions";
import { initialSessionState, sessionReducer, type SessionState } from "./session-model";

/** How a sign-in attempt ended, in the terms the form shows. */
export type SignInOutcome =
  | { status: "signedIn" }
  /** The one identical answer for unknown email, wrong password, locked and inactive (ADR 0009, 0010). */
  | { status: "rejected" }
  | { status: "throttled"; minutes: number | null }
  | { status: "failed"; failure: Failure };

export interface SessionValue {
  state: SessionState;
  /** Reads only the permission list of `GET /admin/auth/me`. */
  can: (permission: AdminOperationPermission) => boolean;
  signIn: (body: AdminLoginBody) => Promise<SignInOutcome>;
  /** `null` when signed out; else why the sign-out failed (the session stays). */
  signOut: () => Promise<Failure | null>;
  /** Reads `me` again (after a 403: the role may have changed). */
  reloadMe: () => void;
  /** Tries the first `me` again after a network failure. */
  retry: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

function problemFailure(result: {
  status: number;
  problem: Extract<Failure, { kind: "problem" }>["problem"];
  retryAfter: string | null;
}): Failure {
  return {
    kind: "problem",
    status: result.status,
    problem: result.problem,
    retryAfter: result.retryAfter,
  };
}

/**
 * The session for the whole SPA (plan, "Permissions in the UI", "Session expiry, sign-in and CSRF"). Reads
 * `GET /admin/auth/me` on start, listens to the 401 and 403 answers of every request (`sessionSignals`), and performs the
 * navigations the model asks for (start page after a user change, sign-in page after sign-out). Holds no credential: the
 * `HttpOnly` cookie is the session.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();
  const reloading = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    adminClient.getMe({ signal: controller.signal }).then(
      (result) => {
        if (result.ok) dispatch({ type: "meLoaded", me: result.data });
        else if (result.status === 401) dispatch({ type: "meUnauthorized" });
        else dispatch({ type: "meFailed", failure: problemFailure(result) });
      },
      (error: unknown) => {
        const failure = failureFromError(error);
        if (failure !== null) dispatch({ type: "meFailed", failure });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  const reloadMe = useCallback(() => {
    if (reloading.current) return;
    reloading.current = true;
    adminClient
      .getMe()
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
        reloading.current = false;
      });
  }, []);

  useEffect(
    () =>
      sessionSignals.subscribe((signal) => {
        if (signal === "unauthorized") dispatch({ type: "unauthorized" });
        else reloadMe();
      }),
    [reloadMe],
  );

  const redirectId = state.redirect?.id;
  const redirectTo = state.redirect?.to;
  useEffect(() => {
    if (redirectId !== undefined && redirectTo !== undefined) {
      void navigate(redirectTo, { replace: true });
    }
  }, [redirectId, redirectTo, navigate]);

  const signIn = useCallback(async (body: AdminLoginBody): Promise<SignInOutcome> => {
    try {
      const login = await adminClient.login(body);
      if (!login.ok) {
        if (login.status === 401) return { status: "rejected" };
        if (login.status === 429) {
          return { status: "throttled", minutes: retryAfterMinutes(login.retryAfter) };
        }
        return { status: "failed", failure: problemFailure(login) };
      }
      const me = await adminClient.getMe();
      if (!me.ok) return { status: "failed", failure: problemFailure(me) };
      dispatch({ type: "meLoaded", me: me.data });
      return { status: "signedIn" };
    } catch (error) {
      const failure = failureFromError(error);
      return { status: "failed", failure: failure ?? { kind: "network" } };
    }
  }, []);

  const signOut = useCallback(async (): Promise<Failure | null> => {
    try {
      const result = await adminClient.logout();
      // 401: the session had already ended; either way nobody is signed in now.
      if (result.ok || result.status === 401) {
        dispatch({ type: "signedOut" });
        return null;
      }
      return problemFailure(result);
    } catch (error) {
      return failureFromError(error) ?? { kind: "network" };
    }
  }, []);

  const retry = useCallback(() => {
    dispatch({ type: "retry" });
    setAttempt((count) => count + 1);
  }, []);

  const permissions = state.me?.permissions ?? null;
  const can = useCallback(
    (permission: AdminOperationPermission) => canAccess(permissions, permission),
    [permissions],
  );

  const value = useMemo(
    () => ({ state, can, signIn, signOut, reloadMe, retry }),
    [state, can, signIn, signOut, reloadMe, retry],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error("useSession must be used inside SessionProvider.");
  return value;
}
