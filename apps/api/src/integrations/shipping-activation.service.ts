import { findPostgresError } from "../common/postgres-errors.js";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, notInArray } from "drizzle-orm";
import { shipment } from "../database/schema/index.js";
import type { VerifiedStepUp } from "../auth/step-up/admin-step-up.service.js";
import type { DbExecutor } from "../common/transaction.js";
import { ProblemException, ruleViolation } from "../common/problem.js";
import { AdminAuditWriter } from "../privacy/audit/admin-audit.writer.js";
import { ShippingProviders } from "../shipping/registry/shipping-providers.js";
import { INTEGRATIONS_CONFIG, type IntegrationsConfig } from "./integrations.config.js";
import { InstalledIntegrations, type InstalledIntegration } from "./installed-integrations.js";
import { IntegrationsRepository, type IntegrationRow } from "./integrations.repository.js";
import type { IntegrationAlertEvent } from "./integration-alerts.service.js";
import { SecretCipher } from "./secret-cipher.js";

type ResolvedIntegration = { row: IntegrationRow; installed: InstalledIntegration };

@Injectable()
export class ShippingActivationService {
  constructor(
    @Inject(INTEGRATIONS_CONFIG) private readonly config: IntegrationsConfig,
    @Inject(InstalledIntegrations) private readonly installed: InstalledIntegrations,
    @Inject(IntegrationsRepository) private readonly repository: IntegrationsRepository,
    @Inject(ShippingProviders) private readonly shipping: ShippingProviders,
    @Inject(SecretCipher) private readonly cipher: SecretCipher,
    @Inject(AdminAuditWriter) private readonly audit: AdminAuditWriter,
  ) {}
  async assertActivatable(transaction: DbExecutor, resolved: ResolvedIntegration) {
    const { row, installed } = resolved;
    if (
      !this.config.shippingDelegated ||
      installed.secrets.some(
        (entry) => entry.purpose === "outbound" && this.installed.isSetInEnvironment(entry),
      )
    )
      throw ruleViolation(
        "This shipping provider is controlled by the server.",
        "integration_env_override",
      );
    if (!this.cipher.isEnabled)
      throw ruleViolation("Credential storage is unavailable.", "integration_storage_disabled");
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
      await this.shipping.validateCandidate(row.id, installed, candidate, transaction);
    } catch (error) {
      if (error instanceof ProblemException) throw error;
      if (findPostgresError(error) !== undefined) throw error;
      throw ruleViolation("This provider cannot use this credential.", "integration_unavailable");
    }
    const [legacy] = await transaction
      .select({ id: shipment.id })
      .from(shipment)
      .where(
        and(
          eq(shipment.providerCode, row.providerCode),
          isNull(shipment.integrationCredentialVersionId),
          notInArray(shipment.status, ["delivered", "returned", "cancelled", "failed"]),
        ),
      )
      .limit(1);
    if (legacy !== undefined)
      throw ruleViolation(
        "Finish or reconcile legacy shipments before switching credentials.",
        "integration_legacy_work_open",
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
      kind: "shipping",
      providerCode: row.providerCode,
      generation: candidate.generation,
      occurredAt: now,
    };
  }
}
