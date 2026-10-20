import { describe, expect, it } from "vitest";
import { createSingleFlight } from "./single-flight";

function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("createSingleFlight (double-submit protection: a second click before the first answer sends nothing)", () => {
  it("runs the first call and drops every call while it is pending", async () => {
    const flight = createSingleFlight();
    const gate = deferred();
    let calls = 0;
    const first = flight.run(async () => {
      calls += 1;
      await gate.promise;
    });
    expect(flight.pending()).toBe(true);
    expect(flight.run(async () => void (calls += 1))).toBeNull();
    expect(flight.run(async () => void (calls += 1))).toBeNull();
    expect(calls).toBe(1);
    gate.resolve();
    await first;
    expect(flight.pending()).toBe(false);
  });

  it("accepts the next call once the first has settled, also after a failure (and never repeats one)", async () => {
    const flight = createSingleFlight();
    let calls = 0;
    await flight.run(async () => void (calls += 1));
    const failing = deferred();
    const second = flight.run(async () => {
      calls += 1;
      await failing.promise;
    });
    failing.reject(new Error("lost"));
    await expect(second).rejects.toThrow("lost");
    expect(flight.pending()).toBe(false);
    await flight.run(async () => void (calls += 1));
    expect(calls).toBe(3);
  });
});
