import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUSY_LOG_WINDOW_MS, BusyRefusalLog } from "./busy-log.js";

/** The sampled log of `engine_busy` refusals (review F4 of PR 204): one line, then one summary per window at most. */
describe("BusyRefusalLog", () => {
  let refused = { queueFull: 0, waitExceeded: 0 };
  const lines: string[] = [];
  const logger = { warn: (line: string) => lines.push(line) };

  beforeEach(() => {
    vi.useFakeTimers();
    refused = { queueFull: 0, waitExceeded: 0 };
    lines.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** One refusal as the store sees it: the engine counted it, then the store reports it. */
  function refuse(log: BusyRefusalLog, reason: "queueFull" | "waitExceeded"): void {
    refused = { ...refused, [reason]: refused[reason] + 1 };
    log.refused("engine_busy after 3 ms (query of 2 words)");
  }

  it("logs the first refusal at once, then at most one summary per window with the counts by reason", async () => {
    const log = new BusyRefusalLog(logger, () => refused);
    expect(BUSY_LOG_WINDOW_MS).toBe(30_000);
    refuse(log, "queueFull");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("engine_busy after 3 ms (query of 2 words)");
    for (let i = 0; i < 40; i += 1) {
      refuse(log, i % 4 === 0 ? "waitExceeded" : "queueFull");
    }
    expect(lines).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(BUSY_LOG_WINDOW_MS);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("40 more searches refused in the last 30 s");
    expect(lines[1]).toContain("queue full 30, wait exceeded 10");
    refuse(log, "waitExceeded");
    await vi.advanceTimersByTimeAsync(BUSY_LOG_WINDOW_MS);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain("1 more search refused in the last 30 s");
    expect(lines[2]).toContain("queue full 0, wait exceeded 1");
  });

  it("ends the period after a window without refusals: the next refusal is logged at once again", async () => {
    const log = new BusyRefusalLog(logger, () => refused);
    refuse(log, "queueFull");
    await vi.advanceTimersByTimeAsync(BUSY_LOG_WINDOW_MS);
    expect(lines).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    refuse(log, "waitExceeded");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("engine_busy");
  });
});
