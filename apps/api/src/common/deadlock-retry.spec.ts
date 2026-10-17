import { DrizzleQueryError } from "drizzle-orm";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { retryOnDeadlock } from "./deadlock-retry.js";
import { ProblemException } from "./problem.js";

function databaseError(code: string): pg.DatabaseError {
  const error = new pg.DatabaseError("secret message with an email buyer@example.com", 0, "error");
  error.code = code;
  return error;
}

const deadlock = (): Error =>
  new DrizzleQueryError("select 1", ["buyer@example.com"], databaseError("40P01"));

describe("retryOnDeadlock", () => {
  it("returns the result of a first attempt that works, without logging", async () => {
    const log = vi.fn();
    const work = vi.fn().mockResolvedValue("done");
    await expect(retryOnDeadlock(work, log)).resolves.toBe("done");
    expect(work).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("runs the work once more after a deadlock (40P01 inside a Drizzle error) and returns that result", async () => {
    const log = vi.fn();
    const work = vi.fn().mockRejectedValueOnce(deadlock()).mockResolvedValueOnce("second");
    await expect(retryOnDeadlock(work, log)).resolves.toBe("second");
    expect(work).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("answers 503 service_unavailable with a Retry-After after the second deadlock, and logs by code only", async () => {
    const log = vi.fn();
    const work = vi.fn().mockRejectedValue(deadlock());
    const error = await retryOnDeadlock(work, log).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProblemException);
    expect((error as ProblemException).code).toBe("service_unavailable");
    expect((error as ProblemException).getStatus()).toBe(503);
    expect((error as ProblemException).headers).toHaveProperty("Retry-After");
    expect(work).toHaveBeenCalledTimes(2);
    for (const call of log.mock.calls) {
      expect(String(call[0])).not.toContain("buyer@example.com");
      expect(String(call[0])).not.toContain("secret");
    }
    expect(log.mock.calls.some((call) => String(call[0]).includes("40P01"))).toBe(true);
  });

  it("does not retry any other failure, also not another database error", async () => {
    const log = vi.fn();
    const failure = new Error("boom");
    const work = vi.fn().mockRejectedValue(failure);
    await expect(retryOnDeadlock(work, log)).rejects.toBe(failure);
    expect(work).toHaveBeenCalledTimes(1);

    const serialization = new DrizzleQueryError("select 1", [], databaseError("40001"));
    const other = vi.fn().mockRejectedValue(serialization);
    await expect(retryOnDeadlock(other, log)).rejects.toBe(serialization);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("a problem thrown by the work passes through untouched", async () => {
    const problem = new ProblemException({ code: "cart_empty", detail: "x" });
    await expect(retryOnDeadlock(vi.fn().mockRejectedValue(problem), vi.fn())).rejects.toBe(
      problem,
    );
  });
});
