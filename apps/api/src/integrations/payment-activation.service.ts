import { Inject, Injectable } from "@nestjs/common";
import { MIN_ORDER_PAYMENT_TTL_MINUTES_WITH_PAYMENT_PROVIDER } from "@fluxkit/config";
import type { VerifiedStepUp } from "../auth/step-up/admin-step-up.service.js";
import type { DbExecutor } from "../common/transaction.js";
import { ProblemException, ruleViolation } from "../common/problem.js";
import { AdminAuditWriter } from "../privacy/audit/admin-audit.writer.js";
import { PaymentProviders } from "../payments/registry/payment-providers.js";
import { INTEGRATIONS_CONFIG, type IntegrationsConfig } from "./integrations.config.js";
import { InstalledIntegrations, type InstalledIntegration } from "./installed-integrations.js";
import { IntegrationsRepository, type IntegrationRow } from "./integrations.repository.js";
import type { IntegrationAlertEvent } from "./integration-alerts.service.js";
import { SecretCipher } from "./secret-cipher.js";
import { PaymentMerchantEnrollment } from "./payment-merchant-enrollment.js";

type ResolvedIntegration = { row: IntegrationRow; installed: InstalledIntegration };

@Injectable()
export class PaymentActivationService {
  constructor(
    @Inject(INTEGRATIONS_CONFIG) private readonly config: IntegrationsConfig,
    @Inject(InstalledIntegrations) private readonly installed: InstalledIntegrations,
    @Inject(IntegrationsRepository) private readonly repository: IntegrationsRepository,
    @Inject(PaymentProviders) private readonly payments: PaymentProviders,
    @Inject(PaymentMerchantEnrollment) private readonly merchants: PaymentMerchantEnrollment,
    @Inject(SecretCipher) private readonly cipher: SecretCipher,
    @Inject(AdminAuditWriter) private readonly audit: AdminAuditWriter,
  ) {}
  async assertActivatable(transaction: DbExecutor, resolved: ResolvedIntegration) {
    const { row, installed } = resolved;
    if (
      !this.config.paymentDelegated ||
      installed.secrets.some(
        (entry) => entry.purpose === "outbound" && this.installed.isSetInEnvironment(entry),
      )
    )
      throw ruleViolation(
        "This payment provider is controlled by the server.",
        "integration_env_override",
      );
    if (!this.cipher.isEnabled)
      throw ruleViolation("Credential storage is unavailable.", "integration_storage_disabled");
    if (
      this.config.storefrontPublicUrl === null ||
      (this.config.isProduction && !this.config.storefrontPublicUrl.startsWith("https://"))
    )
      throw ruleViolation(
        "Set a public storefront URL before activating payments.",
        "integration_public_url_required",
      );
    if (this.config.orderPaymentTtlMinutes < MIN_ORDER_PAYMENT_TTL_MINUTES_WITH_PAYMENT_PROVIDER)
      throw ruleViolation(
        "The order payment window is too short for online payments.",
        "integration_payment_window_too_short",
      );
    const current = await this.repository.findCandidateForUpdate(transaction, row.id, "outbound");
    const retained =
      current === undefined && !row.enabled && row.activeOutboundVersionId !== null
        ? await this.repository.findVersionForUpdate(transaction, row.activeOutboundVersionId)
        : undefined;
    const candidate = current ?? (retained?.state === "draining" ? retained : undefined);
    if (candidate === undefined)
      throw ruleViolation(
        "Save a complete credential before activation.",
        "integration_not_activatable",
      );
    this.installed.assertEnvironmentAllowed(installed, candidate.environment);
    if (!(installed.environments?.values ?? ["default"]).includes(candidate.environment))
      throw ruleViolation("This environment is unavailable.", "integration_unavailable");
    const outbound = installed.secrets.filter((entry) => entry.purpose === "outbound");
    const fields = await this.repository.secretFields(transaction, candidate.id);
    if (outbound.length === 0 || !outbound.every((entry) => fields.includes(entry.field)))
      throw ruleViolation(
        "Save a complete credential before activation.",
        "integration_not_activatable",
      );
    try {
      await this.payments.validateCandidate(row.id, installed, candidate, transaction);
    } catch (error) {
      if (error instanceof ProblemException) throw error;
      throw ruleViolation("This provider cannot use this credential.", "integration_unavailable");
    }
    await this.merchants.assertActivation(
      transaction,
      row,
      installed,
      candidate.id,
      candidate.environment,
    );
    return candidate;
  }

  async activate(
    transaction: DbExecutor,
    resolved: ResolvedIntegration,
    verified: VerifiedStepUp,
    now: Date,
  ): Promise<IntegrationAlertEvent> {
    const { row } = resolved;
    const candidate = await this.assertActivatable(transaction, resolved);
    if (row.activeOutboundVersionId !== null && row.activeOutboundVersionId !== candidate.id) {
      const previous = await this.repository.findVersionForUpdate(
        transaction,
        row.activeOutboundVersionId,
      );
      if (previous?.state === "active")
        await this.repository.setCredentialState(transaction, previous.id, "draining", now);
    }
    await this.repository.setCredentialState(transaction, candidate.id, "active", now);
    await this.repository.setOutboundPointer(
      transaction,
      row.id,
      { enabled: true, versionId: candidate.id },
      verified.userId,
      now,
    );
    const auditEventId = await this.audit.record(transaction, verified.userId, {
      action: "integration.activated",
      targetKind: "integration",
      targetId: row.id,
      detail: {
        kind: row.kind,
        provider: row.providerCode,
        purpose: candidate.purpose,
        generation: candidate.generation,
        version: candidate.id,
      },
    });
    return {
      auditEventId,
      action: "integration.activated",
      kind: "payment",
      providerCode: row.providerCode,
      generation: candidate.generation,
      occurredAt: now,
    };
  }
}
