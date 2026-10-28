import type { AdminOperationName } from "@fluxkit/api-client";
import { canRun } from "../../permissions";
import { useSession } from "../../session/session-context";

/**
 * Every write the Email screens can make, by the API operation. A write control is rendered only when the signed-in admin
 * may run ALL of them (one permission today, email.manage). The routes themselves need email.manage already (the viewer
 * never reaches them, the API refuses every email route without it, reads included: the outbox shows addresses); the API
 * decides anyway and a 403 is shown.
 */
export const EMAIL_WRITE_OPERATIONS = [
  "sendTestEmail",
  "resendEmailMessage",
  "cancelEmailMessage",
] as const satisfies readonly AdminOperationName[];

export function canManageEmail(permissions: readonly string[] | null): boolean {
  return EMAIL_WRITE_OPERATIONS.every((operation) => canRun(permissions, operation));
}

export function useCanManageEmail(): boolean {
  const session = useSession();
  return canManageEmail(session.state.me?.permissions ?? null);
}
