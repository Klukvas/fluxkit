import { canAccess, canRun } from "../../permissions";
import { useSession } from "../../session/session-context";

/**
 * What the signed-in role may do on the blog screens (plan section 7, owner's answer 7 (a)): read with `catalog.read`,
 * edit and delete with `catalog.write` (a cover also needs the upload), publish, schedule and unpublish with
 * `catalog.publish`. A control is rendered only when allowed; the API decides anyway and a 403 is shown.
 */
export interface BlogPermissions {
  canWrite: boolean;
  canUpload: boolean;
  canPublish: boolean;
}

export function blogPermissions(permissions: readonly string[] | null): BlogPermissions {
  return {
    canWrite: canAccess(permissions, "catalog.write"),
    canUpload: canRun(permissions, "uploadMedia"),
    canPublish: canAccess(permissions, "catalog.publish"),
  };
}

export function useBlogPermissions(): BlogPermissions {
  const session = useSession();
  return blogPermissions(session.state.me?.permissions ?? null);
}
