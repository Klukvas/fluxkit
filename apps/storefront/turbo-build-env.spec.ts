import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Regression (production deployment plan, 2026-10-29): `next build` freezes `STOREFRONT_IMAGE_HOSTS` into the CSP, but the
 * root `pnpm build` runs it through Turborepo, whose strict environment mode passes a task ONLY the variables its
 * configuration names. Without this entry the variable never reached `next build` (the CSP had no image host whatever the
 * shell or the Docker build argument said), and a cached build was reused after the value changed.
 */
interface TurboTask {
  env?: string[];
  passThroughEnv?: string[];
}

const turbo = JSON.parse(readFileSync(new URL("../../turbo.json", import.meta.url), "utf8")) as {
  tasks: Record<string, TurboTask>;
};

describe("turbo.json, the storefront build", () => {
  it("hands STOREFRONT_IMAGE_HOSTS to next build and keys the build cache on it", () => {
    const task = turbo.tasks["@fluxkit/storefront#build"];
    expect(task?.env).toContain("STOREFRONT_IMAGE_HOSTS");
  });

  it("hands STOREFRONT_REQUIRE_LEGAL_TEXT to next build, so the release check runs and a cached build is not reused after it changes", () => {
    const task = turbo.tasks["@fluxkit/storefront#build"];
    expect(task?.env).toContain("STOREFRONT_REQUIRE_LEGAL_TEXT");
  });
});
