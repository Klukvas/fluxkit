import { describe, expect, it } from "vitest";
import { InvalidRequestError } from "./errors.js";
import { createTransport, type TransportOperation } from "./transport.js";

const upload: TransportOperation = {
  method: "POST",
  path: "/admin/media/uploads",
  successStatuses: [201],
  query: [],
  bodyKind: "binary",
};
const json: TransportOperation = { ...upload, path: "/admin/things", bodyKind: "json" };
const bytes = new Uint8Array([1, 2, 3]);
const rawBody = { bytes, contentType: "application/octet-stream" } as const;

function transport() {
  const calls: RequestInit[] = [];
  const send = createTransport({
    baseUrl: "",
    fetch: async (_url, init) => {
      calls.push(init);
      return new Response("{}", { status: 201, headers: { "Content-Type": "application/json" } });
    },
  });
  return { send, calls };
}

describe("createTransport body kinds", () => {
  it("sends the raw body of a binary operation once", async () => {
    const { send, calls } = transport();
    await send(upload, { rawBody });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toBe(bytes);
  });

  it("refuses a binary operation without bytes or with a JSON body, before any request", async () => {
    const { send, calls } = transport();
    await expect(send(upload, {})).rejects.toThrow(InvalidRequestError);
    await expect(send(upload, { body: { a: 1 } })).rejects.toThrow(InvalidRequestError);
    await expect(send(upload, { rawBody, body: { a: 1 } })).rejects.toThrow(InvalidRequestError);
    expect(calls).toHaveLength(0);
  });

  it("refuses raw bytes on any operation that is not binary, so the JSON rule cannot be bypassed", async () => {
    const { send, calls } = transport();
    await expect(send(json, { rawBody })).rejects.toThrow(InvalidRequestError);
    await expect(
      send({ method: "POST", path: "/store/cart", successStatuses: [201], query: [] }, { rawBody }),
    ).rejects.toThrow(InvalidRequestError);
    expect(calls).toHaveLength(0);
  });
});
