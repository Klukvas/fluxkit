import { describe, expect, it } from "vitest";
import type { ProviderAbortSignal } from "../shipping/provider-port.js";
import { validateOutgoingEmail } from "./outgoing.js";
import {
  checkEmailProviderContract,
  type EmailProviderContractScenario,
  type ObservedEmailRequest,
} from "./provider-contract.js";
import {
  emailProviderFailure,
  emailProviderOk,
  type EmailProviderPort,
  type OutgoingEmail,
} from "./provider-port.js";

function signal(aborted: boolean): ProviderAbortSignal {
  const reason = new Error("aborted");
  return {
    aborted,
    reason: aborted ? reason : undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    throwIfAborted: () => {
      if (aborted) {
        throw reason;
      }
    },
  };
}

const MESSAGE: OutgoingEmail = {
  from: { address: "shop@mail.example.com", displayName: "Fluxkit Demo Shop" },
  to: { address: "shopper@example.com", displayName: null },
  subject: "Order FK-12345 is paid",
  html: "<p>Order FK-12345 is paid</p>",
  text: "Order FK-12345 is paid",
  tags: { category: "order" },
};

const REFUSED_ADDRESS = "bounce@example.com";

interface Probe {
  provider: EmailProviderPort;
  scenario: EmailProviderContractScenario;
}

/** A small provider over an in-memory "service" that keeps every rule; each spec breaks one. */
function goodProbe(overrides: Partial<EmailProviderPort> = {}): Probe {
  const requests: ObservedEmailRequest[] = [];
  let counter = 0;
  const provider: EmailProviderPort = {
    code: "contract_probe",
    capabilities: { idempotencyKeys: true, maxRecipients: 50 },
    send(message, options, s) {
      if (s.aborted) {
        return Promise.resolve(emailProviderFailure("not_sent", { providerCodes: ["aborted"] }));
      }
      if (validateOutgoingEmail(message, options.idempotencyKey).length > 0) {
        return Promise.resolve(emailProviderFailure("not_sent", { providerCodes: ["invalid"] }));
      }
      requests.push({ idempotencyKey: options.idempotencyKey, recipients: [message.to.address] });
      if (message.to.address === REFUSED_ADDRESS) {
        return Promise.resolve(emailProviderFailure("rejected", { providerCodes: ["422"] }));
      }
      counter += 1;
      return Promise.resolve(emailProviderOk({ providerMessageId: `msg-${String(counter)}` }));
    },
    ...overrides,
  };
  return {
    provider,
    scenario: {
      message: MESSAGE,
      refusedMessage: { ...MESSAGE, to: { address: REFUSED_ADDRESS, displayName: null } },
      observed: () => [...requests],
      liveSignal: () => signal(false),
      abortedSignal: () => signal(true),
    },
  };
}

async function violationsOf(probe: Probe): Promise<string[]> {
  return checkEmailProviderContract(probe.provider, probe.scenario);
}

describe("checkEmailProviderContract", () => {
  it("finds nothing wrong with a provider that keeps every rule", async () => {
    expect(await violationsOf(goodProbe())).toEqual([]);
  });

  it("reports a bad code and bad capabilities", async () => {
    const probe = goodProbe({
      code: "Contract Probe",
      capabilities: { idempotencyKeys: "yes", maxRecipients: 0 } as never,
    });
    expect(await violationsOf(probe)).toEqual(
      expect.arrayContaining([
        "code breaks EMAIL_PROVIDER_CODE_PATTERN",
        "capability idempotencyKeys is not a boolean",
        "capability maxRecipients is not a whole number of at least 1",
      ]),
    );
  });

  it("reports an idempotency key that is not passed through", async () => {
    const probe = goodProbe();
    const send = probe.provider.send.bind(probe.provider);
    probe.provider = {
      ...probe.provider,
      send: (message, _options, s) => send(message, { idempotencyKey: "fixed" }, s),
    };
    expect(await violationsOf(probe)).toContain(
      "send did not pass the idempotency key through unchanged",
    );
  });

  it("reports a provider that sends to more than the one recipient", async () => {
    const requests: ObservedEmailRequest[] = [];
    const probe = goodProbe({
      send: (message, options, s) => {
        if (s.aborted || validateOutgoingEmail(message, options.idempotencyKey).length > 0) {
          return Promise.resolve(emailProviderFailure("not_sent"));
        }
        requests.push({
          idempotencyKey: options.idempotencyKey,
          recipients: [message.to.address, "copy@example.com"],
        });
        return Promise.resolve(emailProviderOk({ providerMessageId: "m" }));
      },
    });
    probe.scenario = { ...probe.scenario, refusedMessage: null, observed: () => [...requests] };
    expect(await violationsOf(probe)).toContain(
      "send did not address exactly the one recipient of the message",
    );
  });

  it("reports a provider that retries on its own (two requests for one send)", async () => {
    const requests: ObservedEmailRequest[] = [];
    const probe = goodProbe({
      send: (message, options, s) => {
        if (s.aborted || validateOutgoingEmail(message, options.idempotencyKey).length > 0) {
          return Promise.resolve(emailProviderFailure("not_sent"));
        }
        const request = {
          idempotencyKey: options.idempotencyKey,
          recipients: [message.to.address],
        };
        requests.push(request, request);
        return Promise.resolve(emailProviderOk({ providerMessageId: "m" }));
      },
    });
    probe.scenario = { ...probe.scenario, refusedMessage: null, observed: () => [...requests] };
    expect(await violationsOf(probe)).toContain("one send made 2 requests to the service, not 1");
  });

  it("reports message text in a failure code and a provider message id that is text", async () => {
    const probe = goodProbe({
      send: () =>
        Promise.resolve({
          ok: false as const,
          reason: "rejected" as const,
          providerCodes: ["The address shopper@example.com is invalid"],
        }),
    });
    expect(await violationsOf(probe)).toEqual(
      expect.arrayContaining([
        "send did not accept the scenario's message with a typed success",
        "send answered a refused message with something other than a typed failure",
        "send did not answer not_sent for a message that fails validateOutgoingEmail",
        "send answered an already aborted signal with something other than not_sent",
      ]),
    );
    const textId = goodProbe({
      send: () => Promise.resolve(emailProviderOk({ providerMessageId: "id with spaces" })),
    });
    expect(await violationsOf(textId)).toContain(
      "send answered a providerMessageId that breaks EMAIL_CODE_PATTERN",
    );
  });

  it("reports a provider that calls the service for an invalid message or an aborted signal", async () => {
    const requests: ObservedEmailRequest[] = [];
    const probe = goodProbe({
      send: (message, options) => {
        requests.push({ idempotencyKey: options.idempotencyKey, recipients: [message.to.address] });
        return Promise.resolve(emailProviderFailure("unavailable"));
      },
    });
    probe.scenario = { ...probe.scenario, observed: () => [...requests] };
    expect(await violationsOf(probe)).toEqual(
      expect.arrayContaining([
        "send made a request for a message that fails validateOutgoingEmail",
        "send made a request with an already aborted signal",
      ]),
    );
  });

  it("records a throwing provider as a violation instead of throwing itself", async () => {
    const probe = goodProbe({
      send: () => Promise.reject(new TypeError("boom")),
    });
    const violations = await violationsOf(probe);
    expect(violations).toContain("send threw (TypeError)");
  });

  it("accepts a provider that rejects the promise for an aborted signal", async () => {
    const probe = goodProbe();
    const send = probe.provider.send.bind(probe.provider);
    probe.provider = {
      ...probe.provider,
      send: (message, options, s) => {
        s.throwIfAborted();
        return send(message, options, s);
      },
    };
    expect(await violationsOf(probe)).toEqual([]);
  });

  it("reports a scenario message that is not valid itself", async () => {
    const probe = goodProbe();
    probe.scenario = { ...probe.scenario, message: { ...MESSAGE, subject: "a\r\nb" } };
    expect(await violationsOf(probe)).toContain(
      "the scenario's message does not pass validateOutgoingEmail (fix the scenario)",
    );
  });
});
