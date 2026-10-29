import type { AdminOperationName } from "@fluxkit/api-client";
import { canRun } from "../../permissions";
import { useSession } from "../../session/session-context";

/**
 * Every call the Privacy screens make, by the API operation. The routes need privacy.manage (owner only, ADR 0033
 * decision 9) for reads and writes alike: the whole area holds personal data, so a screen is not shown to anyone without it.
 * A control is rendered only when the signed-in admin may run ALL of them; the API decides anyway and a 403 is shown.
 */
export const PRIVACY_WRITE_OPERATIONS = [
  "privacyLookup",
  "createPrivacyRequest",
  "exportPrivacyRequest",
  "previewPrivacyErasure",
  "erasePrivacyRequest",
  "rejectPrivacyRequest",
] as const satisfies readonly AdminOperationName[];

export function canManagePrivacy(permissions: readonly string[] | null): boolean {
  return PRIVACY_WRITE_OPERATIONS.every((operation) => canRun(permissions, operation));
}

export function useCanManagePrivacy(): boolean {
  const session = useSession();
  return canManagePrivacy(session.state.me?.permissions ?? null);
}
