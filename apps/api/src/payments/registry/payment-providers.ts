import { pathToFileURL } from "node:url";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { MIN_ORDER_PAYMENT_TTL_MINUTES_WITH_PAYMENT_PROVIDER } from "@fluxkit/config";
import {
  PROVIDER_PAYMENT_ID_PATTERN,
  type ManagedProviderContext,
  type ManagedProviderExports,
  type PaymentProviderPort,
  type PaymentWebhookInput,
  type WebhookLocation,
} from "@fluxkit/core";
import type { DbExecutor } from "../../common/transaction.js";
import {
  ProblemException,
  serviceUnavailable,
  unauthorized,
  ruleViolation,
} from "../../common/problem.js";
import { findPostgresError } from "../../common/postgres-errors.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { integration, integrationCredentialVersion, payment } from "../../database/schema/index.js";
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
import { implementsPort, PaymentProviderRegistry } from "./payment-provider-registry.js";

export interface ActivePaymentProvider {
  readonly code: string;
  readonly versionId: string | null;
  readonly port: PaymentProviderPort;
}
export interface PaymentBinding {
  readonly providerCode: string;
  readonly integrationCredentialVersionId: string | null;
}
/** Every commerce consumer uses this asynchronous source; the boot registry stays env-only. */
@Injectable()
export class PaymentProviders {
  private readonly snapshot = new RevisionCache<readonly ActivePaymentProvider[]>();
  private readonly clients = new Map<string, { port: PaymentProviderPort; at: number }>();
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(PaymentProviderRegistry) private readonly env: PaymentProviderRegistry,
    @Inject(INTEGRATIONS_CONFIG) private readonly config: IntegrationsConfig,
    @Inject(IntegrationsRepository) private readonly repository: IntegrationsRepository,
    @Inject(InstalledIntegrations) private readonly installed: InstalledIntegrations,
    @Inject(SecretCipher) private readonly cipher: SecretCipher,
  ) {}
  async active(executor: DbExecutor = this.db): Promise<readonly ActivePaymentProvider[]> {
    if (!this.config.paymentDelegated)
      return this.env.list().map((port) => ({ code: port.code, versionId: null, port }));
    try {
      const revision = await this.repository.currentRevision(executor);
      const now = Date.now();
      const cached = this.snapshot.get(revision, now);
      if (cached.hit) return cached.value;
      const rows = (await this.repository.list(executor)).filter(
        (row) => row.kind === "payment" && row.enabled,
      );
      const result: ActivePaymentProvider[] = [];
      for (const row of rows) {
        const versionId = row.activeOutboundVersionId;
        if (versionId === null) throw new IntegrationUnavailableError();
        const version = await this.repository.findVersion(versionId, executor);
        if (version?.state !== "active") throw new IntegrationUnavailableError();
        await this.assertNewWork(row.providerCode, version.environment);
        const port = await this.load(row.providerCode, versionId, executor);
        if (port === undefined) throw new IntegrationUnavailableError();
        // A valid retained client can still serve old payment currencies after a shop currency change.
        if (!port.capabilities.currencies.includes(this.config.shopCurrency)) continue;
        result.push({ code: row.providerCode, versionId, port });
      }
      result.sort((a, b) => a.code.localeCompare(b.code));
      this.snapshot.set(revision, now, result);
      return result;
    } catch (error) {
      if (!isReadinessFailure(error)) throw error;
      new Logger(PaymentProviders.name).error("payment_credentials_unavailable");
      throw serviceUnavailable(5);
    }
  }
  async onlineEnabled(executor: DbExecutor = this.db): Promise<boolean> {
    return (await this.active(executor)).length > 0;
  }
  async forPayment(
    bound: PaymentBinding,
    executor: DbExecutor = this.db,
  ): Promise<PaymentProviderPort | undefined> {
    if (bound.integrationCredentialVersionId === null)
      return this.config.paymentDelegated ? undefined : this.env.get(bound.providerCode);
    return this.load(bound.providerCode, bound.integrationCredentialVersionId, executor);
  }
  /** Locks after the existing order/payment locks, in lifecycle order integration then version. */
  async admit(tx: DbExecutor, code: string): Promise<string | null> {
    if (!this.config.paymentDelegated) return null;
    const [row] = await tx
      .select()
      .from(integration)
      .where(and(eq(integration.kind, "payment"), eq(integration.providerCode, code)))
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
    await this.construct(row.id, installed, version, tx, true);
    return version.id;
  }
  /** Env-off keeps its previous no-op behavior; any retained managed binding still needs scanning. */
  async reconciliationEnabled(): Promise<boolean> {
    if (this.config.paymentDelegated || this.env.onlineEnabled()) return true;
    const [bound] = await this.db
      .select({ id: payment.id })
      .from(payment)
      .where(isNotNull(payment.integrationCredentialVersionId))
      .limit(1);
    return bound !== undefined;
  }
  private async assertNewWork(code: string, environment: string): Promise<InstalledIntegration> {
    const installed = await this.installed.find("payment", code);
    if (
      installed === undefined ||
      installed.secrets.some(
        (field) => field.purpose === "outbound" && this.installed.isSetInEnvironment(field),
      )
    )
      throw new IntegrationUnavailableError();
    this.installed.assertEnvironmentAllowed(installed, environment);
    if (
      this.config.orderPaymentTtlMinutes < MIN_ORDER_PAYMENT_TTL_MINUTES_WITH_PAYMENT_PROVIDER ||
      this.config.storefrontPublicUrl === null ||
      (this.config.isProduction && !this.config.storefrontPublicUrl.startsWith("https://"))
    )
      throw new IntegrationUnavailableError();
    return installed;
  }
  /** Recheck exact authority before any webhook fact/dedupe mutation, retaining locks until commit. */
  async assertFactAuthority(
    tx: DbExecutor,
    bound: PaymentBinding,
    verifiedVersionId: string | null,
  ): Promise<void> {
    if (bound.integrationCredentialVersionId !== verifiedVersionId) throw serviceUnavailable(5);
    if (verifiedVersionId === null) {
      if (this.config.paymentDelegated) throw serviceUnavailable(5);
      return;
    }
    const known = await this.repository.findVersion(verifiedVersionId, tx);
    if (known === undefined) throw serviceUnavailable(5);
    const [owner] = await tx
      .select()
      .from(integration)
      .where(eq(integration.id, known.integrationId))
      .for("share");
    const [version] = await tx
      .select()
      .from(integrationCredentialVersion)
      .where(eq(integrationCredentialVersion.id, verifiedVersionId))
      .for("share");
    if (
      owner?.kind !== "payment" ||
      owner.providerCode !== bound.providerCode ||
      version === undefined ||
      !["active", "draining"].includes(version.state)
    )
      throw serviceUnavailable(5);
  }
  async validateCandidate(
    integrationId: string,
    installed: InstalledIntegration,
    version: { id: string; generation: number; environment: string },
    executor: DbExecutor,
  ): Promise<void> {
    await this.construct(integrationId, installed, version, executor, true);
  }
  /** Metadata only: privacy exports must not open credential material. */
  async processorCodes(executor: DbExecutor = this.db): Promise<readonly string[]> {
    const rows = await executor
      .select({ code: integration.providerCode })
      .from(integration)
      .where(
        and(
          eq(integration.kind, "payment"),
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
  /** Untrusted hints choose exactly one verifier. They never create an attempt or establish a fact. */
  async webhook(
    code: string,
    input: PaymentWebhookInput,
  ): Promise<ActivePaymentProvider | undefined> {
    const installed = await this.installed.find("payment", code);
    // Env-only plugins need no managed exports. A retained DB binding still takes precedence.
    if (installed === undefined) {
      const [retained] = await this.db
        .select({ id: payment.id })
        .from(payment)
        .where(
          and(eq(payment.providerCode, code), isNotNull(payment.integrationCredentialVersionId)),
        )
        .limit(1);
      if (retained !== undefined) throw serviceUnavailable(5);
    }
    let location: WebhookLocation | null = null;
    if (installed !== undefined) {
      const module = await this.exports(installed);
      if (typeof module.locateWebhook === "function") {
        try {
          location = module.locateWebhook(input);
          if (location instanceof Promise) {
            void location.catch(() =>
              new Logger(PaymentProviders.name).error("payment_locator_rejected"),
            );
            throw unauthorized("The notification could not be verified.");
          }
        } catch {
          throw unauthorized("The notification could not be verified.");
        }
        if (location !== null && !validLocation(location))
          throw unauthorized("The notification could not be verified.");
      } else if (this.config.paymentDelegated) throw serviceUnavailable(5);
    }
    if (location !== null) {
      const byReference =
        location.reference !== undefined && UUID.test(location.reference)
          ? (
              await this.db
                .select()
                .from(payment)
                .where(and(eq(payment.id, location.reference), eq(payment.providerCode, code)))
            )[0]
          : undefined;
      const byProvider =
        location.providerPaymentId === undefined
          ? undefined
          : (
              await this.db
                .select()
                .from(payment)
                .where(
                  and(
                    eq(payment.providerCode, code),
                    eq(payment.providerPaymentId, location.providerPaymentId),
                  ),
                )
            )[0];
      const bound = byReference ?? byProvider;
      if (bound !== undefined) {
        if (
          (byReference !== undefined &&
            byProvider !== undefined &&
            byReference.id !== byProvider.id) ||
          (location.reference !== undefined && bound.id !== location.reference) ||
          (location.providerPaymentId !== undefined &&
            bound.providerPaymentId !== null &&
            bound.providerPaymentId !== location.providerPaymentId)
        )
          throw unauthorized("The notification could not be verified.");
        const port = await this.forPayment(bound);
        if (port === undefined) {
          if (bound.integrationCredentialVersionId === null && !this.config.paymentDelegated)
            return undefined;
          throw serviceUnavailable(5);
        }
        return { code, versionId: bound.integrationCredentialVersionId, port };
      }
    }
    return (await this.active()).find((entry) => entry.code === code);
  }
  private async load(
    code: string,
    versionId: string,
    executor: DbExecutor = this.db,
  ): Promise<PaymentProviderPort | undefined> {
    try {
      const version = await this.repository.findVersion(versionId, executor);
      if (
        version === undefined ||
        version.purpose !== "outbound" ||
        !["active", "draining"].includes(version.state)
      )
        return undefined;
      const owner = await this.repository.findById(version.integrationId, executor);
      if (owner?.kind !== "payment" || owner.providerCode !== code) return undefined;
      const now = Date.now();
      for (const [id, entry] of this.clients)
        if (now - entry.at >= CLIENT_IDLE_MS) this.clients.delete(id);
      const cached = this.clients.get(versionId);
      if (cached !== undefined) {
        this.clients.set(versionId, { ...cached, at: now });
        return cached.port;
      }
      const installed = await this.installed.find("payment", code);
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
      new Logger(PaymentProviders.name).error("payment_credential_unavailable");
      throw serviceUnavailable(5);
    }
  }
  private async exports(
    installed: InstalledIntegration,
  ): Promise<Partial<ManagedProviderExports<"payment">>> {
    try {
      return (await import(pathToFileURL(installed.entryPath).href)) as Partial<
        ManagedProviderExports<"payment">
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
    requireShopCurrency = false,
  ): Promise<PaymentProviderPort> {
    const module = await this.exports(installed);
    if (typeof module.createOutboundClient !== "function") throw new IntegrationUnavailableError();
    const secrets: Record<string, string> = {};
    for (const envelope of await this.repository.secretEnvelopes(version.id, tx))
      secrets[envelope.field] = this.cipher.open(
        {
          secretId: envelope.id,
          integrationId,
          kind: "payment",
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
      kind: "payment",
      providerCode: installed.providerCode,
      versionId: version.id,
      environment: version.environment,
      now: () => new Date(),
      transport: transportGateFor(this.db, version.id, ["active", "draining"]),
    });
    const client: unknown = module.createOutboundClient(secrets, context);
    if (client instanceof Promise) {
      void client.catch(() => new Logger(PaymentProviders.name).error("payment_factory_rejected"));
      throw new IntegrationUnavailableError();
    }
    if (
      !implementsPort(client) ||
      client.code !== installed.providerCode ||
      (client.capabilities.webhooks && typeof module.locateWebhook !== "function")
    )
      throw new IntegrationUnavailableError();
    if (requireShopCurrency && !client.capabilities.currencies.includes(this.config.shopCurrency))
      throw ruleViolation(
        "This provider does not support the shop currency.",
        "integration_currency_unsupported",
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validLocation(value: WebhookLocation): boolean {
  return (
    (value.reference !== undefined || value.providerPaymentId !== undefined) &&
    [value.reference, value.providerPaymentId].every(
      (id) => id === undefined || (typeof id === "string" && PROVIDER_PAYMENT_ID_PATTERN.test(id)),
    )
  );
}
