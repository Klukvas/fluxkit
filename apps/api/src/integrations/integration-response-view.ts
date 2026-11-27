import type { InstalledIntegration, InstalledIntegrations } from "./installed-integrations.js";
import type { IntegrationRow, StoredSecretSummary } from "./integrations.repository.js";
import type { IntegrationResponse, IntegrationVersionResponse } from "./integrations.schemas.js";
import type { SecretCipher } from "./secret-cipher.js";

export function integrationResponseView(
  resolved: { row: IntegrationRow; installed: InstalledIntegration },
  stored: readonly StoredSecretSummary[],
  versions: readonly IntegrationVersionResponse[],
  discovery: InstalledIntegrations,
  cipher: SecretCipher,
): IntegrationResponse {
  const { row, installed } = resolved;
  return {
    id: row.id,
    kind: installed.kind,
    providerCode: row.providerCode,
    enabled: row.enabled,
    environmentSource: discovery.lockedEnvironment(installed) === undefined ? "store" : "env",
    environment:
      discovery.lockedEnvironment(installed) ??
      versions.find((version) => version.state === "candidate" && version.purpose === "outbound")
        ?.environment ??
      installed.environments?.default ??
      "default",
    versions: versions.map(
      ({ id, purpose, generation, state, environment, createdAt, fields }) => ({
        id,
        purpose,
        generation,
        state,
        environment,
        createdAt,
        fields,
      }),
    ),
    ...(installed.environments === undefined
      ? {}
      : {
          environments: { ...installed.environments, values: [...installed.environments.values] },
        }),
    updatedAt: row.updatedAt.toISOString(),
    secrets: installed.secrets.map((declaration) => {
      const saved = stored.find(
        (entry) => entry.integrationId === row.id && entry.field === declaration.field,
      );
      const isInEnvironment = discovery.isSetInEnvironment(declaration);
      return {
        field: declaration.field,
        purpose: declaration.purpose,
        envVariable: declaration.envVariable,
        state: isInEnvironment ? "env" : saved === undefined ? "not_set" : "set",
        last4: null,
        versionId: saved?.versionId ?? null,
        generation: saved?.generation ?? null,
        savedAt: saved?.savedAt.toISOString() ?? null,
        keyAvailable: saved === undefined ? null : cipher.hasKey(saved.keyId),
        versionState:
          saved?.state === "candidate" ||
          saved?.state === "active" ||
          saved?.state === "draining" ||
          saved?.state === "revoked"
            ? saved.state
            : null,
      };
    }),
  };
}
