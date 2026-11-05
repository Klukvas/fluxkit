import type { AdminOperationName } from "@fluxkit/api-client";
import { canRun } from "../../permissions";
import { useSession } from "../../session/session-context";

/**
 * Every write the banner screens can make, by the API operation, the picture upload included (a banner without a picture
 * cannot be saved). A write control is rendered only when the signed-in admin may run ALL of them (`catalog.write` today,
 * ADR 0046; naming the operations keeps the screens following `ADMIN_OPERATIONS`). The API decides anyway: a 403 is shown.
 */
export const BANNER_WRITE_OPERATIONS = [
  "createHomeBanner",
  "updateHomeBanner",
  "deleteHomeBanner",
  "reorderHomeBanners",
  "uploadMedia",
] as const satisfies readonly AdminOperationName[];

export function canWriteBanners(permissions: readonly string[] | null): boolean {
  return BANNER_WRITE_OPERATIONS.every((operation) => canRun(permissions, operation));
}

export function useCanWriteBanners(): boolean {
  const session = useSession();
  return canWriteBanners(session.state.me?.permissions ?? null);
}
