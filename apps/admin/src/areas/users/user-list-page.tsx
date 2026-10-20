import { useSearchParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { useResource } from "../../lib/use-resource";
import { canRun } from "../../permissions";
import { PATHS } from "../../router/paths";
import { useSession } from "../../session/session-context";
import { listRequest, readUserListQuery, writeUserListQuery } from "./user-list-query";
import { UserListView, UserResultsView } from "./user-list-view";

/** `/users`: the server-driven list of admin users (owner only, `users.manage`); the paging lives in the URL. */
export function UserListPage() {
  const { t, locale } = useI18n();
  const session = useSession();
  const [params] = useSearchParams();
  const query = readUserListQuery(params);
  const queryKey = writeUserListQuery(query);
  const resource = useResource(
    (signal) => adminClient.listUsers({ ...listRequest(query), signal }),
    [queryKey],
  );
  const permissions = session.state.me?.permissions ?? null;
  return (
    <UserListView
      t={t}
      canCreate={canRun(permissions, "createUser")}
      results={
        <UserResultsView
          t={t}
          uiLocale={locale}
          meId={session.state.me?.user.id ?? null}
          query={query}
          state={resource}
          onRetry={resource.reload}
          hrefForOffset={(offset) => `${PATHS.users}${writeUserListQuery({ ...query, offset })}`}
        />
      }
    />
  );
}
