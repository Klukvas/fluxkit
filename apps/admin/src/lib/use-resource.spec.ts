import {
  InvalidResponseError,
  NetworkError,
  type AdminResult,
  type ProblemDetails,
} from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { createResourceRunner, resourceStateFromResult, type ResourceState } from "./use-resource";

const problem = (status: number, code: ProblemDetails["code"]) => ({
  ok: false as const,
  status,
  retryAfter: null,
  problem: { type: "about:blank", title: "t", status, code, detail: "d" },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/**
 * A loader that throws once and then never answers: a retry added to the runner cannot loop forever (which would starve
 * the timers and hang the test run); it shows up as a wrong state or call count instead.
 */
function failOnce(error: () => unknown) {
  let calls = 0;
  return async (): Promise<AdminResult<unknown>> => {
    calls += 1;
    if (calls > 1) return new Promise<AdminResult<unknown>>(() => undefined);
    throw error();
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("resourceStateFromResult", () => {
  it("maps success, 403, 404 and other problems to the screen states", () => {
    expect(resourceStateFromResult({ ok: true, status: 200, data: { a: 1 } })).toEqual({
      status: "ready",
      data: { a: 1 },
    });
    expect(resourceStateFromResult(problem(403, "forbidden"))).toEqual({ status: "forbidden" });
    expect(resourceStateFromResult(problem(404, "not_found"))).toEqual({ status: "notFound" });
    const conflict = resourceStateFromResult(problem(409, "conflict"));
    expect(conflict.status).toBe("error");
    // 401 is an error of the screen; the session layer opens the re-sign-in dialog separately.
    expect(resourceStateFromResult(problem(401, "unauthorized")).status).toBe("error");
  });
});

describe("createResourceRunner", () => {
  function setup() {
    const states: ResourceState<unknown>[] = [];
    const runner = createResourceRunner<unknown>((state) => states.push(state));
    return { states, runner };
  }

  it("goes loading, then ready", async () => {
    const { states, runner } = setup();
    runner.run(async () => ({ ok: true, status: 200, data: { id: 1 } }));
    await flush();
    expect(states).toEqual([{ status: "loading" }, { status: "ready", data: { id: 1 } }]);
  });

  it("aborts the previous request when it runs again and ignores the late answer", async () => {
    const { states, runner } = setup();
    const first = deferred<AdminResult<unknown>>();
    const signals: AbortSignal[] = [];
    runner.run((signal) => {
      signals.push(signal);
      return first.promise;
    });
    runner.run(async (signal) => {
      signals.push(signal);
      return { ok: true, status: 200, data: "second" };
    });
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    first.resolve({ ok: true, status: 200, data: "first" });
    await flush();
    expect(states.at(-1)).toEqual({ status: "ready", data: "second" });
    expect(states.some((state) => state.status === "ready" && state.data === "first")).toBe(false);
  });

  it("aborts on dispose (unmount, navigation) and reports nothing afterwards", async () => {
    const { states, runner } = setup();
    const pending = deferred<AdminResult<unknown>>();
    let seen: AbortSignal | undefined;
    runner.run((signal) => {
      seen = signal;
      return pending.promise;
    });
    runner.dispose();
    expect(seen?.aborted).toBe(true);
    pending.reject(
      new NetworkError("x", { cause: new DOMException("a", "AbortError"), aborted: true }),
    );
    await flush();
    expect(states).toEqual([{ status: "loading" }]);
  });

  it("never retries: a network failure calls the loader once and shows an error", async () => {
    const { states, runner } = setup();
    let calls = 0;
    // A second call would hang instead of failing again, so a retry shows up as a count (and never loops forever).
    runner.run(async () => {
      calls += 1;
      if (calls > 1) return new Promise<AdminResult<unknown>>(() => undefined);
      throw new NetworkError("x", { cause: new TypeError("fetch failed"), aborted: false });
    });
    await flush();
    await flush();
    expect(calls).toBe(1);
    expect(states.at(-1)).toEqual({ status: "error", failure: { kind: "network" } });
  });

  it("reports a timeout and an invalid answer as their own failures", async () => {
    const { states, runner } = setup();
    runner.run(
      failOnce(
        () =>
          new NetworkError("x", { cause: new DOMException("t", "TimeoutError"), aborted: true }),
      ),
    );
    await flush();
    expect(states.at(-1)).toEqual({ status: "error", failure: { kind: "timeout" } });
    runner.run(failOnce(() => new InvalidResponseError("x", { status: 502 })));
    await flush();
    expect(states.at(-1)).toEqual({ status: "error", failure: { kind: "invalidResponse" } });
  });

  it("passes a bug (not a client error) on as a crash, so the error boundary shows it", async () => {
    const { states, runner } = setup();
    const bug = new TypeError("undefined is not a function");
    runner.run(failOnce(() => bug));
    await flush();
    expect(states.at(-1)).toEqual({ status: "crashed", error: bug });
  });
});
