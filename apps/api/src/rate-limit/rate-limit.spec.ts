import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProblemBody } from "../common/problem.filter.js";
import { startApp, type RunningApp } from "../test/app.js";
import { customerProbeFeature } from "../test/customer-probe.js";
import { FakeClock } from "../test/fake-clock.js";
import { http } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";

const START = "2030-03-01T08:00:00.000Z";
const LIMITED = "/store/probe-customer/limited";

describe("@RateLimit on a store route (real app)", () => {
  const clock = new FakeClock(START);
  let running: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ clock, extraFeatures: customerProbeFeature });
  });

  beforeEach(() => {
    // Every test starts a window far from the previous one.
    clock.set(new Date(clock.now().getTime() + 24 * 3_600_000));
  });

  afterAll(async () => {
    await running.app.close();
  });

  it("allows 10 checkout-sized calls, then answers 429 too_many_requests with Retry-After", async () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const result = await http(running.baseUrl, "POST", LIMITED, { body: {} });
      expect(result.status, `attempt ${attempt}`).toBe(201);
    }
    clock.advanceMinutes(4);
    const refused = await http<ProblemBody>(running.baseUrl, "POST", LIMITED, { body: {} });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("content-type")).toContain("application/problem+json");
    expect(refused.body).toMatchObject({ code: "too_many_requests", status: 429 });
    expect(refused.headers.get("retry-after")).toBe(String(6 * 60));
  });

  it("requests refused by the CSRF guard are not counted: that guard answers first", async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const result = await http(running.baseUrl, "POST", LIMITED, { body: {}, csrf: false });
      expect(result.status).toBe(403);
    }
    const ok = await http(running.baseUrl, "POST", LIMITED, { body: {} });
    expect(ok.status).toBe(201);
  });

  it("opens a new window after the old one ends", async () => {
    for (let attempt = 0; attempt < 11; attempt += 1) {
      await http(running.baseUrl, "POST", LIMITED, { body: {} });
    }
    expect((await http(running.baseUrl, "POST", LIMITED, { body: {} })).status).toBe(429);
    clock.advanceMinutes(10);
    expect((await http(running.baseUrl, "POST", LIMITED, { body: {} })).status).toBe(201);
  });

  it("does not limit a route without @RateLimit", async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const result = await http(running.baseUrl, "GET", "/store/probe-customer/public");
      expect(result.status).toBe(200);
    }
  });
});
