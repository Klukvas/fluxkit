import { providerFailure, type ProviderFailureReason, type ProviderResult } from "@fluxkit/core";

/** How a provider call ended, from the API's side. Never carries the provider's message text. */
export type ProviderCallOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** The provider answered a typed failure (reason and codes re-checked by `providerFailure`). */
  | {
      readonly kind: "failed";
      readonly reason: ProviderFailureReason;
      readonly providerCodes: readonly string[];
    }
  /** No answer within the API's limit: the call was aborted. For a write, whether it took effect is unknown. */
  | { readonly kind: "timed_out" }
  /**
   * The provider threw (a network error, a bug) or answered something that is not a `ProviderResult`. For a write, whether
   * it took effect is unknown. `errorName` is the error's class name only: its message may echo a name, a phone or a key.
   */
  | { readonly kind: "threw"; readonly errorName: string };

function errorNameOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

/**
 * Calls a provider with an `AbortSignal` that fires after `timeoutMs`, OUTSIDE any transaction (the callers hold no
 * connection while it runs). A provider that ignores the signal is not waited for: the outcome is `timed_out` as soon as
 * the signal fires, and a late answer or rejection is dropped. A failure result is rebuilt with `providerFailure`, so a
 * provider cannot pass message text off as a code (a malformed one surfaces as `threw`).
 */
export async function callProvider<T>(
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<ProviderResult<T>>,
): Promise<ProviderCallOutcome<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timed_out">((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error("The provider call timed out"));
      resolve("timed_out");
    }, timeoutMs);
  });
  let started: Promise<ProviderResult<T>>;
  try {
    started = work(controller.signal);
  } catch (error) {
    clearTimeout(timer);
    return { kind: "threw", errorName: errorNameOf(error) };
  }
  // A late rejection of an abandoned call must not become an unhandled rejection.
  started.catch(() => undefined);
  try {
    const answer = await Promise.race([started, timedOut]);
    if (answer === "timed_out") {
      return { kind: "timed_out" };
    }
    if (typeof answer !== "object" || answer === null || typeof answer.ok !== "boolean") {
      return { kind: "threw", errorName: "MalformedProviderResult" };
    }
    if (answer.ok) {
      return { kind: "ok", value: answer.value };
    }
    const checked = providerFailure(answer.reason, answer.providerCodes);
    if (checked.ok) {
      throw new Error("providerFailure returned a success");
    }
    return { kind: "failed", reason: checked.reason, providerCodes: checked.providerCodes };
  } catch (error) {
    if (controller.signal.aborted) {
      return { kind: "timed_out" };
    }
    return { kind: "threw", errorName: errorNameOf(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** A short, safe description of an outcome for a log line: the kind, the reason and the carrier codes. */
export function describeOutcome(outcome: ProviderCallOutcome<unknown>): string {
  switch (outcome.kind) {
    case "ok":
      return "ok";
    case "failed":
      return `failed reason=${outcome.reason} codes=${outcome.providerCodes.join(",") || "none"}`;
    case "timed_out":
      return "timed_out";
    case "threw":
      return `threw error=${outcome.errorName}`;
  }
}
