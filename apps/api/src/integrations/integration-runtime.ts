import { pathToFileURL } from "node:url";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  isEmailProviderCapabilities,
  type EmailProviderPort,
  type IntegrationKind,
  type IntegrationCredentialState,
  type ManagedProviderContext,
  type IntegrationTransportGate,
} from "@fluxkit/core";
import { withTransaction, type DbExecutor } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { RevisionCache } from "./credential-cache.js";
import {
  InstalledIntegrations,
  IntegrationUnavailableError,
  type InstalledIntegration,
} from "./installed-integrations.js";
import { IntegrationsRepository } from "./integrations.repository.js";
import { ManagedEmailProvider } from "./managed-email-provider.js";
import { SecretCipher } from "./secret-cipher.js";
import { storedEmailChain } from "./stored-email-route.js";

import { transportGateFor } from "./integration-transport-gate.js";

const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type OutboundModule = {
  createOutboundClient?: (
    secrets: Readonly<Record<string, string>> & { readonly api_key: string },
    context: ManagedProviderContext,
  ) => EmailProviderPort;
};

/**
 * Resolves the stored email chain while the route is delegated to the database (ADR 0058).
 * Resend and Brevo may both be on, in that order. Any other second email provider is refused at activation.
 * Every resolve reads the revision. A matching snapshot younger than five seconds is reused; a new revision reloads
 * at once. Plaintext and clients stay in this process. A database failure refuses the send instead of guessing.
 */
@Injectable()
export class IntegrationRuntime {
  private readonly logger = new Logger(IntegrationRuntime.name);
  private readonly cache = new RevisionCache<readonly EmailProviderPort[]>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(IntegrationsRepository) private readonly repository: IntegrationsRepository,
    @Inject(InstalledIntegrations) private readonly installed: InstalledIntegrations,
    @Inject(SecretCipher) private readonly cipher: SecretCipher,
  ) {}

  gateFor(
    versionId: string,
    allowed: readonly IntegrationCredentialState[],
  ): IntegrationTransportGate {
    return transportGateFor(this.db, versionId, allowed);
  }

  async validateEmailCandidate(
    integrationId: string,
    installed: InstalledIntegration,
    version: { id: string; generation: number; environment: string },
    executor: DbExecutor,
  ): Promise<void> {
    const secrets = await this.openSecrets(
      integrationId,
      "email",
      installed.providerCode,
      version.generation,
      version.id,
      executor,
    );
    await this.openClient(
      installed.entryPath,
      installed.providerCode,
      secrets,
      this.contextFor(installed.providerCode, version),
    );
  }

  private contextFor(
    providerCode: string,
    version: { id: string; environment: string },
  ): ManagedProviderContext {
    return Object.freeze({
      kind: "email",
      providerCode,
      versionId: version.id,
      environment: version.environment,
      now: () => new Date(),
      transport: this.gateFor(version.id, ["active", "draining"]),
    });
  }

  /** Drops this process's snapshot. The next resolve reads the database. Other replicas notice the new revision. */
  drop(): void {
    this.cache.clear();
  }

  async emailProviders(now = Date.now()): Promise<readonly EmailProviderPort[]> {
    const revision = await this.repository.currentRevision();
    const cached = this.cache.get(revision, now);
    if (cached.hit) return cached.value;
    const providers = await this.loadEmailProviders();
    this.cache.set(revision, now, providers);
    return providers;
  }

  /**
   * Binds a not-yet-bound mail to the active version, or lets an already-bound draining mail finish.
   * Anything revoked, retired or no longer selected is refused before the provider is called.
   */
  async admit(versionId: string, messageId: string): Promise<boolean> {
    if (!MESSAGE_ID.test(messageId)) return false;
    return withTransaction(this.db, async (transaction) => {
      const known = await this.repository.findVersion(versionId, transaction);
      if (known === undefined) return false;
      const row = await this.repository.findByIdForUpdate(known.integrationId, transaction);
      const version = await this.repository.findVersionForUpdate(transaction, versionId);
      if (row === undefined || version === undefined) return false;
      if (version.state === "revoked" || version.state === "retired") return false;
      const bound = await this.repository.emailBinding(transaction, messageId);
      if (bound === undefined) return false;
      if (bound === versionId) {
        return version.state === "active" || version.state === "draining";
      }
      if (bound !== null) return false;
      if (!row.enabled || row.activeOutboundVersionId !== versionId || version.state !== "active") {
        return false;
      }
      await this.repository.bindEmail(transaction, messageId, versionId);
      return true;
    });
  }

  async release(messageId: string, versionId: string): Promise<void> {
    if (!MESSAGE_ID.test(messageId)) return;
    await withTransaction(this.db, (transaction) =>
      this.repository.releaseEmail(transaction, messageId, versionId),
    );
  }

  private async loadEmailProviders(): Promise<readonly EmailProviderPort[]> {
    if (!this.cipher.isEnabled) return [];
    const rows = await this.repository.list();
    const enabled = storedEmailChain(rows.filter((row) => row.kind === "email" && row.enabled));
    const providers: EmailProviderPort[] = [];
    for (const row of enabled) {
      const provider = await this.loadEmailProvider(row);
      if (provider !== undefined) providers.push(provider);
    }
    return providers;
  }

  private async loadEmailProvider(row: {
    readonly id: string;
    readonly providerCode: string;
    readonly activeOutboundVersionId: string | null;
  }): Promise<EmailProviderPort | undefined> {
    if (row.activeOutboundVersionId === null) return undefined;
    const version = await this.repository.findVersion(row.activeOutboundVersionId);
    if (version === undefined || version.state !== "active") return undefined;
    const installed = await this.installed.find("email", row.providerCode);
    if (installed === undefined) return undefined;
    const secrets = await this.openSecrets(
      row.id,
      "email",
      row.providerCode,
      version.generation,
      version.id,
    );
    const client = await this.openClient(
      installed.entryPath,
      row.providerCode,
      secrets,
      this.contextFor(row.providerCode, version),
    );
    return new ManagedEmailProvider(
      { providerCode: row.providerCode, versionId: version.id, client },
      this,
    );
  }

  private async openSecrets(
    integrationId: string,
    kind: IntegrationKind,
    providerCode: string,
    generation: number,
    versionId: string,
    executor: DbExecutor = this.db,
  ): Promise<Record<string, string> & { api_key: string }> {
    const envelopes = await this.repository.secretEnvelopes(versionId, executor);
    const secrets: Record<string, string> = {};
    for (const envelope of envelopes) {
      secrets[envelope.field] = this.cipher.open(
        {
          secretId: envelope.id,
          integrationId,
          kind,
          providerCode,
          field: envelope.field,
          generation,
        },
        envelope,
      );
    }
    const apiKey = secrets.api_key;
    if (apiKey === undefined) throw new Error("The active email credential has no api_key.");
    return { ...secrets, api_key: apiKey };
  }

  private async openClient(
    entryPath: string,
    providerCode: string,
    secrets: Readonly<Record<string, string>> & { readonly api_key: string },
    context: ManagedProviderContext,
  ): Promise<EmailProviderPort> {
    try {
      const imported = (await import(pathToFileURL(entryPath).href)) as OutboundModule;
      if (typeof imported.createOutboundClient !== "function")
        throw new IntegrationUnavailableError();
      const client: unknown = imported.createOutboundClient(secrets, context);
      if (client instanceof Promise) {
        void client.catch(() => this.logger.error("integration_factory_rejected"));
        throw new IntegrationUnavailableError();
      }
      if (
        client === null ||
        typeof client !== "object" ||
        !("code" in client) ||
        client.code !== providerCode ||
        !("send" in client) ||
        typeof client.send !== "function" ||
        !("capabilities" in client) ||
        !isEmailProviderCapabilities(client.capabilities)
      )
        throw new IntegrationUnavailableError();
      return client as EmailProviderPort;
    } catch {
      this.logger.error("integration_client_unavailable");
      throw new IntegrationUnavailableError();
    }
  }
}
