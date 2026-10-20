import type { AdminResult } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { MAX_IN_FLIGHT, loadByIds } from "./load-by-ids";

const ok = <T>(data: T): AdminResult<T> => ({ ok: true, status: 200, data });
const missing: AdminResult<never> = {
  ok: false,
  status: 404,
  problem: { type: "about:blank", title: "Not Found", status: 404, code: "not_found", detail: "" },
  retryAfter: null,
};

describe("loadByIds (names for the ids on a page, bounded fan-out)", () => {
  it("reads each distinct id once and never more than 6 at a time", async () => {
    expect(MAX_IN_FLIGHT).toBe(6);
    let inFlight = 0;
    let peak = 0;
    const asked: string[] = [];
    const ids = ["a", "b", "a", "c", "d", "e", "f", "g", "h", "b"];
    const found = await loadByIds(ids, async (id) => {
      asked.push(id);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return ok({ id, name: id.toUpperCase() });
    });
    expect([...asked].sort()).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(peak).toBeLessThanOrEqual(6);
    expect(found.get("g")).toEqual({ id: "g", name: "G" });
  });

  it("leaves out an id that could not be read; nothing is retried", async () => {
    const asked: string[] = [];
    const found = await loadByIds(["x", "y"], async (id) => {
      asked.push(id);
      if (id === "x") return missing;
      return ok(id);
    });
    expect(asked).toEqual(["x", "y"]);
    expect(found.has("x")).toBe(false);
    expect(found.get("y")).toBe("y");
  });

  it("rejects when a read throws (the caller decides: an abort is silent, a bug goes to the boundary)", async () => {
    await expect(loadByIds(["x"], () => Promise.reject(new Error("network")))).rejects.toThrow(
      "network",
    );
  });

  it("asks nothing for no ids", async () => {
    const found = await loadByIds([], () => {
      throw new Error("not called");
    });
    expect(found.size).toBe(0);
  });
});
