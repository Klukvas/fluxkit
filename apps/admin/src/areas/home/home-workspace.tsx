import { AreaMessages } from "../../i18n/area-messages";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { useResource } from "../../lib/use-resource";
import type { LazyFile } from "../../messages";
import { useSession } from "../../session/session-context";
import {
  formatTotal,
  readCounter,
  selectWorkspace,
  type WorkspaceCounter,
} from "./workspace-model";
import { CounterView, WorkspaceView } from "./workspace-view";

export const MESSAGE_FILES = ["home"] as const satisfies readonly LazyFile[];

function Counter({ counter }: { counter: WorkspaceCounter }) {
  const { t, locale } = useI18n();
  const resource = useResource((signal) => readCounter(adminClient, counter, signal), [counter.id]);
  return (
    <CounterView
      t={t}
      counter={counter}
      state={resource}
      total={resource.status === "ready" ? formatTotal(resource.data.total, locale) : undefined}
      onRetry={resource.reload}
    />
  );
}

function WorkspaceForUser({ permissions }: { permissions: readonly string[] }) {
  const { t } = useI18n();
  const { counters, actions } = selectWorkspace(permissions);
  return (
    <WorkspaceView
      t={t}
      counters={counters.map((counter) => (
        <Counter key={counter.id} counter={counter} />
      ))}
      actions={actions}
    />
  );
}

export function HomeWorkspace() {
  const { state } = useSession();
  const me = state.me;
  if (me === null) return null;
  return (
    <AreaMessages files={MESSAGE_FILES}>
      <WorkspaceForUser key={me.user.id} permissions={me.permissions} />
    </AreaMessages>
  );
}
