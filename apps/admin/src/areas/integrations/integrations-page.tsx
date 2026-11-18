import type {
  AdminEmailRouteMode,
  AdminIntegration,
  AdminIntegrationSecret,
} from "@fluxkit/api-client";
import { LiveRegion } from "@fluxkit/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { runWrite } from "../../lib/run-write";
import { useRefreshingResource } from "../../lib/use-refreshing-resource";
import { PageHeader } from "../../views/status-views";
import { EmailRouteForm } from "./email-route-form";
import {
  IntegrationsListView,
  type IntegrationsState,
  type SecretAction,
} from "./integrations-list-view";
import { secretProblemErrors } from "./integrations-errors";
import { useCanManageIntegrations } from "./integrations-permissions";
import { SecretDialog, type SecretDialogResult, type SecretDialogTarget } from "./secret-dialog";

const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * `/integrations`: the installed providers and whether each credential is set. Every change goes through a dialog that
 * asks for the owner's password; after any answer the list is read again, so the screen and the `revision` the next
 * change sends are the server's.
 */
export function IntegrationsPage() {
  const { t, locale } = useI18n();
  const canManage = useCanManageIntegrations();
  const resource = useRefreshingResource((signal) => adminClient.listIntegrations({ signal }), []);
  const [target, setTarget] = useState<SecretDialogTarget | null>(null);
  const [notice, setNotice] = useState<SecretDialogResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  // After the dialog's own cleanup (it hands the focus back to its opener, which a removal may have taken off the page).
  useEffect(() => {
    if (notice !== null) statusRef.current?.focus();
  }, [notice]);

  const state: IntegrationsState =
    resource.fallback !== null
      ? resource.fallback
      : resource.data !== null
        ? { status: "ready", data: resource.data }
        : { status: "loading" };

  function open(
    action: SecretAction,
    integration: AdminIntegration,
    secret: AdminIntegrationSecret | null,
  ) {
    if (!canManage || resource.refreshing) return;
    setNotice(null);
    setTarget({ action, integration, secret });
  }

  const close = useCallback(() => setTarget(null), []);

  async function saveRoute(mode: AdminEmailRouteMode, currentPassword: string) {
    const data = resource.data;
    if (data === null || resource.refreshing || target !== null) return;
    const outcome = await runWrite(() =>
      adminClient.setEmailRouteMode({
        mode,
        expectedRevision: data.revision,
        currentPassword,
      }),
    );
    if (outcome.kind === "aborted") return;
    if (outcome.kind === "ok") {
      setRouteError(null);
      setNotice("routeSaved");
      resource.reload();
      return;
    }
    if (outcome.kind === "unknown") {
      setNotice("unknown");
      resource.reload();
      return;
    }
    const mapped = secretProblemErrors(outcome.status, outcome.problem, outcome.retryAfter);
    if (mapped.stale) {
      setNotice("stale");
      resource.reload();
      return;
    }
    const descriptor = mapped.fields.currentPassword ?? mapped.form[0];
    setRouteError(descriptor === undefined ? null : t(descriptor.key, descriptor.values));
  }

  function done(result: SecretDialogResult) {
    setTarget(null);
    setNotice(result);
    resource.reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("page.integrations.title")} description={t("intg.intro")} />
      <div ref={statusRef} tabIndex={-1} className={focusClass}>
        <LiveRegion>{notice === null ? null : t(`intg.notice.${notice}`)}</LiveRegion>
      </div>
      {state.status === "ready" && canManage ? (
        <EmailRouteForm
          key={state.data.emailRouteMode}
          t={t}
          mode={state.data.emailRouteMode}
          busy={resource.refreshing || target !== null}
          error={routeError}
          onSave={(mode, currentPassword) => {
            void saveRoute(mode, currentPassword);
          }}
        />
      ) : null}
      <IntegrationsListView
        t={t}
        uiLocale={locale}
        state={state}
        canManage={canManage}
        busy={resource.refreshing || target !== null}
        onRetry={resource.reload}
        onAction={open}
      />
      {target === null || resource.data === null ? null : (
        <SecretDialog
          target={target}
          revision={resource.data.revision}
          onClose={close}
          onDone={done}
        />
      )}
    </div>
  );
}
