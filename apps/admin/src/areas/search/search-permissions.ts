import type { AdminOperationName } from "@fluxkit/api-client";
import { canRun } from "../../permissions";
import { useSession } from "../../session/session-context";

/**
 * Every write the Search screens can make, by the API operation. The routes are read with `catalog.read` (the viewer sees
 * the status and the synonym groups), every write needs `catalog.write` (plan question 12: search tuning is catalog work,
 * so there is no new permission). A write control is rendered only when the signed-in admin may run ALL of them; the API
 * decides anyway and a 403 is shown.
 */
export const SEARCH_WRITE_OPERATIONS = [
  "requestSearchRebuild",
  "createSynonymGroup",
  "updateSynonymGroup",
  "deleteSynonymGroup",
] as const satisfies readonly AdminOperationName[];

export function canManageSearch(permissions: readonly string[] | null): boolean {
  return SEARCH_WRITE_OPERATIONS.every((operation) => canRun(permissions, operation));
}

export function useCanManageSearch(): boolean {
  const session = useSession();
  return canManageSearch(session.state.me?.permissions ?? null);
}
