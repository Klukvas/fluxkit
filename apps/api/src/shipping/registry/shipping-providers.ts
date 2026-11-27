import { pathToFileURL } from "node:url";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import {
  type ManagedProviderContext,
  type ManagedProviderExports,
  type ShippingProviderPort,
} from "@fluxkit/core";
import type { DbExecutor } from "../../common/transaction.js";
import { ProblemException, serviceUnavailable } from "../../common/problem.js";
import { findPostgresError } from "../../common/postgres-errors.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { integration, integrationCredentialVersion } from "../../database/schema/index.js";
import { RevisionCache } from "../../integrations/credential-cache.js";
import {
  InstalledIntegrations,
  IntegrationUnavailableError,
  type InstalledIntegration,
} from "../../integrations/installed-integrations.js";
import {
  IntegrationsRepository,
  IntegrationRevisionUnavailableError,
} from "../../integrations/integrations.repository.js";
import {
  INTEGRATIONS_CONFIG,
  type IntegrationsConfig,
} from "../../integrations/integrations.config.js";
import { SecretCipher, SecretUnavailableError } from "../../integrations/secret-cipher.js";
import { transportGateFor } from "../../integrations/integration-transport-gate.js";
import { implementsPort, ShippingProviderRegistry } from "./shipping-provider-registry.js";

export interface ActiveShippingProvider {
  readonly code: string;
  readonly versionId: string | null;
  readonly environment: string;
  readonly port: ShippingProviderPort;
}
export interface ShippingBinding {
  readonly providerCode: string;
  readonly integrationCredentialVersionId: string | null;
}
/** Every commerce consumer uses this asynchronous source; the boot registry stays env-only. */
@Injectable()
export class ShippingProviders {
  private readonly snapshot = new RevisionCache<readonly ActiveShippingProvider[]>();
  private readonly identities = new WeakMap<ShippingProviderPort, string>();
  private readonly clients = new Map<string, { port: ShippingProviderPort; at: number }>();
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(ShippingProviderRegistry) private readonly env: ShippingProviderRegistry,
    @Inject(INTEGRATIONS_CONFIG) private readonly config: IntegrationsConfig,
    @Inject(IntegrationsRepository) private readonly repository: IntegrationsRepository,
    @Inject(InstalledIntegrations) private readonly installed: InstalledIntegrations,
    @Inject(SecretCipher) private readonly cipher: SecretCipher,
  ) {}
  async active(executor: DbExecutor = this.db): Promise<readonly ActiveShippingProvider[]> {
    if (!this.config.shippingDelegated)
      return this.env
        .list()
        .map((port) => ({ code: port.code, versionId: null, environment: "env", port }));
    try {
      const revision = await this.repository.currentRevision(executor);
      const now = Date.now();
      const cached = this.snapshot.get(revision, now);
      if (cached.hit) return cached.value;
      const rows = (await this.repository.list(executor)).filter(
        (row) => row.kind === "shipping" && row.enabled,
      );
      const result: ActiveShippingProvider[] = [];
      for (const row of rows) {
        const versionId = row.activeOutboundVersionId;
        if (versionId === null) throw new IntegrationUnavailableError();
        const version = await this.repository.findVersion(versionId, executor);
        if (version?.state !== "active") throw new IntegrationUnavailableError();
        await this.assertNewWork(row.providerCode, version.environment);
        const port = await this.load(row.providerCode, versionId, executor);
        if (port === undefined) throw new IntegrationUnavailableError();
        result.push({ code: row.providerCode, versionId, environment: version.environment, port });
      }
      result.sort((a, b) => a.code.localeCompare(b.code));
      this.snapshot.set(revision, now, result);
      return result;
    } catch (error) {
      if (!isReadinessFailure(error)) throw error;
      new Logger(ShippingProviders.name).error("shipping_credentials_unavailable");
      throw serviceUnavailable(5);
    }
  }
  async enabled(executor: DbExecutor = this.db): Promise<boolean> {
    return (await this.active(executor)).length > 0;
  }
  identity(port: ShippingProviderPort): string {
    return this.identities.get(port) ?? `${port.code}\u0000legacy\u0000env`;
  }
  async get(
    code: string,
    executor: DbExecutor = this.db,
  ): Promise<ShippingProviderPort | undefined> {
    return (await this.active(executor)).find((entry) => entry.code === code)?.port;
  }
  async list(executor: DbExecutor = this.db): Promise<readonly ShippingProviderPort[]> {
    return (await this.active(executor)).map((entry) => entry.port);
  }
  /** Advisory availability may fall back only AFTER a caller's SQL savepoint has rolled back. */
  async available(executor: DbExecutor = this.db): Promise<readonly ShippingProviderPort[]> {
    try {
      return executor === this.db
        ? await this.list(executor)
        : await executor.transaction((tx) => this.list(tx));
    } catch (error) {
      if (!(error instanceof ProblemException) || error.code !== "service_unavailable") throw error;
      return [];
    }
  }
  async assertActive(port: ShippingProviderPort): Promise<void> {
    const current = await this.get(port.code);
    if (current === undefined || this.identity(current) !== this.identity(port))
      throw new IntegrationUnavailableError();
  }
  get delegated(): boolean {
    return this.config.shippingDelegated;
  }
  /** Env-mode legacy rows keep the original enabled-tracking filter; bound work always scans. */
  legacyTrackingCodes(): readonly string[] | undefined {
    return this.config.shippingDelegated
      ? undefined
      : this.env
          .list()
          .filter((port) => port.capabilities.tracking)
          .map((port) => port.code);
  }
  async forShipment(
    bound: ShippingBinding,
    executor: DbExecutor = this.db,
  ): Promise<ShippingProviderPort | undefined> {
    if (bound.integrationCredentialVersionId === null)
      return this.config.shippingDelegated ? undefined : this.env.get(bound.providerCode);
    return this.load(bound.providerCode, bound.integrationCredentialVersionId, executor);
  }
  /** Locks after the existing order/shipping locks, in lifecycle order integration then version. */
  async admit(tx: DbExecutor, code: string): Promise<string | null> {
    if (!this.config.shippingDelegated) return null;
    const [row] = await tx
      .select()
      .from(integration)
      .where(and(eq(integration.kind, "shipping"), eq(integration.providerCode, code)))
      .for("share");
    if (row === undefined || !row.enabled || row.activeOutboundVersionId === null)
      throw new IntegrationUnavailableError();
    const [version] = await tx
      .select()
      .from(integrationCredentialVersion)
      .where(
        and(
          eq(integrationCredentialVersion.id, row.activeOutboundVersionId),
          eq(integrationCredentialVersion.integrationId, row.id),
        ),
      )
      .for("share");
    if (version?.state !== "active" || version.purpose !== "outbound")
      throw new IntegrationUnavailableError();
    const installed = await this.assertNewWork(code, version.environment);
    await this.construct(row.id, installed, version, tx);
    return version.id;
  }
  private async assertNewWork(code: string, environment: string): Promise<InstalledIntegration> {
    const installed = await this.installed.find("shipping", code);
    if (
      installed === undefined ||
      installed.secrets.some(
        (field) => field.purpose === "outbound" && this.installed.isSetInEnvironment(field),
      )
    )
      throw new IntegrationUnavailableError();
    this.installed.assertEnvironmentAllowed(installed, environment);
    return installed;
  }
  async validateCandidate(
    integrationId: string,
    installed: InstalledIntegration,
    version: { id: string; generation: number; environment: string },
    executor: DbExecutor,
  ): Promise<void> {
    await this.construct(integrationId, installed, version, executor);
  }
  /** Metadata only: privacy exports must not open credential material. */
  async processorCodes(executor: DbExecutor = this.db): Promise<readonly string[]> {
    const rows = await executor
      .select({ code: integration.providerCode })
      .from(integration)
      .where(
        and(
          eq(integration.kind, "shipping"),
          inArray(integrationCredentialVersion.state, ["active", "draining"]),
        ),
      )
      .innerJoin(
        integrationCredentialVersion,
        eq(integrationCredentialVersion.integrationId, integration.id),
      );
    return [
      ...new Set([...this.env.list().map((port) => port.code), ...rows.map((row) => row.code)]),
    ].sort();
  }
  private async load(
    code: string,
    versionId: string,
    executor: DbExecutor = this.db,
  ): Promise<ShippingProviderPort | undefined> {
    try {
      const version = await this.repository.findVersion(versionId, executor);
      if (
        version === undefined ||
        version.purpose !== "outbound" ||
        !["active", "draining"].includes(version.state)
      )
        return undefined;
      const owner = await this.repository.findById(version.integrationId, executor);
      if (owner?.kind !== "shipping" || owner.providerCode !== code) return undefined;
      const now = Date.now();
      for (const [id, entry] of this.clients)
        if (now - entry.at >= CLIENT_IDLE_MS) this.clients.delete(id);
      const cached = this.clients.get(versionId);
      if (cached !== undefined) {
        this.clients.set(versionId, { ...cached, at: now });
        return cached.port;
      }
      const installed = await this.installed.find("shipping", code);
      if (installed === undefined) return undefined;
      const port = await this.construct(owner.id, installed, version, executor);
      if (this.clients.size >= MAX_CLIENTS) {
        const oldest = [...this.clients].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest !== undefined) this.clients.delete(oldest[0]);
      }
      this.clients.set(versionId, { port, at: now });
      return port;
    } catch (error) {
      if (!isReadinessFailure(error)) throw error;
      new Logger(ShippingProviders.name).error("shipping_credential_unavailable");
      throw serviceUnavailable(5);
    }
  }
  private async exports(
    installed: InstalledIntegration,
  ): Promise<Partial<ManagedProviderExports<"shipping">>> {
    try {
      return (await import(pathToFileURL(installed.entryPath).href)) as Partial<
        ManagedProviderExports<"shipping">
      >;
    } catch {
      throw new IntegrationUnavailableError();
    }
  }
  private async construct(
    integrationId: string,
    installed: InstalledIntegration,
    version: { id: string; generation: number; environment: string },
    tx: DbExecutor,
  ): Promise<ShippingProviderPort> {
    const module = await this.exports(installed);
    if (typeof module.createOutboundClient !== "function") throw new IntegrationUnavailableError();
    const secrets: Record<string, string> = {};
    for (const envelope of await this.repository.secretEnvelopes(version.id, tx))
      secrets[envelope.field] = this.cipher.open(
        {
          secretId: envelope.id,
          integrationId,
          kind: "shipping",
          providerCode: installed.providerCode,
          field: envelope.field,
          generation: version.generation,
        },
        envelope,
      );
    if (
      !installed.secrets
        .filter((field) => field.purpose === "outbound")
        .every((field) => secrets[field.field] !== undefined)
    )
      throw new IntegrationUnavailableError();
    const context: ManagedProviderContext = Object.freeze({
      kind: "shipping",
      providerCode: installed.providerCode,
      versionId: version.id,
      environment: version.environment,
      now: () => new Date(),
      transport: transportGateFor(this.db, version.id, ["active", "draining"]),
    });
    let client: unknown;
    try {
      client = module.createOutboundClient(secrets, context);
    } catch {
      throw new IntegrationUnavailableError();
    }
    if (client instanceof Promise) {
      void client.catch(() =>
        new Logger(ShippingProviders.name).error("shipping_factory_rejected"),
      );
      throw new IntegrationUnavailableError();
    }
    if (!implementsPort(client) || client.code !== installed.providerCode)
      throw new IntegrationUnavailableError();
    this.identities.set(
      client,
      `${installed.providerCode}\u0000${version.id}\u0000${version.environment}`,
    );
    return client;
  }
}
const CLIENT_IDLE_MS = 5 * 60_000;
const MAX_CLIENTS = 128;
/** Only expected credential/readiness outages become advisory unavailability; bugs must escape. */
function isReadinessFailure(error: unknown): boolean {
  if (
    error instanceof IntegrationUnavailableError ||
    error instanceof IntegrationRevisionUnavailableError ||
    error instanceof SecretUnavailableError
  )
    return true;
  if (error instanceof ProblemException)
    return (
      error.code === "service_unavailable" ||
      (error.code === "rule_violation" && error.extensions.rule === "integration_env_override")
    );
  const code = findPostgresError(error)?.code;
  // Statement cancellation and lock timeout can be retried. Other SQL errors retain their identity.
  return code === "57014" || code === "55P03";
}
