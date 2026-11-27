import type {
  AdminIntegration,
  AdminIntegrationCheck,
  AdminIntegrationCheckCode,
  AdminIntegrationVersion,
} from "@fluxkit/api-client";
import { Alert, Button, StatusBadge, type Translator } from "@fluxkit/ui";
import { useEffect, useRef, useState } from "react";
import { adminClient } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { runWrite } from "../../lib/run-write";
import { secretFieldLabel } from "./integrations-view";

const CHECK_MESSAGES: Record<AdminIntegrationCheckCode, string> = {
  ok: "intg.check.ok",
  invalid_credentials: "intg.check.invalid_credentials",
  unavailable: "intg.check.unavailable",
  rate_limited: "intg.check.rate_limited",
  not_supported: "intg.check.not_supported",
};

export function IntegrationCheckResult({
  t,
  result,
  uiLocale,
}: {
  t: Translator;
  result: AdminIntegrationCheck;
  uiLocale: string;
}) {
  const wait = result.retryAfterSeconds;
  if (
    !Object.hasOwn(CHECK_MESSAGES, result.code) ||
    !Number.isFinite(new Date(result.checkedAt).getTime()) ||
    (wait !== undefined && (!Number.isInteger(wait) || wait < 0 || wait > 86400))
  ) {
    return <Alert variant="warning">{t("intg.check.failed")}</Alert>;
  }
  return (
    <Alert variant={result.code === "ok" ? "info" : "warning"}>
      <p>{t(CHECK_MESSAGES[result.code])}</p>
      <p>{t("intg.check.checkedAt", { date: formatDateTime(result.checkedAt, uiLocale) })}</p>
      {result.retryAfterSeconds === undefined ? null : (
        <p className="tabular-nums">
          {t("intg.check.retryAfter", { seconds: result.retryAfterSeconds })}
        </p>
      )}
    </Alert>
  );
}

function VersionRow({
  t,
  uiLocale,
  integration,
  version,
  revision,
  canManage,
  busy,
  canCheck,
  onRevoke,
  onReload,
}: {
  t: Translator;
  uiLocale: string;
  integration: AdminIntegration;
  version: AdminIntegrationVersion;
  revision: number;
  canManage: boolean;
  busy: boolean;
  canCheck: boolean;
  onRevoke: () => void;
  onReload: () => void;
}) {
  const [result, setResult] = useState<AdminIntegrationCheck | null>(null);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function check() {
    if (request.current !== null || busy) return;
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    setResult(null);
    setFailed(false);
    try {
      const response = await runWrite(() =>
        adminClient.checkIntegration(
          integration.id,
          {
            expectedRevision: revision,
            versionId: version.id,
          },
          { signal: controller.signal },
        ),
      );
      if (controller.signal.aborted || response.kind === "aborted") return;
      if (response.kind === "ok" && response.data.versionId === version.id)
        setResult(response.data);
      else if (
        response.kind === "problem" &&
        response.problem.rule === "integration_revision_stale"
      )
        onReload();
      else setFailed(true);
    } finally {
      if (!controller.signal.aborted) setChecking(false);
      request.current = null;
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-control border border-border p-3">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium tabular-nums">
          {t("intg.version.title", { generation: version.generation })}
        </span>
        <StatusBadge
          tone={version.state === "active" ? "success" : "neutral"}
          label={t(`intg.state.${version.state}`)}
        />
      </p>
      <p className="text-sm text-muted-foreground">
        {t("intg.version.environment", { environment: version.environment })}
      </p>
      <p className="text-sm text-muted-foreground">
        {t("intg.secret.savedAt", { date: formatDateTime(version.createdAt, uiLocale) })}
      </p>
      <ul className="flex flex-col gap-1">
        {[
          ...new Set([
            ...integration.secrets
              .filter((secret) => secret.purpose === version.purpose)
              .map((secret) => secret.field),
            ...version.fields,
          ]),
        ].map((field) => {
          const label = secretFieldLabel(field);
          return (
            <li key={field}>
              {t(
                version.fields.includes(field)
                  ? "intg.version.fieldSaved"
                  : "intg.version.fieldMissing",
                { field: "key" in label ? t(label.key) : label.text },
              )}
            </li>
          );
        })}
      </ul>
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          {canCheck ? (
            <Button
              variant="secondary"
              disabled={busy || checking}
              aria-busy={checking || undefined}
              onClick={() => void check()}
            >
              {t(checking ? "intg.check.checking" : "intg.check.action")}
            </Button>
          ) : null}
          {version.state === "revoked" ? null : (
            <Button
              variant="secondary"
              disabled={busy || checking}
              aria-label={t("intg.version.revokeLabel", { generation: version.generation })}
              onClick={onRevoke}
            >
              {t("intg.action.revoke")}
            </Button>
          )}
        </div>
      ) : null}
      <div role="status" aria-live="polite">
        {result === null ? null : (
          <IntegrationCheckResult t={t} uiLocale={uiLocale} result={result} />
        )}
        {failed ? <Alert variant="warning">{t("intg.check.failed")}</Alert> : null}
      </div>
    </li>
  );
}

export function IntegrationVersions({
  t,
  uiLocale,
  integration,
  revision,
  canManage,
  busy,
  storageReady,
  onRevoke,
  onReload,
}: {
  t: Translator;
  uiLocale: string;
  integration: AdminIntegration;
  revision: number;
  canManage: boolean;
  busy: boolean;
  storageReady: boolean;
  onRevoke: (version: AdminIntegrationVersion) => void;
  onReload: () => void;
}) {
  return (
    <ul aria-label={t("intg.version.list")} className="flex flex-col gap-3">
      {integration.versions.map((version) => {
        const declared = integration.secrets.filter((secret) => secret.purpose === version.purpose);
        const complete =
          declared.length > 0 && declared.every((secret) => version.fields.includes(secret.field));
        return (
          <VersionRow
            key={version.id}
            t={t}
            uiLocale={uiLocale}
            integration={integration}
            version={version}
            revision={revision}
            canManage={canManage}
            busy={busy}
            canCheck={storageReady && complete && version.state !== "revoked"}
            onRevoke={() => onRevoke(version)}
            onReload={onReload}
          />
        );
      })}
    </ul>
  );
}
