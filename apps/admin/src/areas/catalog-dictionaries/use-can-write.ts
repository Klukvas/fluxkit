import { useSession } from "../../session/session-context";
import { canWriteDictionaries } from "./dictionary-permissions";

/** Whether the signed-in admin may write dictionaries (the permission list of `GET /admin/auth/me`, never a role name). */
export function useCanWrite(): boolean {
  const session = useSession();
  return canWriteDictionaries(session.state.me?.permissions ?? null);
}
