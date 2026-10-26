import type { StoreClient, StoreResult } from "@fluxkit/api-client";
import { failureFromResult, failureFromThrown, type Failure } from "./failure";

/**
 * The three calls of the emailed-link flows of the account (email plan step 10; ADR 0031): ask for a reset link, set a new
 * password with the token of a link, confirm an address with the token of a link, and ask for a new verification link.
 * Each answers with an OUTCOME the page maps to a state; no outcome carries the token, a password, an address or any text
 * of the API (`Failure` holds message keys only).
 *
 * Rules kept here, not in the views:
 * - The reset request is NEUTRAL: any accepted answer is `sent`, whatever its body or headers say. The API answers
 *   identically for known and unknown addresses, and the storefront must not invent a difference either.
 * - Every token problem is ONE state (`invalid`): the API answers `400` at `token` for an unknown, used, expired or
 *   replaced token, and the page does not tell them apart.
 * - `404` is `unavailable` (no mail provider), never an error: the pages show "not available" instead.
 * - The token travels in the POST body only, never in a URL or a header.
 */

export type RequestResetOutcome =
  { status: "sent" } | { status: "unavailable" } | { status: "failed"; failure: Failure };

export type ConfirmResetOutcome =
  | { status: "done" }
  | { status: "invalid" }
  | { status: "unavailable" }
  | { status: "failed"; failure: Failure };

export type ConfirmEmailOutcome =
  | { status: "verified" }
  | { status: "invalid" }
  | { status: "unavailable" }
  | { status: "failed"; failure: Failure };

export type ResendOutcome =
  | { status: "sent" }
  | { status: "alreadyVerified" }
  | { status: "unavailable" }
  | { status: "signedOut" }
  | { status: "failed"; failure: Failure };

type EmailClient = Pick<
  StoreClient,
  | "requestPasswordReset"
  | "confirmPasswordReset"
  | "confirmEmailVerification"
  | "requestEmailVerification"
>;

export interface AccountEmailFlows {
  requestPasswordReset(input: { email: string; locale: string }): Promise<RequestResetOutcome>;
  confirmPasswordReset(token: string, newPassword: string): Promise<ConfirmResetOutcome>;
  /** One request per token while it is in flight and after it was settled (`verified`, `invalid`, `unavailable`); a failure may be retried. */
  confirmEmail(token: string): Promise<ConfirmEmailOutcome>;
  resendVerification(): Promise<ResendOutcome>;
}

const NO_STORE = { fetchOptions: { cache: "no-store" } } as const;

type Answer<T> = { result: StoreResult<T> } | { failure: Failure };

async function ask<T>(request: () => Promise<StoreResult<T>>): Promise<Answer<T>> {
  try {
    return { result: await request() };
  } catch (error) {
    // A network failure, a timeout and an unreadable answer are retryable; an abort or a bug is rethrown.
    return { failure: failureFromThrown(error) };
  }
}

/** A `400` that names the `token` field: the one answer for every token problem. */
function isTokenProblem(result: {
  status: number;
  problem: { errors?: { path: string }[] };
}): boolean {
  return (
    result.status === 400 && (result.problem.errors ?? []).some((error) => error.path === "token")
  );
}

export function createAccountEmailFlows(client: EmailClient): AccountEmailFlows {
  const inFlight = new Map<string, Promise<unknown>>();
  const settled = new Map<string, ConfirmEmailOutcome>();

  /** A double submit joins the request in flight instead of sending a second one. */
  function once<T>(name: string, run: () => Promise<T>): Promise<T> {
    const running = inFlight.get(name);
    if (running !== undefined) return running as Promise<T>;
    const promise = run().finally(() => {
      inFlight.delete(name);
    });
    inFlight.set(name, promise);
    return promise;
  }

  return {
    requestPasswordReset: (input) =>
      once("requestPasswordReset", async () => {
        const answer = await ask(() => client.requestPasswordReset(input, NO_STORE));
        if ("failure" in answer) return { status: "failed", failure: answer.failure } as const;
        const { result } = answer;
        // The body of an accepted answer is not read at all: the outcome cannot depend on it.
        if (result.ok) return { status: "sent" } as const;
        if (result.status === 404) return { status: "unavailable" } as const;
        return { status: "failed", failure: failureFromResult(result) } as const;
      }),

    confirmPasswordReset: (token, newPassword) =>
      once("confirmPasswordReset", async () => {
        const answer = await ask(() =>
          client.confirmPasswordReset({ token, newPassword }, NO_STORE),
        );
        if ("failure" in answer) return { status: "failed", failure: answer.failure } as const;
        const { result } = answer;
        if (result.ok) return { status: "done" } as const;
        if (isTokenProblem(result)) return { status: "invalid" } as const;
        if (result.status === 404) return { status: "unavailable" } as const;
        return { status: "failed", failure: failureFromResult(result) } as const;
      }),

    confirmEmail(token) {
      const known = settled.get(token);
      if (known !== undefined) return Promise.resolve(known);
      return once(`confirmEmail:${token}`, async () => {
        const answer = await ask(() => client.confirmEmailVerification({ token }, NO_STORE));
        if ("failure" in answer) return { status: "failed", failure: answer.failure } as const;
        const { result } = answer;
        let outcome: ConfirmEmailOutcome;
        if (result.ok) outcome = { status: "verified" };
        else if (isTokenProblem(result)) outcome = { status: "invalid" };
        else if (result.status === 404) outcome = { status: "unavailable" };
        else return { status: "failed", failure: failureFromResult(result) } as const;
        settled.set(token, outcome);
        return outcome;
      });
    },

    resendVerification: () =>
      once("resendVerification", async () => {
        const answer = await ask(() => client.requestEmailVerification(NO_STORE));
        if ("failure" in answer) return { status: "failed", failure: answer.failure } as const;
        const { result } = answer;
        if (result.ok) return { status: "sent" } as const;
        if (result.status === 401) return { status: "signedOut" } as const;
        if (result.status === 404) return { status: "unavailable" } as const;
        if (result.status === 409 && result.problem.rule === "already_verified") {
          return { status: "alreadyVerified" } as const;
        }
        return { status: "failed", failure: failureFromResult(result) } as const;
      }),
  };
}
