import { pathToFileURL } from "node:url";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { EmailProviderPort, IntegrationKind } from "@fluxkit/core";
import { withTransaction } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { RevisionCache } from "./credential-cache.js";
import { InstalledIntegrations, IntegrationUnavailableError } from "./installed-integrations.js";
import { IntegrationsRepository } from "./integrations.repository.js";
import { ManagedEmailProvider } from "./managed-email-provider.js";
import { SecretCipher } from "./secret-cipher.js";

const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type OutboundModule = {
  createOutboundClient?: (secrets: { readonly api_key: string }) => EmailProviderPort;
};

/**
 * Resolves the email credential the process may send with while the route is delegated to the database (ADR 0058).
 * Every resolve reads the revision. A matching snapshot younger than five seconds is reused; a new revision reloads
 * at once. Plaintext and clients stay in this process. A database failure refuses the send instead of guessing.
 */
@Injectable()
export class IntegrationRuntime {
  private readonly logger = new Logger(IntegrationRuntime.name);
  private readonly cache = new RevisionCache<EmailProviderPort | undefined>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(IntegrationsRepository) private readonly repository: IntegrationsRepository,
    @Inject(InstalledIntegrations) private readonly installed: InstalledIntegrations,
    @Inject(SecretCipher) private readonly cipher: SecretCipher,
  ) {}

  /** Drops this process's snapshot. The next resolve reads the database. Other replicas notice the new revision. */
  drop(): void {
    this.cache.clear();
  }

  async emailProvider(now = Date.now()): Promise<EmailProviderPort | undefined> {
    const revision = await this.repository.currentRevision();
    const cached = this.cache.get(revision, now);
    if (cached.hit) return cached.value;
    const provider = await this.loadEmailProvider();
    this.cache.set(revision, now, provider);
    return provider;
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

  private async loadEmailProvider(): Promise<EmailProviderPort | undefined> {
    if (!this.cipher.isEnabled) return undefined;
    const rows = await this.repository.list();
    const enabled = rows.filter((row) => row.kind === "email" && row.enabled);
    if (enabled.length === 0) return undefined;
    if (enabled.length > 1) throw new Error("More than one email integration is enabled.");
    const row = enabled[0];
    if (row === undefined || row.activeOutboundVersionId === null) return undefined;
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
    const client = await this.openClient(installed.entryPath, row.providerCode, secrets);
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
  ): Promise<{ api_key: string }> {
    const envelopes = await this.repository.secretEnvelopes(versionId);
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
    return { api_key: apiKey };
  }

  private async openClient(
    entryPath: string,
    providerCode: string,
    secrets: { readonly api_key: string },
  ): Promise<EmailProviderPort> {
    let imported: OutboundModule;
    try {
      imported = (await import(pathToFileURL(entryPath).href)) as OutboundModule;
    } catch (error) {
      this.logger.error(
        `Email provider ${providerCode} could not be loaded: ${error instanceof Error ? error.name : "Error"}`,
      );
      throw new IntegrationUnavailableError();
    }
    if (typeof imported.createOutboundClient !== "function") {
      throw new IntegrationUnavailableError();
    }
    return imported.createOutboundClient(secrets);
  }
}
