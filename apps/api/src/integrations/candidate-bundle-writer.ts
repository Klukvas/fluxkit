import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { IntegrationSecretDeclaration } from "@fluxkit/core";
import type { DbExecutor } from "../common/transaction.js";
import { notFound, validationFailed } from "../common/problem.js";
import { InstalledIntegrations, type InstalledIntegration } from "./installed-integrations.js";
import { IntegrationsRepository, type IntegrationRow } from "./integrations.repository.js";
import type { PutIntegrationSecretBody } from "./integrations.schemas.js";
import { SecretCipher } from "./secret-cipher.js";

/** Builds a complete replacement generation within the caller's owner/revision transaction. */
@Injectable()
export class CandidateBundleWriter {
  constructor(
    @Inject(IntegrationsRepository) private readonly repository: IntegrationsRepository,
    @Inject(SecretCipher) private readonly cipher: SecretCipher,
    @Inject(InstalledIntegrations) private readonly installed: InstalledIntegrations,
  ) {}
  async write(
    transaction: DbExecutor,
    row: IntegrationRow,
    installed: InstalledIntegration,
    declaration: IntegrationSecretDeclaration,
    body: PutIntegrationSecretBody,
    actorId: string,
    now: Date,
  ): Promise<{ versionId: string; generation: number; replaced: boolean }> {
    const locked = await this.repository.findByIdForUpdate(row.id, transaction);
    if (locked === undefined) throw notFound("Integration");
    const purpose = declaration.purpose;
    const replaced = await this.repository.findCandidateForUpdate(transaction, row.id, purpose);
    const environment =
      body.environment ?? replaced?.environment ?? installed.environments?.default ?? "default";
    this.installed.assertEnvironmentAllowed(installed, environment);
    const supported = installed.environments?.values ?? ["default"];
    if (!supported.includes(environment))
      throw validationFailed([{ path: "environment", code: "invalid_value" }]);
    const active =
      purpose === "outbound" && locked.activeOutboundVersionId !== null
        ? await this.repository.findVersionForUpdate(transaction, locked.activeOutboundVersionId)
        : undefined;
    const base =
      replaced ?? (active?.state === "active" || active?.state === "draining" ? active : undefined);
    const generation = await this.repository.nextGeneration(transaction, row.id);
    const versionId = randomUUID();
    const retained =
      base !== undefined && base.environment === environment
        ? await this.repository.secretEnvelopes(base.id, transaction)
        : [];
    const declared = installed.secrets.filter((field) => field.purpose === purpose);
    const values = retained
      .filter(
        (secret) =>
          secret.field !== declaration.field &&
          declared.some((field) => field.field === secret.field),
      )
      .map((secret) => ({
        field: secret.field,
        value: this.cipher.open(
          {
            secretId: secret.id,
            integrationId: row.id,
            kind: installed.kind,
            providerCode: row.providerCode,
            field: secret.field,
            generation: base?.generation ?? generation,
          },
          secret,
        ),
      }));
    const secrets = [...values, { field: declaration.field, value: body.value }].map(
      ({ field, value }) => {
        const id = randomUUID();
        return {
          id,
          field,
          sealed: this.cipher.seal(
            {
              secretId: id,
              integrationId: row.id,
              kind: installed.kind,
              providerCode: row.providerCode,
              field,
              generation,
            },
            value,
          ),
        };
      },
    );
    if (replaced !== undefined) await this.repository.retire(transaction, replaced.id, now);
    await this.repository.insertCandidate(
      transaction,
      {
        id: versionId,
        integrationId: row.id,
        generation,
        purpose,
        environment,
        createdBy: actorId,
        createdAt: now,
      },
      secrets,
    );
    return { versionId, generation, replaced: replaced !== undefined };
  }
}
