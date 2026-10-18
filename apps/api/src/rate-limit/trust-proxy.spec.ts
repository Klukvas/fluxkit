import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type RunningApp } from "../test/app.js";
import { login } from "../test/auth-http.js";
import { customerProbeFeature } from "../test/customer-probe.js";
import { FakeClock } from "../test/fake-clock.js";
import { http, type HttpResult } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";

const START = "2030-03-01T08:00:00.000Z";
/** A store route limited like checkout: 10 attempts per 10 minutes per client address. */
const STORE_LIMITED = "/store/probe-customer/limited";
const STORE_ATTEMPTS = 10;
/** The admin login throttle: 20 attempts per 10 minutes per client address. */
const LOGIN_ATTEMPTS = 20;

const forwardedFor = (value: string) => ({ "x-forwarded-for": value });
const storeCall = (running: RunningApp, forwarded: string): Promise<HttpResult> =>
  http(running.baseUrl, "POST", STORE_LIMITED, { body: {}, headers: forwardedFor(forwarded) });
const loginCall = (running: RunningApp, forwarded: string): Promise<HttpResult> =>
  http(running.baseUrl, "POST", "/admin/auth/login", {
    body: { email: "nobody-here@example.test", password: "correct horse battery staple" },
    headers: forwardedFor(forwarded),
  });

async function exhaustStore(running: RunningApp, forwarded: string): Promise<void> {
  for (let attempt = 1; attempt <= STORE_ATTEMPTS; attempt += 1) {
    expect((await storeCall(running, forwarded)).status, `attempt ${attempt}`).toBe(201);
  }
  expect((await storeCall(running, forwarded)).status).toBe(429);
}

describe("TRUST_PROXY=1 (one proxy in front of the API)", () => {
  const clock = new FakeClock(START);
  let running: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      trustProxy: 1,
      extraFeatures: customerProbeFeature,
    });
  });

  afterAll(async () => {
    await running.app.close();
  });

  it("counts the store rate limit per forwarded client address, not per proxy", async () => {
    await exhaustStore(running, "203.0.113.1");
    expect((await storeCall(running, "203.0.113.2")).status).toBe(201);
    // The first client is still limited.
    expect((await storeCall(running, "203.0.113.1")).status).toBe(429);
  });

  it("counts the admin login throttle per forwarded client address", async () => {
    for (let attempt = 1; attempt <= LOGIN_ATTEMPTS; attempt += 1) {
      expect((await loginCall(running, "198.51.100.1")).status, `attempt ${attempt}`).toBe(401);
    }
    expect((await loginCall(running, "198.51.100.1")).status).toBe(429);
    expect((await loginCall(running, "198.51.100.2")).status).toBe(401);
  });

  it("still groups an IPv6 forwarded address by its /64", async () => {
    await exhaustStore(running, "2001:db8:1:2::1");
    // Same /64, another address and another spelling: the same window.
    expect((await storeCall(running, "2001:DB8:1:2:ffff::9")).status).toBe(429);
    // The next /64 is a different client.
    expect((await storeCall(running, "2001:db8:1:3::1")).status).toBe(201);
  });

  it("takes the address the trusted proxy appended, so a client cannot choose its own key", async () => {
    // The client prefixed fake addresses; the proxy appended the real one (the last entry).
    await exhaustStore(running, "1.1.1.1, 203.0.113.7");
    expect((await storeCall(running, "2.2.2.2, 203.0.113.7")).status).toBe(429);
    expect((await storeCall(running, "2.2.2.2, 203.0.113.8")).status).toBe(201);
  });

  it("without the header, requests share the socket address window", async () => {
    clock.advanceMinutes(60);
    for (let attempt = 1; attempt <= STORE_ATTEMPTS; attempt += 1) {
      expect((await http(running.baseUrl, "POST", STORE_LIMITED, { body: {} })).status).toBe(201);
    }
    expect((await http(running.baseUrl, "POST", STORE_LIMITED, { body: {} })).status).toBe(429);
  });
});

describe.each([
  ["the default", undefined],
  ["TRUST_PROXY=0", 0],
] as const)("%s (no trusted proxy)", (_label, hops) => {
  const clock = new FakeClock(START);
  let running: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      trustProxy: hops,
      extraFeatures: customerProbeFeature,
    });
  });

  afterAll(async () => {
    await running.app.close();
  });

  it("ignores X-Forwarded-For on the store limit: a spoofed address does not open a new window", async () => {
    await exhaustStore(running, "203.0.113.1");
    expect((await storeCall(running, "203.0.113.2")).status).toBe(429);
    expect((await storeCall(running, "2001:db8:1:2::1")).status).toBe(429);
  });

  it("ignores X-Forwarded-For on the admin login throttle", async () => {
    for (let attempt = 1; attempt <= LOGIN_ATTEMPTS; attempt += 1) {
      expect((await loginCall(running, "198.51.100.1")).status, `attempt ${attempt}`).toBe(401);
    }
    expect((await loginCall(running, "198.51.100.2")).status).toBe(429);
  });
});
