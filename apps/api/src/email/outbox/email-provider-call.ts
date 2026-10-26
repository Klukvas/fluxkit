import {
  EMAIL_CODE_PATTERN,
  emailProviderFailure,
  type EmailProviderFailure,
  type EmailProviderPort,
  type EmailSendOptions,
  type OutgoingEmail,
} from "@fluxkit/core";

/** How one `send` ended, from the API's side. Never carries the provider's message text. */
export type EmailCallOutcome =
  | { readonly kind: "ok"; readonly providerMessageId: string }
  /** A typed failure, rebuilt through core `emailProviderFailure` (a provider cannot pass a message off as a code). */
  | { readonly kind: "failed"; readonly failure: EmailProviderFailure }
  /** No answer within the API's limit: the call was aborted. The mail may have been accepted. */
  | { readonly kind: "timed_out" }
  /** The provider threw or answered something that is not a result. The mail may have been accepted. */
  | { readonly kind: "threw"; readonly errorName: string };

/** An error's class name when it is a short identifier, else `Error`: never the message, which may echo an address. */
function errorNameOf(error: unknown): string {
  const name = error instanceof Error ? error.constructor.name : "NonError";
  return /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) ? name : "Error";
}

/**
 * Calls `provider.send` with an abort signal that fires after `timeoutMs`, OUTSIDE any transaction (the caller holds no
 * connection while it runs; the shape of the shipping `callProvider`). A provider that ignores the signal is not waited
 * for: the outcome is `timed_out` as soon as the signal fires and a late answer is dropped.
 */
export async function callEmailProvider(
  provider: EmailProviderPort,
  message: OutgoingEmail,
  options: EmailSendOptions,
  timeoutMs: number,
): Promise<EmailCallOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timed_out">((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error("The email provider call timed out"));
      resolve("timed_out");
    }, timeoutMs);
  });
  let started: Promise<unknown>;
  try {
    started = provider.send(message, options, controller.signal);
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
    const result = answer as {
      ok?: unknown;
      value?: { providerMessageId?: unknown };
      reason?: unknown;
      providerCodes?: unknown;
      retryAfterSeconds?: unknown;
      quotaPeriod?: unknown;
    } | null;
    if (typeof result !== "object" || result === null || typeof result.ok !== "boolean") {
      return { kind: "threw", errorName: "MalformedProviderResult" };
    }
    if (result.ok) {
      const id = result.value?.providerMessageId;
      return typeof id === "string" && EMAIL_CODE_PATTERN.test(id)
        ? { kind: "ok", providerMessageId: id }
        : { kind: "threw", errorName: "MalformedProviderResult" };
    }
    const failure = emailProviderFailure(result.reason as EmailProviderFailure["reason"], {
      providerCodes: result.providerCodes as readonly string[],
      ...(result.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: result.retryAfterSeconds as number }),
      ...(result.quotaPeriod === undefined
        ? {}
        : { quotaPeriod: result.quotaPeriod as EmailProviderFailure["quotaPeriod"] & string }),
    });
    return { kind: "failed", failure };
  } catch (error) {
    if (controller.signal.aborted) {
      return { kind: "timed_out" };
    }
    return {
      kind: "threw",
      errorName: error instanceof RangeError ? "MalformedProviderResult" : errorNameOf(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The failure the record step works with: a typed failure as answered; a timeout or a thrown error is `unavailable`
 * (ADR 0031 decision 6: it may have sent, so it is retried with the SAME idempotency key), with a code that says which.
 */
export function failureOfCall(
  outcome: Exclude<EmailCallOutcome, { kind: "ok" }>,
): EmailProviderFailure {
  switch (outcome.kind) {
    case "failed":
      return outcome.failure;
    case "timed_out":
      return emailProviderFailure("unavailable", { providerCodes: ["timeout"] });
    case "threw":
      return emailProviderFailure("unavailable", { providerCodes: [outcome.errorName] });
  }
}
