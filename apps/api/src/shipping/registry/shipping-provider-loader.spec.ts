import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SHIPPING_PROVIDER_CODE_PATTERN } from "@fluxkit/core";
import { SHIPPING_PROVIDER_CODE } from "@fluxkit/config";
import { loadShippingProviders } from "./shipping-provider-loader.js";

describe("loadShippingProviders", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fluxkit-providers-"));
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

  const shipping = (provider: string): Record<string, unknown> => ({ provider, kind: "shipping" });

  it("the config package and core agree on the shape of a provider code", () => {
    expect(SHIPPING_PROVIDER_CODE.source).toBe(SHIPPING_PROVIDER_CODE_PATTERN.source);
  });

  it("loads nothing and does not read the folder when no provider is enabled", async () => {
    expect(await loadShippingProviders({ enabled: [], providersDir: join(dir, "nope") })).toEqual(
      [],
    );
  });

  it("does not import a provider that is present but disabled", async () => {
    await writeProvider("other", shipping("other"), "throw new Error('must not be imported');\n");
    expect(await loadShippingProviders({ enabled: [], providersDir: dir })).toEqual([]);
  });

  it("imports only the enabled provider, not a disabled one beside it", async () => {
    await writeProvider("one", shipping("one"), "export const providerModule = class One {};\n");
    await writeProvider("two", shipping("two"), "throw new Error('must not be imported');\n");
    const loaded = await loadShippingProviders({ enabled: ["one"], providersDir: dir });
    expect(loaded.map((provider) => provider.code)).toEqual(["one"]);
  });

  it("finds a provider by manifest code, regardless of the folder name", async () => {
    await writeProvider(
      "_sample",
      shipping("sample"),
      "export const providerModule = class M {};\n",
    );
    const loaded = await loadShippingProviders({ enabled: ["sample"], providersDir: dir });
    expect(loaded.map((provider) => provider.code)).toEqual(["sample"]);
  });

  it("ignores packages of another kind, even with the same code", async () => {
    await writeProvider(
      "pay",
      { provider: "sample", kind: "payment" },
      "throw new Error('must not be imported');\n",
    );
    await expect(loadShippingProviders({ enabled: ["sample"], providersDir: dir })).rejects.toThrow(
      /Shipping provider "sample" is enabled/,
    );
  });

  it("fails loudly when an enabled provider is missing (deleted folder)", async () => {
    await expect(loadShippingProviders({ enabled: ["gone"], providersDir: dir })).rejects.toThrow(
      /Shipping provider "gone" is enabled in SHIPPING_PROVIDERS_ENABLED/,
    );
    await expect(
      loadShippingProviders({ enabled: ["gone"], providersDir: join(dir, "does-not-exist") }),
    ).rejects.toThrow(/Shipping provider "gone" is enabled/);
  });

  it("fails loudly when the provider does not export providerModule", async () => {
    await writeProvider("bad", shipping("bad"), "export const nope = 1;\n");
    await expect(loadShippingProviders({ enabled: ["bad"], providersDir: dir })).rejects.toThrow(
      /must export "providerModule"/,
    );
  });

  it("fails loudly, with the cause, when the entry point throws on import", async () => {
    await writeProvider("broken", shipping("broken"), "throw new Error('boom');\n");
    let error: Error | undefined;
    try {
      await loadShippingProviders({ enabled: ["broken"], providersDir: dir });
    } catch (caught) {
      error = caught as Error;
    }
    expect(error?.message).toMatch(/"broken" could not be loaded .*boom/);
    expect((error?.cause as Error).message).toBe("boom");
  });

  it("fails loudly when the entry file does not exist", async () => {
    await writeProvider("nofile", shipping("nofile"), "", "missing.js");
    await expect(loadShippingProviders({ enabled: ["nofile"], providersDir: dir })).rejects.toThrow(
      /"nofile" could not be loaded/,
    );
  });

  it("rejects a manifest whose main escapes the provider folder", async () => {
    await writeProvider("evil", shipping("evil"), "export const providerModule = class {};\n");
    await writeFile(
      join(dir, "evil", "package.json"),
      JSON.stringify({ type: "module", main: "../outside.js", fluxkit: shipping("evil") }),
    );
    await expect(loadShippingProviders({ enabled: ["evil"], providersDir: dir })).rejects.toThrow(
      /must stay inside/,
    );
  });

  it("rejects two packages declaring the same code", async () => {
    await writeProvider("one", shipping("dup"), "export const providerModule = class {};\n");
    await writeProvider("two", shipping("dup"), "export const providerModule = class {};\n");
    await expect(loadShippingProviders({ enabled: ["dup"], providersDir: dir })).rejects.toThrow(
      /declared twice/,
    );
  });

  it("rejects an invalid manifest code, naming the file", async () => {
    await writeProvider(
      "upper",
      shipping("Upper-Case"),
      "export const providerModule = class {};\n",
    );
    await expect(loadShippingProviders({ enabled: ["upper"], providersDir: dir })).rejects.toThrow(
      /Invalid shipping provider code "Upper-Case" in .*package\.json/,
    );
  });

  it("rejects a provider manifest without a kind", async () => {
    await writeProvider(
      "nokind",
      { provider: "nokind" },
      "export const providerModule = class {};\n",
    );
    await expect(loadShippingProviders({ enabled: ["nokind"], providersDir: dir })).rejects.toThrow(
      /without "fluxkit.kind"/,
    );
  });

  it("names the file when a package.json cannot be parsed", async () => {
    await mkdir(join(dir, "broken"), { recursive: true });
    await writeFile(join(dir, "broken", "package.json"), "{ not json");
    await expect(
      loadShippingProviders({ enabled: ["anything"], providersDir: dir }),
    ).rejects.toThrow(/Cannot parse .*broken.*package\.json/);
  });
});
