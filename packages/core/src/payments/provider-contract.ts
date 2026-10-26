import { isSupportedCurrency } from "../pricing/currency.js";
import type { Money } from "../pricing/money.js";
import type { ProviderAbortSignal } from "../shipping/provider-port.js";
import { bindFact } from "./binding.js";
import { providerPaymentFactProblems } from "./fact.js";
import {
  PAYMENT_CODE_PATTERN,
  PAYMENT_LIMITS,
  PAYMENT_PROVIDER_CODE_PATTERN,
  PROVIDER_PAYMENT_ID_PATTERN,
} from "./limits.js";
import {
  PAYMENT_PROVIDER_FAILURE_REASONS,
  PROVIDER_REFUND_STATUSES,
  type CreatePaymentInput,
  type PaymentProviderPort,
  type PaymentProviderResult,
  type PaymentWebhookInput,
  type ProviderPaymentFact,
} from "./provider-port.js";

/*
 * The reusable payment provider contract check (ADR 0032 decisions 3 and 15: "the contract suite run by `_fake-payment`
 * and `monobank`"; the `checkShippingProviderContract` / `checkEmailProviderContract` pattern). Pure and framework-free:
 * it calls the provider with a scenario the provider's own spec supplies (a stub service that signs webhooks, a payment
 * the stub reports as paid) and returns every rule the answers break, as plain sentences. A provider spec asserts that
 * the list is empty. It checks shapes and port rules only, never a provider's business data.
 */

export interface PaymentProviderContractScenario {
  /** A create the stub accepts (its currency one the provider takes). */
  readonly create: CreatePaymentInput;
  /** A payment the stub reports as succeeded, to refund; `null` when the stub has none (refunds are then not checked). */
  readonly succeededPayment: {
    readonly providerPaymentId: string;
    /** The reference the stub reports for it (an attempt id). */
    readonly reference: string;
    readonly amount: Money;
  } | null;
  /** A well-formed provider id the stub does not know. */
  readonly unknownProviderPaymentId: string;
  /** A correctly signed webhook about `providerPaymentId`, exactly as the provider would send it. */
  readonly webhookFor: (providerPaymentId: string) => PaymentWebhookInput;
  /** A signal that never fires, and one that has already fired (core has no AbortController). */
  readonly liveSignal: () => ProviderAbortSignal;
  readonly abortedSignal: () => ProviderAbortSignal;
}

type Violations = string[];

/** A refund id the suite sends (a uuid, as the API's refund row ids are). */
const CONTRACT_REFUND_ID = "00000000-0000-4000-8000-0000000000f1";

/** An `https` URL with a host, no white space (core has no URL class). */
const HTTPS_URL = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[^\s]*)?$/;

/** A well-formed result: success with a value, or a failure with a known reason and codes (not text). */
function isResult(value: unknown): value is PaymentProviderResult<unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const result = value as Record<string, unknown>;
  if (result.ok === true) {
    return "value" in result;
  }
  const retryAfter = result.retryAfterSeconds;
  return (
    result.ok === false &&
    PAYMENT_PROVIDER_FAILURE_REASONS.includes(result.reason as never) &&
    Array.isArray(result.providerCodes) &&
    result.providerCodes.length <= PAYMENT_LIMITS.maxProviderCodes &&
    result.providerCodes.every(
      (code: unknown) => typeof code === "string" && PAYMENT_CODE_PATTERN.test(code),
    ) &&
    (retryAfter === undefined || (Number.isSafeInteger(retryAfter) && (retryAfter as number) >= 0))
  );
}

/** Runs `work`; a rejection is recorded as a violation and answers `undefined`. */
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

/** The answer as a well-formed result, or a violation and `undefined`. */
function result<T>(
  violations: Violations,
  operation: string,
  answer: PaymentProviderResult<T> | undefined,
): PaymentProviderResult<T> | undefined {
  if (answer === undefined) {
    return undefined;
  }
  if (!isResult(answer)) {
    violations.push(`${operation} did not answer a PaymentProviderResult with codes, not text`);
    return undefined;
  }
  return answer;
}

/** A well-formed fact that binds to `attempt`, or the violations of the one answered. */
function checkFact(
  violations: Violations,
  operation: string,
  fact: unknown,
  attempt: { id: string; providerPaymentId: string; amount: Money },
): fact is ProviderPaymentFact {
  const problems = providerPaymentFactProblems(fact);
  for (const problem of problems) {
    violations.push(`${operation} answered a fact that breaks the port: ${problem}`);
  }
  if (problems.length > 0) {
    return false;
  }
  const bound = bindFact(fact as ProviderPaymentFact, attempt);
  if (!bound.ok) {
    violations.push(
      `${operation} answered a fact that does not bind to the created payment (${bound.reason})`,
    );
    return false;
  }
  return true;
}

/** A copy of `input` whose last body byte is changed. */
function tampered(input: PaymentWebhookInput): PaymentWebhookInput {
  const rawBody = Uint8Array.from(input.rawBody);
  const last = rawBody.length - 1;
  if (last >= 0) {
    rawBody[last] = (rawBody[last] as number) ^ 0x01;
  }
  return { headers: input.headers, rawBody };
}

/**
 * Every rule of `PaymentProviderPort` the provider breaks under `scenario`, as sentences; empty when it keeps them all.
 * Creates one payment, invalidates it (when offered), refunds the scenario's succeeded payment once (partly when the
 * provider takes partial refunds), and checks that the refund is listed under its refund id, the only way a lost refund
 * answer can be settled (decision 13).
 */
export async function checkPaymentProviderContract(
  provider: PaymentProviderPort,
  scenario: PaymentProviderContractScenario,
): Promise<string[]> {
  const violations: Violations = [];
  const live = scenario.liveSignal;

  // Identity and capabilities.
  if (typeof provider.code !== "string" || !PAYMENT_PROVIDER_CODE_PATTERN.test(provider.code)) {
    violations.push("code breaks PAYMENT_PROVIDER_CODE_PATTERN");
  }
  const capabilities = provider.capabilities as unknown as Record<string, unknown> | null;
  const currencies = capabilities?.currencies;
  if (
    !Array.isArray(currencies) ||
    currencies.length === 0 ||
    new Set(currencies).size !== currencies.length ||
    !currencies.every((code: unknown) => isSupportedCurrency(code))
  ) {
    violations.push(
      "capabilities.currencies is not a non-empty list of distinct supported currencies",
    );
  }
  for (const name of ["partialRefunds", "multipleRefunds", "invalidateUnpaid", "webhooks"]) {
    if (typeof capabilities?.[name] !== "boolean") {
      violations.push(`capabilities.${name} is not a boolean`);
    }
  }
  if (Array.isArray(currencies) && !currencies.includes(scenario.create.amount.currency)) {
    violations.push(
      "the scenario's create amount is not in a currency the provider takes (fix the scenario)",
    );
  }

  // Create, then read the payment back.
  const created = result(
    violations,
    "createPayment",
    await attempt(violations, "createPayment", () =>
      provider.createPayment(scenario.create, live()),
    ),
  );
  let providerPaymentId: string | undefined;
  if (created !== undefined) {
    if (!created.ok) {
      violations.push("createPayment did not create a payment for the scenario's request");
    } else {
      const value = created.value as { providerPaymentId?: unknown; redirectUrl?: unknown };
      if (
        typeof value.providerPaymentId !== "string" ||
        !PROVIDER_PAYMENT_ID_PATTERN.test(value.providerPaymentId)
      ) {
        violations.push("createPayment answered a providerPaymentId that breaks the pattern");
      } else {
        providerPaymentId = value.providerPaymentId;
      }
      if (typeof value.redirectUrl !== "string" || !HTTPS_URL.test(value.redirectUrl)) {
        violations.push("createPayment answered a redirectUrl that is not an https URL");
      }
    }
  }
  if (providerPaymentId !== undefined) {
    const createdAttempt = {
      id: scenario.create.paymentId,
      providerPaymentId,
      amount: scenario.create.amount,
    };
    const read = result(
      violations,
      "getPayment",
      await attempt(violations, "getPayment", () =>
        provider.getPayment(providerPaymentId as string, live()),
      ),
    );
    if (read !== undefined) {
      if (!read.ok) {
        violations.push("getPayment did not read the created payment");
      } else {
        checkFact(violations, "getPayment", read.value, createdAttempt);
      }
    }

    // Webhooks: a signed one verifies and binds; a changed byte or a missing signature does not.
    const webhook = scenario.webhookFor(providerPaymentId);
    const verified = result(
      violations,
      "verifyWebhook",
      await attempt(violations, "verifyWebhook", () => provider.verifyWebhook(webhook, live())),
    );
    if (verified !== undefined) {
      if (!verified.ok) {
        violations.push("verifyWebhook refused the scenario's signed webhook");
      } else {
        checkFact(violations, "verifyWebhook", verified.value, createdAttempt);
      }
    }
    const forged = result(
      violations,
      "verifyWebhook (changed body)",
      await attempt(violations, "verifyWebhook (changed body)", () =>
        provider.verifyWebhook(tampered(webhook), live()),
      ),
    );
    if (forged !== undefined && (forged.ok || forged.reason !== "invalid_signature")) {
      violations.push("verifyWebhook accepted a body that was changed after signing");
    }
    const unsigned = result(
      violations,
      "verifyWebhook (no headers)",
      await attempt(violations, "verifyWebhook (no headers)", () =>
        provider.verifyWebhook({ headers: {}, rawBody: webhook.rawBody }, live()),
      ),
    );
    if (unsigned !== undefined && (unsigned.ok || unsigned.reason !== "invalid_signature")) {
      violations.push("verifyWebhook accepted a webhook without its signature header");
    }

    if (provider.capabilities.invalidateUnpaid) {
      const invalidated = result(
        violations,
        "invalidatePayment",
        await attempt(violations, "invalidatePayment", () =>
          provider.invalidatePayment(providerPaymentId as string, live()),
        ),
      );
      if (
        invalidated !== undefined &&
        !(invalidated.ok && typeof invalidated.value.invalidated === "boolean")
      ) {
        violations.push(
          "invalidatePayment did not answer {invalidated: boolean} for an unpaid payment",
        );
      }
    }
  }

  const unknown = result(
    violations,
    "getPayment (unknown)",
    await attempt(violations, "getPayment (unknown)", () =>
      provider.getPayment(scenario.unknownProviderPaymentId, live()),
    ),
  );
  if (unknown !== undefined && (unknown.ok || unknown.reason !== "not_found")) {
    violations.push("getPayment did not answer not_found for an unknown payment");
  }

  // Refund the paid payment once; the refund must be listed under its refund id afterwards.
  const paid = scenario.succeededPayment;
  if (paid !== null) {
    const partial = provider.capabilities.partialRefunds && paid.amount.amount > 1;
    const amount = { amount: partial ? 1 : paid.amount.amount, currency: paid.amount.currency };
    const refunded = result(
      violations,
      "refund",
      await attempt(violations, "refund", () =>
        provider.refund(
          {
            providerPaymentId: paid.providerPaymentId,
            refundId: CONTRACT_REFUND_ID,
            amount,
            full: !partial,
          },
          live(),
        ),
      ),
    );
    if (refunded !== undefined) {
      if (!refunded.ok || !PROVIDER_REFUND_STATUSES.includes(refunded.value.status)) {
        violations.push("refund did not refund the scenario's succeeded payment");
      } else {
        const after = result(
          violations,
          "getPayment (refunded)",
          await attempt(violations, "getPayment (refunded)", () =>
            provider.getPayment(paid.providerPaymentId, live()),
          ),
        );
        if (
          after !== undefined &&
          !(
            after.ok &&
            providerPaymentFactProblems(after.value).length === 0 &&
            after.value.refunds.some(
              (entry) =>
                entry.refundId === CONTRACT_REFUND_ID && entry.amount.amount === amount.amount,
            )
          )
        ) {
          violations.push(
            "getPayment does not list the refund under its refundId (lost refund answers cannot be settled)",
          );
        }
      }
    }
  }

  // An already aborted signal: every operation rejects or answers a failure, never a success.
  const id = providerPaymentId ?? scenario.unknownProviderPaymentId;
  const calls: [string, (signal: ProviderAbortSignal) => Promise<unknown>][] = [
    ["createPayment", (s) => provider.createPayment(scenario.create, s)],
    ["getPayment", (s) => provider.getPayment(id, s)],
    ["invalidatePayment", (s) => provider.invalidatePayment(id, s)],
    [
      "refund",
      (s) =>
        provider.refund(
          {
            providerPaymentId: paid?.providerPaymentId ?? id,
            refundId: CONTRACT_REFUND_ID,
            amount: paid?.amount ?? scenario.create.amount,
            full: true,
          },
          s,
        ),
    ],
    ["verifyWebhook", (s) => provider.verifyWebhook(scenario.webhookFor(id), s)],
  ];
  for (const [operation, call] of calls) {
    let answer: unknown;
    try {
      answer = await call(scenario.abortedSignal());
    } catch {
      continue;
    }
    if (!(isResult(answer) && !answer.ok)) {
      violations.push(`${operation} succeeded with an aborted signal`);
    }
  }
  return violations;
}
