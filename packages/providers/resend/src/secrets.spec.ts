import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseResendEnv } from "./config.js";
import { live, message, MESSAGE_ID, providerOn } from "./test-support/fixtures.js";
import {
  STUB_API_KEY,
  STUB_PERSONAL,
  startStubResend,
  type StubAnswer,
  type StubResend,
} from "./test-support/stub-resend.js";

/*
 * The key, the recipient, the reply-to address and the subject never reach a log line, a result or a thrown message,
 * whatever Resend answers: its texts can echo them, so the plugin keeps only documented error names and statuses (ADR
 * 0031 decisions 3, 8 and 12). Not even a fragment: every 8-character piece of the key and of each personal value is
 * forbidden.
 */
describe("no key, address, subject or provider text in logs or results", () => {
  let stub: StubResend;

  beforeEach(async () => {
    stub = await startStubResend();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("holds for a success and for every kind of failure", async () => {
    const { provider, logger } = providerOn(stub);
    const seen: string[] = [];
    const capture = async (work: () => Promise<unknown>) => {
      try {
        seen.push(JSON.stringify(await work()));
      } catch (error) {
        seen.push(`${(error as Error).name}: ${(error as Error).message}`);
      }
    };
    const send = () => provider.send(message(), { idempotencyKey: MESSAGE_ID }, live());

    await capture(send);
    // The stub's own refusals echo the recipient and part of what was sent.
    stub.setTestingModeOwner(STUB_PERSONAL.owner);
    await capture(() =>
      provider.send(message(), { idempotencyKey: "a3c1e5d2-0000-4000-8000-000000000002" }, live()),
    );
    stub.setTestingModeOwner(undefined);
    await capture(() =>
      provider.send(
        message({ to: { address: STUB_PERSONAL.refused, displayName: null } }),
        { idempotencyKey: "a3c1e5d2-0000-4000-8000-000000000003" },
        live(),
      ),
    );
    await capture(() =>
      providerOn(stub, { apiKey: `${STUB_API_KEY}X` }).provider.send(
        message(),
        { idempotencyKey: MESSAGE_ID },
        live(),
      ),
    );

    // Then the service echoes everything back, in the message AND in the name, under every status.
    const echo = `${STUB_API_KEY} ${STUB_PERSONAL.recipient} ${STUB_PERSONAL.replyTo} ${STUB_PERSONAL.subject}`;
    const names = [
      echo,
      STUB_API_KEY.slice(0, 20),
      STUB_PERSONAL.recipient,
      "validation_error",
      "daily_quota_exceeded",
    ];
    for (const status of [200, 201, 400, 401, 403, 404, 409, 413, 422, 429, 500, 503]) {
      for (const name of names) {
        const answers: StubAnswer[] = [
          {
            status,
            json: { statusCode: status, name, message: echo, error: echo },
            headers: { "retry-after": echo.slice(0, 40), "x-echo": STUB_PERSONAL.recipient },
          },
          { status, body: echo, headers: { "content-type": "text/plain" } },
          { status, json: { id: echo } },
        ];
        for (const answer of answers) {
          stub.override(() => answer);
          await capture(send);
        }
      }
    }
    stub.override(undefined);

    // A configuration error.
    await capture(() => Promise.resolve(parseResendEnv({ RESEND_API_KEY: `${STUB_API_KEY} x` })));

    const everything = [...logger.lines, ...seen].join("\n");
    expect(logger.lines.length).toBeGreaterThan(100);
    const secrets = [
      STUB_API_KEY,
      STUB_PERSONAL.recipient,
      STUB_PERSONAL.owner,
      STUB_PERSONAL.refused,
      STUB_PERSONAL.replyTo,
      STUB_PERSONAL.subject,
    ];
    for (const value of secrets) {
      expect(everything, value).not.toContain(value);
    }
    for (const secret of secrets) {
      for (let start = 0; start + 8 <= secret.length; start += 1) {
        const fragment = secret.slice(start, start + 8);
        expect(everything, `fragment ${fragment}`).not.toContain(fragment);
      }
    }
    // Nor where the stub lives, nor the header.
    expect(everything).not.toContain("127.0.0.1");
    expect(everything).not.toContain("Bearer");
  });
});
