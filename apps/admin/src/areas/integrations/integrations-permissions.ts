import type { AdminOperationName } from "@fluxkit/api-client";
import { canRun } from "../../permissions";
import { useSession } from "../../session/session-context";

/**
 * The writes of the Integrations screen, by API operation. The controls are rendered only when the signed-in admin may
 * run all of them (one permission today, integrations.manage, which the route needs already; naming the operations keeps
 * the screen following `ADMIN_OPERATIONS` if the API splits them). The API decides anyway.
 */
export const INTEGRATION_WRITE_OPERATIONS = [
  "putIntegrationSecret",
  "retireIntegrationSecret",
] as const satisfies readonly AdminOperationName[];

export function canManageIntegrations(permissions: readonly string[] | null): boolean {
  return INTEGRATION_WRITE_OPERATIONS.every((operation) => canRun(permissions, operation));
}

export function useCanManageIntegrations(): boolean {
  const session = useSession();
  return canManageIntegrations(session.state.me?.permissions ?? null);
}
