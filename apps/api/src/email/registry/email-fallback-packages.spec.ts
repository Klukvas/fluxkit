import { Test } from "@nestjs/testing";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertEmailFallbackReadiness } from "./email-fallback-readiness.js";
import { DEFAULT_EMAIL_PROVIDERS_DIR, loadEmailProvider } from "./email-provider-loader.js";
import { EmailProviderRegistry } from "./email-provider-registry.js";
import { EmailRegistryModule } from "./email-registry.module.js";

/** Dynamically loaded real modules, invented credentials, no outbound network. */
describe("selected primary/fallback package startup", () => {
  const fetch = vi.fn(() =>
    Promise.reject(new Error("External network is forbidden in startup tests")),
  );
  beforeEach(() => {
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("RESEND_API_KEY", "re_Invented_Fallback_Test_Key_0123456789");
    vi.stubEnv("BREVO_API_KEY", "Invented_Brevo_Fallback_Test_Key");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw");
    vi.stubEnv("BREVO_WEBHOOK_SECRET", "Invented_Webhook_Token_For_Unit_Tests_0123456789");
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetch.mockClear();
  });

  async function compile() {
    const selected = await loadEmailProvider({
      provider: "resend",
      fallbacks: ["brevo"],
      providersDir: DEFAULT_EMAIL_PROVIDERS_DIR,
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
