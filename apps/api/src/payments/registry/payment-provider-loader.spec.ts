import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PAYMENT_PROVIDER_CODE_PATTERN, PAYMENT_PROVIDER_PACKAGE_KIND } from "@fluxkit/core";
import { loadEmailProvider } from "../../email/registry/index.js";
import { loadShippingProviders } from "../../shipping/registry/index.js";
import { loadPaymentProviders } from "./payment-provider-loader.js";

describe("loadPaymentProviders", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fluxkit-payment-providers-"));
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

  const payment = (provider: string): Record<string, unknown> => ({ provider, kind: "payment" });
  const MODULE = "export const providerModule = class M {};\n";
  const MUST_NOT_IMPORT = "throw new Error('must not be imported');\n";

  it("declares the kind core names", () => {
    expect(PAYMENT_PROVIDER_PACKAGE_KIND).toBe("payment");
    expect(PAYMENT_PROVIDER_CODE_PATTERN.test("monobank")).toBe(true);
  });

  it("an empty list loads nothing and does not read the folder", async () => {
    expect(await loadPaymentProviders({ enabled: [], providersDir: join(dir, "nope") })).toEqual(
      [],
    );
  });

  it("an empty list does not import a provider that is present", async () => {
    await writeProvider("fake-payment", payment("fake"), MUST_NOT_IMPORT);
    await writeProvider("monobank", payment("monobank"), MUST_NOT_IMPORT);
    expect(await loadPaymentProviders({ enabled: [], providersDir: dir })).toEqual([]);
  });

  it("an empty list never touches the folder: an unreadable manifest in it is not even parsed", async () => {
    await mkdir(join(dir, "broken"), { recursive: true });
    await writeFile(join(dir, "broken", "package.json"), "{ not json");
    expect(await loadPaymentProviders({ enabled: [], providersDir: dir })).toEqual([]);
  });

  it("imports only the enabled providers, not another one beside them", async () => {
    await writeProvider("one", payment("monobank"), MODULE);
    await writeProvider("two", payment("fake"), MUST_NOT_IMPORT);
    await writeProvider("three", payment("other"), MUST_NOT_IMPORT);
    const loaded = await loadPaymentProviders({ enabled: ["monobank"], providersDir: dir });
    expect(loaded.map((provider) => provider.code)).toEqual(["monobank"]);
  });

  it("loads several enabled providers in the order written, each once", async () => {
    await writeProvider("one", payment("monobank"), MODULE);
    await writeProvider("two", payment("fake"), MODULE);
    const loaded = await loadPaymentProviders({
      enabled: ["fake", "monobank", "fake"],
      providersDir: dir,
    });
    expect(loaded.map((provider) => provider.code)).toEqual(["fake", "monobank"]);
  });

  it("finds a provider by manifest code, regardless of the folder name", async () => {
    await writeProvider("_sample", payment("sample"), MODULE);
    const loaded = await loadPaymentProviders({ enabled: ["sample"], providersDir: dir });
    expect(loaded.map((provider) => provider.code)).toEqual(["sample"]);
  });

  it("ignores packages of another kind, even with the same code", async () => {
    await writeProvider("ship", { provider: "fake", kind: "shipping" }, MUST_NOT_IMPORT);
    await writeProvider("mail", { provider: "fake", kind: "email" }, MUST_NOT_IMPORT);
    await expect(loadPaymentProviders({ enabled: ["fake"], providersDir: dir })).rejects.toThrow(
      /Payment provider "fake" is enabled in PAYMENT_PROVIDERS_ENABLED/,
    );
  });

  it("a shipping, an email and a payment package may share a code; each loader takes its own kind", async () => {
    await writeProvider(
      "ship",
      { provider: "fake", kind: "shipping" },
      "export const providerModule = class Ship {};\n",
    );
    await writeProvider(
      "mail",
      { provider: "fake", kind: "email" },
      "export const providerModule = class Mail {};\n",
    );
    await writeProvider("pay", payment("fake"), "export const providerModule = class Pay {};\n");
    const [pay] = await loadPaymentProviders({ enabled: ["fake"], providersDir: dir });
    const [mail] = await loadEmailProvider({ provider: "fake", providersDir: dir });
    const [ship] = await loadShippingProviders({ enabled: ["fake"], providersDir: dir });
    expect(pay?.module.name).toBe("Pay");
    expect(mail?.module.name).toBe("Mail");
    expect(ship?.module.name).toBe("Ship");
  });

  it("fails loudly when an enabled provider is missing (deleted folder)", async () => {
    await expect(loadPaymentProviders({ enabled: ["gone"], providersDir: dir })).rejects.toThrow(
      /Payment provider "gone" is enabled in PAYMENT_PROVIDERS_ENABLED but no package with "fluxkit": \{"provider": "gone", "kind": "payment"\}/,
    );
    await expect(
      loadPaymentProviders({ enabled: ["gone"], providersDir: join(dir, "does-not-exist") }),
    ).rejects.toThrow(/Payment provider "gone" is enabled/);
  });

  it("one missing provider among present ones still stops the startup", async () => {
    await writeProvider("one", payment("monobank"), MODULE);
    await expect(
      loadPaymentProviders({ enabled: ["monobank", "gone"], providersDir: dir }),
    ).rejects.toThrow(/Payment provider "gone" is enabled/);
  });

  it("fails loudly when the provider does not export providerModule", async () => {
    await writeProvider("bad", payment("bad"), "export const nope = 1;\n");
    await expect(loadPaymentProviders({ enabled: ["bad"], providersDir: dir })).rejects.toThrow(
      /Payment provider "bad" must export "providerModule"/,
    );
  });

  it("fails loudly, with the cause, when the entry point throws on import", async () => {
    await writeProvider("broken", payment("broken"), "throw new Error('boom');\n");
    let error: Error | undefined;
    try {
      await loadPaymentProviders({ enabled: ["broken"], providersDir: dir });
    } catch (caught) {
      error = caught as Error;
    }
    expect(error?.message).toMatch(/Payment provider "broken" could not be loaded .*boom/);
    expect((error?.cause as Error).message).toBe("boom");
  });

  it("fails loudly when the entry file does not exist", async () => {
    await writeProvider("nofile", payment("nofile"), "", "missing.js");
    await expect(loadPaymentProviders({ enabled: ["nofile"], providersDir: dir })).rejects.toThrow(
      /"nofile" could not be loaded/,
    );
  });

  it("rejects a manifest whose main escapes the provider folder", async () => {
    await writeProvider("evil", payment("evil"), MODULE);
    await writeFile(
      join(dir, "evil", "package.json"),
      JSON.stringify({ type: "module", main: "../outside.js", fluxkit: payment("evil") }),
    );
    await expect(loadPaymentProviders({ enabled: ["evil"], providersDir: dir })).rejects.toThrow(
      /must stay inside/,
    );
  });

  it("rejects two packages declaring the same code", async () => {
    await writeProvider("one", payment("dup"), MODULE);
    await writeProvider("two", payment("dup"), MODULE);
    await expect(loadPaymentProviders({ enabled: ["dup"], providersDir: dir })).rejects.toThrow(
      /Payment provider "dup" is declared twice/,
    );
  });

  it("rejects an invalid manifest code, naming the file", async () => {
    await writeProvider("upper", payment("Upper-Case"), MODULE);
    await expect(loadPaymentProviders({ enabled: ["upper"], providersDir: dir })).rejects.toThrow(
      /Invalid payment provider code "Upper-Case" in .*package\.json/,
    );
  });

  it("rejects a provider manifest without a kind", async () => {
    await writeProvider("nokind", { provider: "nokind" }, MODULE);
    await expect(loadPaymentProviders({ enabled: ["nokind"], providersDir: dir })).rejects.toThrow(
      /without "fluxkit.kind" \(expected "payment"\)/,
    );
  });

  it("names the file when a package.json cannot be parsed", async () => {
    await mkdir(join(dir, "broken"), { recursive: true });
    await writeFile(join(dir, "broken", "package.json"), "{ not json");
    await expect(
      loadPaymentProviders({ enabled: ["anything"], providersDir: dir }),
    ).rejects.toThrow(/Cannot parse .*broken.*package\.json/);
  });
});
