import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseMonobankEnv } from "./config.js";
import { createInput, live, providerOn, REFUND_ID } from "./test-support/fixtures.js";
import {
  STUB_TOKEN,
  startStubMonobank,
  type StubAnswer,
  type StubMonobank,
} from "./test-support/stub-monobank.js";

/*
 * The token never reaches a log line, a result or a thrown message, whatever Monobank answers: its texts can echo it,
 * so the plugin keeps only documented error codes and statuses (ADR 0032 decisions 3 and 14). Not even a fragment: every
 * 8-character piece of the token is forbidden. Card data beyond the last four digits and bank texts are forbidden too.
 */
describe("no token, card mask or provider text in logs or results", () => {
  let stub: StubMonobank;

  beforeEach(async () => {
    stub = await startStubMonobank();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("holds for successes and every kind of failure of every operation", async () => {
    const { provider, logger } = providerOn(stub);
    const seen: string[] = [];
    const capture = async (work: () => Promise<unknown>) => {
      try {
        seen.push(JSON.stringify(await work()));
      } catch (error) {
        seen.push(`${(error as Error).name}: ${(error as Error).message}`);
      }
    };
    const refund = (providerPaymentId: string) =>
      provider.refund(
        {
          providerPaymentId,
          refundId: REFUND_ID,
          amount: { amount: 100, currency: "UAH" },
          full: false,
        },
        live(),
      );
    const all = (providerPaymentId: string) => [
      () => provider.createPayment(createInput(), live()),
      () => provider.getPayment(providerPaymentId, live()),
      () => provider.invalidatePayment(providerPaymentId, live()),
      () => refund(providerPaymentId),
      () => provider.verifyWebhook(stub.webhookFor(providerPaymentId), live()),
    ];

    // Successes, including a paid invoice with a full card mask in the answer.
    const created = await provider.createPayment(createInput(), live());
    const invoiceId = created.ok ? created.value.providerPaymentId : "p2_stub000001";
    stub.pay(invoiceId, { system: "visa", maskedPan: "537541******7731" });
    for (const call of all(invoiceId)) {
      await capture(call);
    }
    // A wrong token: Monobank's 403 text echoes what was sent.
    const wrong = providerOn(stub, { token: `${STUB_TOKEN}X` }).provider;
    await capture(() => wrong.createPayment(createInput(), live()));

    // Then the service echoes the token everywhere, under every status.
    const echo = `${STUB_TOKEN} 537541******7731 Недостатньо коштів`;
    for (const status of [200, 201, 400, 403, 404, 405, 409, 422, 429, 500, 503]) {
      const answers: StubAnswer[] = [
        {
          status,
          json: {
            errCode: echo,
            errText: echo,
            invoiceId: echo,
            pageUrl: echo,
            status: echo,
            key: echo,
          },
          headers: { "retry-after": echo.slice(0, 40), "x-echo": STUB_TOKEN },
        },
        { status, json: { errCode: "BAD_REQUEST", errText: echo } },
        { status, body: echo, headers: { "content-type": "text/plain" } },
      ];
      for (const answer of answers) {
        stub.override(() => answer);
        for (const call of all(invoiceId)) {
          await capture(call);
        }
      }
    }
    stub.override(undefined);

    // Configuration errors.
    await capture(() => Promise.resolve(parseMonobankEnv({ MONOBANK_TOKEN: `${STUB_TOKEN} x` })));
    await capture(() =>
      Promise.resolve(parseMonobankEnv({ MONOBANK_TOKEN: STUB_TOKEN.slice(0, 12) })),
    );

    const everything = [...logger.lines, ...seen].join("\n");
    expect(logger.lines.length).toBeGreaterThan(50);
    expect(everything).not.toContain(STUB_TOKEN);
    for (let start = 0; start + 8 <= STUB_TOKEN.length; start += 1) {
      const fragment = STUB_TOKEN.slice(start, start + 8);
      expect(everything, `fragment ${fragment}`).not.toContain(fragment);
    }
    expect(everything).not.toContain("537541");
    expect(everything).not.toContain("******");
    expect(everything).not.toContain("коштів");
    // Nor where the stub lives, nor the header name with a value.
    expect(everything).not.toContain("127.0.0.1");
    expect(everything.toLowerCase()).not.toContain("x-token:");
  });

  it("logs a refused token once per process as an error naming the variable, never the value", async () => {
    const { provider, logger } = providerOn(stub, { token: "uAnotherInventedToken_000000" });
    for (let index = 0; index < 3; index += 1) {
      await provider.getPayment("p2_stub000001", live());
    }
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toMatch(/check MONOBANK_TOKEN/);
    expect(logger.lines.join("\n")).not.toContain("uAnotherInventedToken");
    expect(logger.lines).toHaveLength(3);
  });
});
