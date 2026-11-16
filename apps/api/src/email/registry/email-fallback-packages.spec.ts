import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Test } from "@nestjs/testing";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertEmailFallbackReadiness } from "./email-fallback-readiness.js";
import { loadEmailProvider } from "./email-provider-loader.js";
import { EmailProviderRegistry } from "./email-provider-registry.js";
import { EmailRegistryModule } from "./email-registry.module.js";

const HELPER_URL = pathToFileURL(
  join(import.meta.dirname, "../../test/test-env-gated-email-provider.ts"),
).href;

/**
 * Dynamically loaded provider packages, invented credentials, no outbound network. The packages are test fixtures shaped
 * like Resend and Brevo (own key, verifier only with own webhook secret), not `packages/providers`: core specs must pass
 * with every provider package deleted. The real packages test their own key and secret handling.
 */
describe("selected primary/fallback package startup", () => {
  let providersDir: string;
  const fetch = vi.fn(() =>
    Promise.reject(new Error("External network is forbidden in startup tests")),
  );
  beforeEach(async () => {
    providersDir = await mkdtemp(join(tmpdir(), "fluxkit-email-fallback-packages-"));
    await writeProvider("resend", "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET");
    await writeProvider("brevo", "BREVO_API_KEY", "BREVO_WEBHOOK_SECRET");
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("RESEND_API_KEY", "re_Invented_Fallback_Test_Key_0123456789");
    vi.stubEnv("BREVO_API_KEY", "Invented_Brevo_Fallback_Test_Key");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw");
    vi.stubEnv("BREVO_WEBHOOK_SECRET", "Invented_Webhook_Token_For_Unit_Tests_0123456789");
  });
  afterEach(async () => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetch.mockClear();
    await rm(providersDir, { recursive: true, force: true });
  });

  async function writeProvider(code: string, keyVariable: string, secretVariable: string) {
    const dir = join(providersDir, code);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: `fixture-${code}`,
        type: "module",
        main: "index.js",
        fluxkit: { provider: code, kind: "email" },
      }),
    );
    await writeFile(
      join(dir, "index.js"),
      `import { envGatedEmailProviderModule } from ${JSON.stringify(HELPER_URL)};\n` +
        `export const providerModule = envGatedEmailProviderModule(${JSON.stringify(code)}, ${JSON.stringify(keyVariable)}, ${JSON.stringify(secretVariable)});\n`,
    );
  }

  async function compile() {
    const selected = await loadEmailProvider({
      provider: "resend",
      fallbacks: ["brevo"],
      providersDir,
    });
    return Test.createTestingModule({
      imports: [EmailRegistryModule.register(selected)],
    }).compile();
  }

  it.each(["RESEND_API_KEY", "BREVO_API_KEY"])(
    "requires %s independently at either position",
    async (variable) => {
      vi.stubEnv(variable, "");
      await expect(compile()).rejects.toThrow(variable);
    },
  );

  it.each(["RESEND_WEBHOOK_SECRET", "BREVO_WEBHOOK_SECRET"])(
    "refuses fallback startup without %s before any DB/send",
    async (variable) => {
      vi.stubEnv(variable, "");
      const module = await compile();
      const pool = new pg.Pool();
      try {
        const registry = module.get(EmailProviderRegistry);
        registry.discover();
        expect(registry.list().map((provider) => provider.code)).toEqual(["resend", "brevo"]);
        await expect(
          assertEmailFallbackReadiness(pool, registry.list(), true, true),
        ).rejects.toThrow(/webhook verifier and webhook secret/);
      } finally {
        await module.close();
        await pool.end();
      }
    },
  );
});
