import { describe, expect, it } from "vitest";
import { classifySessionSignal, createSignalHub, withSessionSignals } from "./session-signals";

describe("classifySessionSignal", () => {
  it("reports a 401 of any admin request except sign-in and sign-out", () => {
    expect(classifySessionSignal("GET", "/admin/orders?limit=20", 401)).toBe("unauthorized");
    expect(classifySessionSignal("PATCH", "/admin/products/1", 401)).toBe("unauthorized");
    expect(classifySessionSignal("GET", "/admin/auth/me", 401)).toBe("unauthorized");
    expect(classifySessionSignal("POST", "/admin/auth/login", 401)).toBeNull();
    expect(classifySessionSignal("POST", "/admin/auth/logout", 401)).toBeNull();
  });

  it("reports a 403 so the permissions are read again", () => {
    expect(classifySessionSignal("POST", "/admin/orders/1/mark-paid", 403)).toBe("forbidden");
    expect(classifySessionSignal("POST", "/admin/auth/login", 403)).toBeNull();
  });

  it("ignores every other status and every path outside the admin API", () => {
    for (const status of [200, 204, 400, 404, 409, 429, 500]) {
      expect(classifySessionSignal("GET", "/admin/orders", status)).toBeNull();
    }
    expect(classifySessionSignal("GET", "/store/cart", 401)).toBeNull();
    expect(classifySessionSignal("GET", "/admin-ui/x", 401)).toBeNull();
  });
});

describe("withSessionSignals", () => {
  it("passes the response through unchanged and tells the hub about a 401", async () => {
    const hub = createSignalHub();
    const seen: string[] = [];
    hub.subscribe((signal) => seen.push(signal));
    const response = new Response(null, { status: 401 });
    const fetched = withSessionSignals(async () => response, hub);
    expect(await fetched("/admin/orders", { method: "GET" })).toBe(response);
    expect(seen).toEqual(["unauthorized"]);
  });

  it("does not send anything twice and never retries", async () => {
    const hub = createSignalHub();
    let calls = 0;
    const fetched = withSessionSignals(async () => {
      calls += 1;
      return new Response(null, { status: 401 });
    }, hub);
    await fetched("/admin/products/1", { method: "PATCH", body: "{}" });
    expect(calls).toBe(1);
  });

  it("lets subscribers leave", () => {
    const hub = createSignalHub();
    const seen: string[] = [];
    const leave = hub.subscribe((signal) => seen.push(signal));
    hub.emit("forbidden");
    leave();
    hub.emit("forbidden");
    expect(seen).toEqual(["forbidden"]);
  });
});
