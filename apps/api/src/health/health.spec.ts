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
