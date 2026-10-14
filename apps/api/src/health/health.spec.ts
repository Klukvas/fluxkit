import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type RunningApp } from "../test/app.js";

describe("GET /health", () => {
  let running: RunningApp;

  beforeAll(async () => {
    running = await startApp();
  });

  afterAll(async () => {
    await running.app.close();
  });

  it("returns ok when Postgres is reachable", async () => {
    const response = await fetch(`${running.baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

describe("GET /health with an unreachable database", () => {
  it("returns 503 instead of hiding the failure", async () => {
    const { createApp } = await import("../app.factory.js");
    const app = await createApp({
      databaseUrl: "postgres://fluxkit:wrong@127.0.0.1:1/none",
      enabledFeatures: [],
      featuresDir: undefined,
    });
    await app.listen(0, "127.0.0.1");
    try {
      const { port } = app.getHttpServer().address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      expect(response.status).toBe(503);
    } finally {
      await app.close();
    }
  });
});

describe("GET /health with a database that accepts connections but never answers", () => {
  it("returns 503 within the connection timeout instead of hanging", async () => {
    const silent = net.createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const { port: dbPort } = silent.address() as net.AddressInfo;
    const { createApp } = await import("../app.factory.js");
    const app = await createApp({
      databaseUrl: `postgres://fluxkit:x@127.0.0.1:${dbPort}/none`,
      enabledFeatures: [],
      featuresDir: undefined,
    });
    await app.listen(0, "127.0.0.1");
    try {
      const { port } = app.getHttpServer().address() as { port: number };
      const started = Date.now();
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      expect(response.status).toBe(503);
      expect(Date.now() - started).toBeLessThan(10000);
    } finally {
      await app.close();
      silent.close();
    }
  });
});
