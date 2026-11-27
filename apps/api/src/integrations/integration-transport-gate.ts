import { Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type {
  CredentialAdmissionDenied,
  IntegrationCredentialState,
  IntegrationTransportGate,
} from "@fluxkit/core";
import type { Database } from "../database/database.module.js";
import { integration, integrationCredentialVersion } from "../database/schema/index.js";
import { withTransaction } from "../common/transaction.js";

class AdmissionDenied extends Error implements CredentialAdmissionDenied {
  override readonly name = "CredentialAdmissionDenied";
  constructor(readonly code: CredentialAdmissionDenied["code"]) {
    super(code);
  }
}

/** A started call has an ambiguous outcome; raw transport and database causes must not escape. */
class TransportUnavailable extends Error {
  constructor() {
    super("credential_transport_unavailable");
  }
}

/** Locks follow lifecycle writes: integration first, then its immutable version. */
export function transportGateFor(
  db: Database,
  versionId: string,
  allowed: readonly IntegrationCredentialState[],
): IntegrationTransportGate {
  return {
    async start(signal, begin) {
      let started = false;
      try {
        const pending = await withTransaction(db, async (tx) => {
          const [known] = await tx
            .select({ integrationId: integrationCredentialVersion.integrationId })
            .from(integrationCredentialVersion)
            .where(eq(integrationCredentialVersion.id, versionId));
          if (known === undefined) throw new AdmissionDenied("credential_unavailable");
          const [owner] = await tx
            .select({ id: integration.id })
            .from(integration)
            .where(eq(integration.id, known.integrationId))
            .for("share");
          const [version] = await tx
            .select({ state: integrationCredentialVersion.state })
            .from(integrationCredentialVersion)
            .where(
              and(
                eq(integrationCredentialVersion.id, versionId),
                eq(integrationCredentialVersion.integrationId, known.integrationId),
              ),
            )
            .for("share");
          if (version?.state === "revoked") throw new AdmissionDenied("credential_revoked");
          if (
            owner === undefined ||
            version === undefined ||
            !allowed.some((state) => state === version.state) ||
            signal.aborted
          )
            throw new AdmissionDenied("credential_unavailable");
          started = true;
          const result = begin();
          if (result instanceof Promise) {
            void result.catch(() =>
              new Logger("IntegrationTransportGate").error("integration_transport_begin_rejected"),
            );
            throw new TransportUnavailable();
          }
          const { completion } = result;
          // Observe an immediate rejection while COMMIT is pending, retaining the original result for the caller.
          const settled = completion.then(
            (value) => ({ ok: true as const, value }),
            () => ({ ok: false as const }),
          );
          return { completion, settled };
        });
        await pending.settled;
        return await pending.completion;
      } catch (error) {
        if (error instanceof AdmissionDenied) throw error;
        new Logger("IntegrationTransportGate").error("integration_transport_failed");
        // A call that started before a failed commit has an ambiguous remote outcome, not a proof of non-start.
        if (started) throw new TransportUnavailable();
        throw new AdmissionDenied("credential_unavailable");
      }
    },
  };
}
