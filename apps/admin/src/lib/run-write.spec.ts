import {
  InvalidRequestError,
  InvalidResponseError,
  NetworkError,
  type AdminResult,
} from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { runWrite } from "./run-write";

const problem = (status: number) => ({
  ok: false as const,
  status,
  retryAfter: null,
  problem: { type: "about:blank", title: "t", status, code: "conflict" as const, detail: "d" },
});

describe("runWrite", () => {
  it("returns a success with its status and data", async () => {
    const outcome = await runWrite(async () => ({
      ok: true as const,
      status: 201,
      data: { id: 1 },
    }));
    expect(outcome).toEqual({ kind: "ok", status: 201, data: { id: 1 } });
  });

  it("returns a problem the API answered on purpose, with its status", async () => {
    const outcome = await runWrite(async () => problem(409));
    expect(outcome).toMatchObject({ kind: "problem", status: 409 });
  });

  it("calls the write exactly once, whatever happens (a write is never retried)", async () => {
    for (const fail of [
      () => new NetworkError("x", { cause: new Error("down"), aborted: false }),
      () => new InvalidResponseError("x", { status: 200 }),
    ]) {
      let calls = 0;
      const outcome = await runWrite(async (): Promise<AdminResult<unknown>> => {
        calls += 1;
        throw fail();
      });
      expect(outcome.kind).toBe("unknown");
      expect(calls).toBe(1);
    }
  });

  it("calls the write once for a problem as well", async () => {
    let calls = 0;
    await runWrite(async () => {
      calls += 1;
      return problem(500);
    });
    expect(calls).toBe(1);
  });

  it("reports a lost connection, a timeout and an unreadable answer as an unknown result", async () => {
    const network = await runWrite(async () => {
      throw new NetworkError("x", { cause: new Error("down"), aborted: false });
    });
    expect(network).toEqual({ kind: "unknown", failure: { kind: "network" } });
    const timeout = await runWrite(async () => {
      throw new NetworkError("x", {
        cause: new DOMException("late", "TimeoutError"),
        aborted: false,
      });
    });
    expect(timeout).toEqual({ kind: "unknown", failure: { kind: "timeout" } });
    const unreadable = await runWrite(async () => {
      throw new InvalidResponseError("x", { status: 200 });
    });
    expect(unreadable).toEqual({ kind: "unknown", failure: { kind: "invalidResponse" } });
  });

  it("throws a bug again instead of turning it into a message", async () => {
    await expect(
      runWrite(async () => {
        throw new InvalidRequestError("bad base url");
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(
      runWrite(async () => {
        throw new TypeError("oops");
      }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
