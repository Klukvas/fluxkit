import type { ProviderAbortSignal } from "../shipping/provider-port.js";
import { EMAIL_CODE_PATTERN, EMAIL_LIMITS, EMAIL_PROVIDER_CODE_PATTERN } from "./limits.js";
import { validateOutgoingEmail } from "./outgoing.js";
import {
  EMAIL_PROVIDER_FAILURE_REASONS,
  EMAIL_QUOTA_PERIODS,
  type EmailProviderPort,
  type EmailProviderResult,
  type OutgoingEmail,
} from "./provider-port.js";

/*
 * The reusable email provider contract check (ADR 0031 decision 3: "a reusable contract suite in core runs in both
 * provider packages"; the `checkShippingProviderContract` pattern). Pure and framework-free: it calls the provider with a
 * scenario the provider's own spec supplies (a stub service, an observer of what reached it) and returns every rule the
 * answers break, as plain sentences. A provider spec asserts that the list is empty.
 */

/** What reached the service for one request, as the provider spec's stub records it. */
export interface ObservedEmailRequest {
  /** The idempotency key the service received, `null` when none. */
  readonly idempotencyKey: string | null;
  /** The recipient addresses of the request, as the service received them. */
  readonly recipients: readonly string[];
}

export interface EmailProviderContractScenario {
  /** A mail the stub accepts (it passes `validateOutgoingEmail`). */
  readonly message: OutgoingEmail;
  /** A mail the stub refuses (a recipient it answers with a refusal), or `null` when the stub cannot refuse one. */
  readonly refusedMessage: OutgoingEmail | null;
  /** Every request that reached the stub service so far, oldest first. */
  readonly observed: () => readonly ObservedEmailRequest[];
  /** A signal that never fires, and one that has already fired (core has no AbortController). */
  readonly liveSignal: () => ProviderAbortSignal;
  readonly abortedSignal: () => ProviderAbortSignal;
}

type Violations = string[];

const KEY_A = "00000000-0000-4000-8000-00000000000a";
const KEY_B = "00000000-0000-4000-8000-00000000000b";
const KEY_C = "00000000-0000-4000-8000-00000000000c";
const KEY_D = "00000000-0000-4000-8000-00000000000d";

/** A well-formed result: success with a value, or a failure with a known reason and codes (not text). */
function isResult(value: unknown): value is EmailProviderResult<unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const result = value as Record<string, unknown>;
  if (result.ok === true) {
    return "value" in result;
  }
  const retryAfter = result.retryAfterSeconds;
  const quota = result.quotaPeriod;
  return (
    result.ok === false &&
    EMAIL_PROVIDER_FAILURE_REASONS.includes(result.reason as never) &&
    Array.isArray(result.providerCodes) &&
    result.providerCodes.length <= EMAIL_LIMITS.maxProviderCodes &&
    result.providerCodes.every(
      (code: unknown) => typeof code === "string" && EMAIL_CODE_PATTERN.test(code),
    ) &&
    (retryAfter === undefined ||
      (Number.isSafeInteger(retryAfter) && (retryAfter as number) >= 0)) &&
    (quota === undefined ||
      (result.reason === "quota_exceeded" && EMAIL_QUOTA_PERIODS.includes(quota as never)))
  );
}

async function attempt<T>(
  violations: Violations,
  operation: string,
  work: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await work();
  } catch (error) {
    violations.push(
      `${operation} threw (${error instanceof Error ? error.constructor.name : typeof error})`,
    );
    return undefined;
  }
}

/**
 * Every rule of `EmailProviderPort` the provider breaks under `scenario`, as sentences; empty when it keeps them all.
 * Sends up to four mails to the stub: the accepted one (twice, with two keys), the refused one, and nothing for a
 * malformed or aborted one.
 */
export async function checkEmailProviderContract(
  provider: EmailProviderPort,
  scenario: EmailProviderContractScenario,
): Promise<string[]> {
  const violations: Violations = [];
  const live = scenario.liveSignal;

  // Identity and capabilities.
  if (typeof provider.code !== "string" || !EMAIL_PROVIDER_CODE_PATTERN.test(provider.code)) {
    violations.push("code breaks EMAIL_PROVIDER_CODE_PATTERN");
  }
  const capabilities = provider.capabilities as unknown as
    Record<string, unknown> | null | undefined;
  if (typeof capabilities?.idempotencyKeys !== "boolean") {
    violations.push("capability idempotencyKeys is not a boolean");
  }
  const maxRecipients = capabilities?.maxRecipients;
  if (!(Number.isSafeInteger(maxRecipients) && (maxRecipients as number) >= 1)) {
    violations.push("capability maxRecipients is not a whole number of at least 1");
  }
  if (validateOutgoingEmail(scenario.message, KEY_A).length > 0) {
    violations.push(
      "the scenario's message does not pass validateOutgoingEmail (fix the scenario)",
    );
  }

  // An accepted send: a typed success, the key and exactly one recipient reached the service.
  for (const key of [KEY_A, KEY_B]) {
    const before = scenario.observed().length;
    const sent = await attempt(violations, "send", () =>
      provider.send(scenario.message, { idempotencyKey: key }, live()),
    );
    if (sent === undefined) {
      continue;
    }
    if (!isResult(sent) || !sent.ok) {
      violations.push("send did not accept the scenario's message with a typed success");
      continue;
    }
    const value = sent.value as { providerMessageId?: unknown } | null;
    if (
      typeof value?.providerMessageId !== "string" ||
      !EMAIL_CODE_PATTERN.test(value.providerMessageId)
    ) {
      violations.push("send answered a providerMessageId that breaks EMAIL_CODE_PATTERN");
    }
    const requests = scenario.observed().slice(before);
    if (requests.length !== 1) {
      violations.push(`one send made ${String(requests.length)} requests to the service, not 1`);
      continue;
    }
    const [request] = requests as [ObservedEmailRequest];
    if (provider.capabilities.idempotencyKeys && request.idempotencyKey !== key) {
      violations.push("send did not pass the idempotency key through unchanged");
    }
    if (request.recipients.length !== 1 || request.recipients[0] !== scenario.message.to.address) {
      violations.push("send did not address exactly the one recipient of the message");
    }
  }

  // A refused send: a typed failure with codes, never a success.
  if (scenario.refusedMessage !== null) {
    const refused = await attempt(violations, "send (refused)", () =>
      provider.send(scenario.refusedMessage as OutgoingEmail, { idempotencyKey: KEY_C }, live()),
    );
    if (refused !== undefined && !(isResult(refused) && !refused.ok)) {
      violations.push("send answered a refused message with something other than a typed failure");
    }
  }

  // A message that cannot be valid (two recipients in one field): not_sent, and nothing reached the service.
  const malformed: OutgoingEmail = {
    ...scenario.message,
    to: { address: `${scenario.message.to.address},extra@example.com`, displayName: null },
  };
  const beforeMalformed = scenario.observed().length;
  const local = await attempt(violations, "send (malformed)", () =>
    provider.send(malformed, { idempotencyKey: KEY_D }, live()),
  );
  if (local !== undefined && !(isResult(local) && !local.ok && local.reason === "not_sent")) {
    violations.push("send did not answer not_sent for a message that fails validateOutgoingEmail");
  }
  if (scenario.observed().length !== beforeMalformed) {
    violations.push("send made a request for a message that fails validateOutgoingEmail");
  }

  // An already aborted signal: a rejection or `not_sent` (nothing left the process), and no request.
  const beforeAborted = scenario.observed().length;
  let aborted: unknown;
  let abortedThrew = false;
  try {
    aborted = await provider.send(
      scenario.message,
      { idempotencyKey: KEY_D },
      scenario.abortedSignal(),
    );
  } catch {
    abortedThrew = true;
  }
  if (!abortedThrew && !(isResult(aborted) && !aborted.ok && aborted.reason === "not_sent")) {
    violations.push("send answered an already aborted signal with something other than not_sent");
  }
  if (scenario.observed().length !== beforeAborted) {
    violations.push("send made a request with an already aborted signal");
  }
  return violations;
}
