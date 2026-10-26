import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMAIL_PROVIDER_CODE_PATTERN, EMAIL_PROVIDER_PACKAGE_KIND } from "@fluxkit/core";
import { loadShippingProviders } from "../../shipping/registry/index.js";
import { loadEmailProvider } from "./email-provider-loader.js";

describe("loadEmailProvider", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fluxkit-email-providers-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProvider(
    folder: string,
    fluxkit: Record<string, unknown>,
    body: string,
    main = "index.js",
  ): Promise<void> {
    const providerDir = join(dir, folder);
    await mkdir(providerDir, { recursive: true });
    await writeFile(
      join(providerDir, "package.json"),
      JSON.stringify({ name: `x-${folder}`, type: "module", main, fluxkit }),
    );
    await writeFile(join(providerDir, "index.js"), body);
  }

  const email = (provider: string): Record<string, unknown> => ({ provider, kind: "email" });
  const MODULE = "export const providerModule = class M {};\n";
  const MUST_NOT_IMPORT = "throw new Error('must not be imported');\n";

  it("declares the kind core names", () => {
    expect(EMAIL_PROVIDER_PACKAGE_KIND).toBe("email");
    expect(EMAIL_PROVIDER_CODE_PATTERN.test("fake")).toBe(true);
  });

  it("none loads nothing and does not read the folder", async () => {
    expect(await loadEmailProvider({ provider: "none", providersDir: join(dir, "nope") })).toEqual(
      [],
    );
  });

  it("none does not import a provider that is present", async () => {
    await writeProvider("fake-email", email("fake"), MUST_NOT_IMPORT);
    await writeProvider("resend", email("resend"), MUST_NOT_IMPORT);
    expect(await loadEmailProvider({ provider: "none", providersDir: dir })).toEqual([]);
  });

  it("imports only the selected provider, not another one beside it", async () => {
    await writeProvider("one", email("resend"), MODULE);
    await writeProvider("two", email("fake"), MUST_NOT_IMPORT);
    const loaded = await loadEmailProvider({ provider: "resend", providersDir: dir });
    expect(loaded.map((provider) => provider.code)).toEqual(["resend"]);
  });

  it("finds a provider by manifest code, regardless of the folder name", async () => {
    await writeProvider("_sample", email("sample"), MODULE);
    const loaded = await loadEmailProvider({ provider: "sample", providersDir: dir });
    expect(loaded.map((provider) => provider.code)).toEqual(["sample"]);
  });

  it("ignores packages of another kind, even with the same code", async () => {
    await writeProvider("ship", { provider: "fake", kind: "shipping" }, MUST_NOT_IMPORT);
    await writeProvider("pay", { provider: "fake", kind: "payment" }, MUST_NOT_IMPORT);
    await expect(loadEmailProvider({ provider: "fake", providersDir: dir })).rejects.toThrow(
      /Email provider "fake" is enabled in EMAIL_PROVIDER/,
    );
  });

  it("a shipping and an email package may share a code; each loader takes its own kind", async () => {
    await writeProvider("ship", { provider: "fake", kind: "shipping" }, MODULE);
    await writeProvider("mail", email("fake"), "export const providerModule = class Mail {};\n");
    const [mail] = await loadEmailProvider({ provider: "fake", providersDir: dir });
    const [ship] = await loadShippingProviders({ enabled: ["fake"], providersDir: dir });
    expect(mail?.module.name).toBe("Mail");
    expect(ship?.module.name).toBe("M");
  });

  it("fails loudly when the selected provider is missing (deleted folder)", async () => {
    await expect(loadEmailProvider({ provider: "gone", providersDir: dir })).rejects.toThrow(
      /Email provider "gone" is enabled in EMAIL_PROVIDER but no package with "fluxkit": \{"provider": "gone", "kind": "email"\}/,
    );
    await expect(
      loadEmailProvider({ provider: "gone", providersDir: join(dir, "does-not-exist") }),
    ).rejects.toThrow(/Email provider "gone" is enabled/);
  });

  it("fails loudly when the provider does not export providerModule", async () => {
    await writeProvider("bad", email("bad"), "export const nope = 1;\n");
    await expect(loadEmailProvider({ provider: "bad", providersDir: dir })).rejects.toThrow(
      /Email provider "bad" must export "providerModule"/,
    );
  });

  it("fails loudly, with the cause, when the entry point throws on import", async () => {
    await writeProvider("broken", email("broken"), "throw new Error('boom');\n");
    let error: Error | undefined;
    try {
      await loadEmailProvider({ provider: "broken", providersDir: dir });
    } catch (caught) {
      error = caught as Error;
    }
    expect(error?.message).toMatch(/Email provider "broken" could not be loaded .*boom/);
    expect((error?.cause as Error).message).toBe("boom");
  });

  it("fails loudly when the entry file does not exist", async () => {
    await writeProvider("nofile", email("nofile"), "", "missing.js");
    await expect(loadEmailProvider({ provider: "nofile", providersDir: dir })).rejects.toThrow(
      /"nofile" could not be loaded/,
    );
  });

  it("rejects a manifest whose main escapes the provider folder", async () => {
    await writeProvider("evil", email("evil"), MODULE);
    await writeFile(
      join(dir, "evil", "package.json"),
      JSON.stringify({ type: "module", main: "../outside.js", fluxkit: email("evil") }),
    );
    await expect(loadEmailProvider({ provider: "evil", providersDir: dir })).rejects.toThrow(
      /must stay inside/,
    );
  });

  it("rejects two packages declaring the same code", async () => {
    await writeProvider("one", email("dup"), MODULE);
    await writeProvider("two", email("dup"), MODULE);
    await expect(loadEmailProvider({ provider: "dup", providersDir: dir })).rejects.toThrow(
      /Email provider "dup" is declared twice/,
    );
  });

  it("rejects an invalid manifest code, naming the file", async () => {
    await writeProvider("upper", email("Upper-Case"), MODULE);
    await expect(loadEmailProvider({ provider: "upper", providersDir: dir })).rejects.toThrow(
      /Invalid email provider code "Upper-Case" in .*package\.json/,
    );
  });

  it("rejects a provider manifest without a kind", async () => {
    await writeProvider("nokind", { provider: "nokind" }, MODULE);
    await expect(loadEmailProvider({ provider: "nokind", providersDir: dir })).rejects.toThrow(
      /without "fluxkit.kind" \(expected "email"\)/,
    );
  });

  it("names the file when a package.json cannot be parsed", async () => {
    await mkdir(join(dir, "broken"), { recursive: true });
    await writeFile(join(dir, "broken", "package.json"), "{ not json");
    await expect(loadEmailProvider({ provider: "anything", providersDir: dir })).rejects.toThrow(
      /Cannot parse .*broken.*package\.json/,
    );
  });
});
