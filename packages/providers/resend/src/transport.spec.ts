import { createServer } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RESEND_MAX_ANSWER_BYTES, RESEND_SEND_URL, ResendHttp } from "./http.js";
import { aborted, live, message, MESSAGE_ID, providerOn, within } from "./test-support/fixtures.js";
import { STUB_API_KEY, startStubResend, type StubResend } from "./test-support/stub-resend.js";

/*
 * The transport rules: the size cap counted while reading, the caller's signal as the only time limit, transport
 * failures as `unavailable` (the mail may have gone), an abort before the request as `not_sent`, and the one endpoint.
 */
describe("transport", () => {
  let stub: StubResend;

  beforeEach(async () => {
    stub = await startStubResend();
  });

  afterEach(async () => {
    await stub.close();
  });

  describe("the answer is capped at 64 KiB before parsing", () => {
    const big = `{"id": "4ef9a417-02e9-4d39-ad75-9611e0fcc33c", "pad": "${"x".repeat(RESEND_MAX_ANSWER_BYTES)}"}`;

    it("by its declared length", async () => {
      stub.override(() => ({
        status: 200,
        body: big,
        headers: { "content-type": "application/json" },
      }));
      const { provider } = providerOn(stub);
      expect(await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live())).toEqual({
        ok: false,
        reason: "unavailable",
        providerCodes: ["too_large", "200"],
      });
    });

    it("while streaming, without a declared length", async () => {
      stub.override(() => ({
        status: 200,
        body: big,
        chunked: true,
        headers: { "content-type": "application/json" },
      }));
      const { provider } = providerOn(stub);
      expect(await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live())).toEqual({
        ok: false,
        reason: "unavailable",
        providerCodes: ["too_large", "200"],
      });
    });

    it("for an error answer too (its status alone is not trusted then)", async () => {
      stub.override(() => ({
        status: 422,
        body: `{"name": "invalid_parameter", "message": "${"x".repeat(RESEND_MAX_ANSWER_BYTES)}"}`,
        chunked: true,
        headers: { "content-type": "application/json" },
      }));
      const { provider } = providerOn(stub);
      expect(await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live())).toEqual({
        ok: false,
        reason: "unavailable",
        providerCodes: ["too_large", "422"],
      });
    });

    it("an answer just under the cap is read", async () => {
      const id = "4ef9a417-02e9-4d39-ad75-9611e0fcc33c";
      const shell = `{"id": "${id}", "pad": ""}`;
      const fits = `{"id": "${id}", "pad": "${"x".repeat(RESEND_MAX_ANSWER_BYTES - shell.length)}"}`;
      expect(fits.length).toBe(RESEND_MAX_ANSWER_BYTES);
      stub.override(() => ({
        status: 200,
        body: fits,
        chunked: true,
        headers: { "content-type": "application/json" },
      }));
      const { provider } = providerOn(stub);
      expect(await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live())).toEqual({
        ok: true,
        value: { providerMessageId: id },
      });
    });
  });

  it("answers not_sent for an already aborted signal, with no request", async () => {
    const { provider } = providerOn(stub);
    expect(await provider.send(message(), { idempotencyKey: MESSAGE_ID }, aborted())).toEqual({
      ok: false,
      reason: "not_sent",
      providerCodes: ["aborted"],
    });
    expect(stub.requests).toHaveLength(0);
  });

  it("sends nothing from the HTTP layer either when the signal has fired (the provider's own check aside)", async () => {
    const http = new ResendHttp({ apiKey: STUB_API_KEY, endpoint: stub.endpoint });
    expect(await http.postEmail("{}", MESSAGE_ID, aborted())).toEqual({
      kind: "failed",
      code: "aborted_before_send",
    });
    expect(stub.requests).toHaveLength(0);
  });

  it("ends a hanging request when the caller's signal fires: unavailable (it may have been accepted)", async () => {
    stub.override(() => ({ status: 200, hang: true }));
    const { provider } = providerOn(stub);
    const started = Date.now();
    const result = await provider.send(message(), { idempotencyKey: MESSAGE_ID }, within(200));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result).toEqual({ ok: false, reason: "unavailable", providerCodes: ["timeout"] });
    expect(stub.requests).toHaveLength(1);
  });

  it("ends a slow answer when the caller's signal fires before it arrives", async () => {
    stub.override(() => ({ status: 200, json: { id: "late" }, delayMs: 1000 }));
    const { provider } = providerOn(stub);
    const result = await provider.send(message(), { idempotencyKey: MESSAGE_ID }, within(150));
    expect(result).toEqual({ ok: false, reason: "unavailable", providerCodes: ["timeout"] });
  });

  it("follows any ProviderAbortSignal, not only a native one", async () => {
    stub.override(() => ({ status: 200, hang: true }));
    const listeners = new Set<() => void>();
    const signal = {
      aborted: false,
      reason: undefined as unknown,
      addEventListener: (_type: "abort", listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: "abort", listener: () => void) => listeners.delete(listener),
      throwIfAborted: () => undefined,
    };
    setTimeout(() => {
      signal.aborted = true;
      for (const listener of listeners) listener();
    }, 100);
    const { provider } = providerOn(stub);
    expect(await provider.send(message(), { idempotencyKey: MESSAGE_ID }, signal)).toEqual({
      ok: false,
      reason: "unavailable",
      providerCodes: ["timeout"],
    });
  });

  it("answers unavailable when the connection fails (nothing proves the mail did not go)", async () => {
    // A port that accepts and closes at once.
    const closer = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => closer.listen(0, "127.0.0.1", resolve));
    const { port } = closer.address() as { port: number };
    try {
      const provider = providerOn({ ...stub, endpoint: `http://127.0.0.1:${String(port)}/emails` });
      expect(
        await provider.provider.send(message(), { idempotencyKey: MESSAGE_ID }, live()),
      ).toEqual({ ok: false, reason: "unavailable", providerCodes: ["network"] });
      expect(provider.logger.lines).toEqual([
        expect.stringMatching(/^warn send: no answer -> unavailable \(network\) after \d+ ms$/),
      ]);
    } finally {
      await new Promise<void>((resolve) => closer.close(() => resolve()));
    }
  });

  it("calls only the Resend endpoint or a local stub", () => {
    expect(() => new ResendHttp({ apiKey: STUB_API_KEY })).not.toThrow();
    expect(RESEND_SEND_URL).toBe("https://api.resend.com/emails");
    for (const endpoint of [
      "https://api.resend.com/emails?x=1",
      "http://api.resend.com/emails",
      "https://api.resend.com.evil.example/emails",
      "https://api.resend.com/domains",
      "http://localhost:1234/emails",
      "http://127.0.0.1:1234/other",
      "http://10.0.0.1:1234/emails",
    ]) {
      expect(() => new ResendHttp({ apiKey: STUB_API_KEY, endpoint }), endpoint).toThrow(
        RangeError,
      );
    }
  });
});
