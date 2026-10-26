import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STUB_API_KEY, startStubResend, type StubResend } from "./test-support/stub-resend.js";

/*
 * The stub must refuse what Resend refuses (R4, R6, R8) and, where the documents are silent, more (its own rules), so a
 * plugin spec that passes cannot pass because the stub is lax.
 */
describe("the stub Resend is strict", () => {
  let stub: StubResend;

  beforeEach(async () => {
    stub = await startStubResend();
  });

  afterEach(async () => {
    await stub.close();
  });

  const good = {
    from: "shop@mail.example",
    to: ["buyer@example.com"],
    subject: "s",
    html: "<p>h</p>",
    text: "t",
  };

  async function post(
    headers: Record<string, string>,
    body: unknown = good,
    path = "/emails",
  ): Promise<{ status: number; name: unknown }> {
    const response = await fetch(stub.endpoint.replace(/\/emails$/, path), {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let name: unknown;
    try {
      name = (JSON.parse(text) as { name?: unknown }).name;
    } catch {
      name = text;
    }
    return { status: response.status, name };
  }

  const ok = {
    authorization: `Bearer ${STUB_API_KEY}`,
    "content-type": "application/json",
    "user-agent": "spec",
  };

  it("accepts a well-formed request", async () => {
    expect((await post(ok)).status).toBe(200);
  });

  it("refuses each departure", async () => {
    expect(await post({ ...ok, "user-agent": "" })).toEqual({
      status: 403,
      name: "error code: 1010",
    });
    expect(await post({ "content-type": "application/json", "user-agent": "spec" })).toEqual({
      status: 401,
      name: "missing_api_key",
    });
    expect(await post({ ...ok, authorization: STUB_API_KEY })).toEqual({
      status: 401,
      name: "validation_error",
    });
    expect(await post({ ...ok, authorization: `Basic ${STUB_API_KEY}` })).toEqual({
      status: 401,
      name: "validation_error",
    });
    expect(await post({ ...ok, "content-type": "text/plain" })).toEqual({
      status: 400,
      name: "validation_error",
    });
    expect(await post({ ...ok, "idempotency-key": "k".repeat(257) })).toEqual({
      status: 400,
      name: "invalid_idempotency_key",
    });
    expect(await post(ok, "{not json")).toEqual({ status: 400, name: "validation_error" });
    expect(await post(ok, { ...good, headers: { "X-A": "1" } })).toEqual({
      status: 422,
      name: "invalid_parameter",
    });
    expect(await post(ok, { ...good, replyTo: "a@example.com" })).toEqual({
      status: 422,
      name: "invalid_parameter",
    });
    expect(await post(ok, { ...good, subject: undefined })).toEqual({
      status: 422,
      name: "missing_required_field",
    });
    expect(await post(ok, { ...good, to: "buyer@example.com" })).toEqual({
      status: 422,
      name: "invalid_parameter",
    });
    expect(await post(ok, good, "/domains")).toEqual({ status: 404, name: "not_found" });
  });

  it("models idempotency (R4)", async () => {
    const keyed = { ...ok, "idempotency-key": "key-1" };
    expect((await post(keyed)).status).toBe(200);
    expect((await post(keyed)).status).toBe(200);
    expect(stub.accepted).toHaveLength(1);
    expect(await post(keyed, { ...good, subject: "other" })).toEqual({
      status: 409,
      name: "invalid_idempotent_request",
    });
  });
});
