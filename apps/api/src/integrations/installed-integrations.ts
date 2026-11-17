import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  TEST_ONLY_EMAIL_PROVIDERS,
  TEST_ONLY_PAYMENT_PROVIDERS,
  TEST_ONLY_SHIPPING_PROVIDERS,
} from "@fluxkit/config";
import {
  EMAIL_PROVIDER_CODE_PATTERN,
  isIntegrationKind,
  parseIntegrationSecretDeclarations,
  PAYMENT_PROVIDER_CODE_PATTERN,
  SHIPPING_PROVIDER_CODE_PATTERN,
  type IntegrationKind,
  type IntegrationSecretDeclaration,
} from "@fluxkit/core";
import { summarizeError } from "../common/error-summary.js";
import { INTEGRATIONS_CONFIG, type IntegrationsConfig } from "./integrations.config.js";

/** An installed provider package that declares at least one managed secret (`fluxkit.secrets`). */
export interface InstalledIntegration {
  readonly kind: IntegrationKind;
  readonly providerCode: string;
  readonly secrets: readonly IntegrationSecretDeclaration[];
  /** Absolute path of the package entry, for the plugin's own format rule. */
  readonly entryPath: string;
}

/** What a plugin may export next to `providerModule`: its own format rule, answering a problem text or nothing. */
type SecretValidator = (field: string, value: string) => string | undefined;

/** The plugin's entry could not be loaded, so its format rule is unknown and nothing is saved for it. */
export class IntegrationUnavailableError extends Error {
  constructor() {
    super("The provider package could not be loaded.");
    this.name = "IntegrationUnavailableError";
  }
}

const CODE_PATTERNS: Readonly<Record<IntegrationKind, RegExp>> = {
  email: EMAIL_PROVIDER_CODE_PATTERN,
  payment: PAYMENT_PROVIDER_CODE_PATTERN,
  shipping: SHIPPING_PROVIDER_CODE_PATTERN,
};

const TEST_ONLY: Readonly<Record<IntegrationKind, readonly string[]>> = {
  email: TEST_ONLY_EMAIL_PROVIDERS,
  payment: TEST_ONLY_PAYMENT_PROVIDERS,
  shipping: TEST_ONLY_SHIPPING_PROVIDERS,
};

interface Manifest {
  main?: unknown;
  fluxkit?: { provider?: unknown; kind?: unknown; secrets?: unknown };
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function staysInside(dir: string, entryPath: string): boolean {
  const relativeEntry = relative(dir, entryPath);
  return (
    relativeEntry !== "" &&
    relativeEntry !== ".." &&
    !relativeEntry.startsWith(`..${sep}`) &&
    resolve(relativeEntry) !== relativeEntry
  );
}

/**
 * The installed provider packages the admin can hold credentials for (ADR 0058), read from the package manifests like
 * the provider loaders do, but for every installed package and without importing any: being listed here does not enable
 * a provider. A package whose declaration is wrong is left out and logged, so one bad package cannot hide the others.
 * Read once per process: installing a package needs a deployment anyway.
 */
@Injectable()
export class InstalledIntegrations {
  private readonly logger = new Logger(InstalledIntegrations.name);
  private cached: Promise<readonly InstalledIntegration[]> | undefined;

  constructor(@Inject(INTEGRATIONS_CONFIG) private readonly config: IntegrationsConfig) {}

  list(): Promise<readonly InstalledIntegration[]> {
    this.cached ??= this.read().catch((error: unknown) => {
      // A failed read is not remembered: the next request tries again.
      this.cached = undefined;
      throw error;
    });
    return this.cached;
  }

  async find(kind: string, providerCode: string): Promise<InstalledIntegration | undefined> {
    const all = await this.list();
    return all.find((entry) => entry.kind === kind && entry.providerCode === providerCode);
  }

  /** Whether the server environment sets this secret: then the stored value is not used and cannot be changed here. */
  isSetInEnvironment(declaration: IntegrationSecretDeclaration): boolean {
    return (this.config.environment[declaration.envVariable] ?? "").trim() !== "";
  }

  /** The plugin's own format rule: a problem text (never the value) or `undefined`. A plugin without one accepts. */
  async validateSecret(
    integration: InstalledIntegration,
    field: string,
    value: string,
  ): Promise<string | undefined> {
    let imported: { validateIntegrationSecret?: unknown };
    try {
      imported = (await import(pathToFileURL(integration.entryPath).href)) as typeof imported;
    } catch (error) {
      this.logger.error(
        `Provider package of ${integration.kind}/${integration.providerCode} could not be loaded: ${summarizeError(error)}`,
      );
      throw new IntegrationUnavailableError();
    }
    const validator = imported.validateIntegrationSecret;
    if (validator === undefined) return undefined;
    if (typeof validator !== "function") throw new IntegrationUnavailableError();
    const problem: unknown = (validator as SecretValidator)(field, value);
    if (problem === undefined || typeof problem === "string") return problem;
    // A promise or any other answer is not a verdict: never read it as "accepted".
    this.logger.error(
      `Provider ${integration.kind}/${integration.providerCode}: validateIntegrationSecret must return a string or undefined.`,
    );
    throw new IntegrationUnavailableError();
  }

  private async read(): Promise<readonly InstalledIntegration[]> {
    if (this.config.providersDir === "") return [];
    let entries: string[];
    try {
      entries = await readdir(this.config.providersDir);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const found: InstalledIntegration[] = [];
    for (const entry of [...entries].sort()) {
      const installed = await this.readPackage(join(this.config.providersDir, entry));
      if (installed === undefined) continue;
      if (
        found.some(
          (known) => known.kind === installed.kind && known.providerCode === installed.providerCode,
        )
      ) {
        this.logger.error(
          `Provider ${installed.kind}/${installed.providerCode} is declared twice; the second package is ignored.`,
        );
        continue;
      }
      found.push(installed);
    }
    return Object.freeze(found);
  }

  private async readPackage(dir: string): Promise<InstalledIntegration | undefined> {
    let manifest: Manifest;
    try {
      manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as Manifest;
    } catch (error) {
      if (!isMissing(error)) {
        this.logger.error(`Cannot read the manifest in ${dir}: ${summarizeError(error)}`);
      }
      return undefined;
    }
    const kind = manifest.fluxkit?.kind;
    const providerCode = manifest.fluxkit?.provider;
    if (!isIntegrationKind(kind) || typeof providerCode !== "string") return undefined;
    if (!CODE_PATTERNS[kind].test(providerCode)) return undefined;
    if (this.config.isProduction && TEST_ONLY[kind].includes(providerCode)) return undefined;
    const declared = parseIntegrationSecretDeclarations(manifest.fluxkit?.secrets);
    if (!declared.ok) {
      this.logger.error(`Provider ${kind}/${providerCode}: ${declared.problem}.`);
      return undefined;
    }
    if (declared.fields.length === 0) return undefined;
    // A provider may only name its own variables: a manifest must not make this screen report on DATABASE_URL.
    const ownPrefix = `${providerCode.toUpperCase()}_`;
    const foreign = declared.fields.find((field) => !field.envVariable.startsWith(ownPrefix));
    if (foreign !== undefined) {
      this.logger.error(
        `Provider ${kind}/${providerCode}: the variable of "${foreign.field}" must start with ${ownPrefix}.`,
      );
      return undefined;
    }
    const main = typeof manifest.main === "string" ? manifest.main : "dist/index.js";
    const entryPath = resolve(dir, main);
    if (!staysInside(dir, entryPath)) {
      this.logger.error(`Provider ${kind}/${providerCode}: "main" must stay inside its package.`);
      return undefined;
    }
    return { kind, providerCode, secrets: declared.fields, entryPath };
  }
}
