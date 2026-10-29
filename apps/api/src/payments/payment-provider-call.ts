import {
  paymentProviderFailure,
  PAYMENT_PROVIDER_TIMEOUT_MS,
  type PaymentProviderResult,
} from "@fluxkit/core";

/** How a payment provider call ended, from the API's side. Never carries a provider message or an error text. */
export interface PaymentCallOutcome<T> {
  /** The result the flows decide on: a timeout, a thrown error and a malformed answer are `unavailable` (decision 3). */
  readonly result: PaymentProviderResult<T>;
  /** For log lines: `ok`, `failed`, `timed_out` or `threw` (with the error's class name only). */
  readonly kind: "ok" | "failed" | "timed_out" | "threw";
  readonly errorName?: string;
}

function errorNameOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

function unavailable<T>(kind: "timed_out" | "threw", errorName?: string): PaymentCallOutcome<T> {
  return {
    result: paymentProviderFailure("unavailable"),
    kind,
    ...(errorName === undefined ? {} : { errorName }),
  };
}

/**
 * Calls a payment provider with an `AbortSignal` that fires after `timeoutMs` (ADR 0032 decision 3: the API owns the
 * timeout, 10 s), OUTSIDE any transaction. A provider that ignores the signal is not waited for. A timeout, a thrown
 * error and an answer that is not a `PaymentProviderResult` MAY have reached the provider, so they become `unavailable`
 * (a create then is `create_unknown`, a refund `unknown`); a failure is rebuilt with `paymentProviderFailure`, so a
 * provider cannot pass message text off as a code (a malformed one is `unavailable` too).
 */
export async function callPaymentProvider<T>(
  work: (signal: AbortSignal) => Promise<PaymentProviderResult<T>>,
  timeoutMs: number = PAYMENT_PROVIDER_TIMEOUT_MS,
): Promise<PaymentCallOutcome<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timed_out">((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error("The payment provider call timed out"));
      resolve("timed_out");
    }, timeoutMs);
  });
  let started: Promise<PaymentProviderResult<T>>;
  try {
    started = work(controller.signal);
  } catch (error) {
    clearTimeout(timer);
    return unavailable("threw", errorNameOf(error));
  }
  // A late rejection of an abandoned call must not become an unhandled rejection.
  started.catch(() => undefined);
  try {
    const answer = await Promise.race([started, timedOut]);
    if (answer === "timed_out") {
      return unavailable("timed_out");
    }
    if (typeof answer !== "object" || answer === null || typeof answer.ok !== "boolean") {
      return unavailable("threw", "MalformedProviderResult");
    }
    if (answer.ok) {
      return { result: answer, kind: "ok" };
    }
    try {
      const checked = paymentProviderFailure(answer.reason, {
        providerCodes: answer.providerCodes,
        ...(answer.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: answer.retryAfterSeconds }),
      });
      return { result: checked, kind: "failed" };
    } catch {
      return unavailable("threw", "MalformedProviderFailure");
    }
  } catch (error) {
    if (controller.signal.aborted) {
      return unavailable("timed_out");
    }
    return unavailable("threw", errorNameOf(error));
  } finally {
    clearTimeout(timer);
  }
}

/** A short, safe description for a log line: the kind, the reason and the provider codes. */
export function describePaymentCall(outcome: PaymentCallOutcome<unknown>): string {
  if (outcome.kind === "ok") {
    return "ok";
  }
  if (outcome.kind === "timed_out") {
    return "timed_out";
  }
  if (outcome.kind === "threw") {
    return `threw error=${outcome.errorName ?? "unknown"}`;
  }
  const { result } = outcome;
  return result.ok
    ? "ok"
    : `failed reason=${result.reason} codes=${result.providerCodes.join(",") || "none"}`;
}
