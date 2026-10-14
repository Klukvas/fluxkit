import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { startApp } from "../test/app.js";

const fixturesDir = fileURLToPath(new URL("../test/fixtures/features", import.meta.url));

describe("feature flag matrix (core, using a test fixture feature)", () => {
  it("flag ON: the feature route exists", async () => {
    const { app, baseUrl } = await startApp({
      enabledFeatures: ["sample"],
      featuresDir: fixturesDir,
    });
    try {
      const response = await fetch(`${baseUrl}/sample/ping`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it("flag OFF: no route, no side effects", async () => {
    const { app, baseUrl } = await startApp({ enabledFeatures: [], featuresDir: fixturesDir });
    try {
      const response = await fetch(`${baseUrl}/sample/ping`);
      expect(response.status).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("folder DELETED and flag OFF: core still starts", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "fluxkit-no-features-"));
    try {
      const { app, baseUrl } = await startApp({ enabledFeatures: [], featuresDir: emptyDir });
      try {
        expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
      } finally {
        await app.close();
      }
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("folder DELETED and flag ON: startup fails loudly", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "fluxkit-no-features-"));
    try {
      await expect(
        startApp({ enabledFeatures: ["sample"], featuresDir: emptyDir }),
      ).rejects.toThrow(/Feature "sample" is enabled/);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
