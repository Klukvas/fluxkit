import type { AdminOperationName } from "@fluxkit/api-client";
import { canRun } from "../../permissions";
import { useSession } from "../../session/session-context";

/**
 * Whether the signed-in admin may run one operation of the admin API (the permission list of `GET /admin/auth/me`, never a
 * role name). Every write control of the products area is rendered only when this is true; the API decides anyway.
 */
export function useCan(operation: AdminOperationName): boolean {
  const session = useSession();
  return canRun(session.state.me?.permissions ?? null, operation);
}
