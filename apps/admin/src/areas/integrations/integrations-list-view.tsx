import type {
  AdminIntegration,
  AdminIntegrationList,
  AdminIntegrationSecret,
  AdminIntegrationStorage,
  AdminIntegrationVersion,
} from "@fluxkit/api-client";
import { Alert, Button, EmptyState, StatusBadge, type Translator } from "@fluxkit/ui";
import { formatDateTime } from "../../lib/format";
import { standaloneLinkClass } from "../../views/links";
import { ResourceFallback, type ResourceFallbackState } from "../../views/status-views";
import {
  groupByKind,
  providerLabel,
  providerRuntime,
  secretFieldLabel,
  secretView,
  type Label,
} from "./integrations-view";
import { IntegrationVersions } from "./integration-versions";
import { providerGuide, type ProviderGuide } from "./provider-guides";

/** The server variable of the encryption key, named in the "storage is off" warning (a name, not a text). */
export const STORAGE_KEY_VARIABLE = "SECRETS_ENCRYPTION_KEY";

const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export type SecretAction = "enter" | "replace" | "remove" | "turnOn" | "turnOff" | "revoke";

/** Actions that ask for the password and no key. */
export const PASSWORD_ONLY_ACTIONS = ["remove", "turnOn", "turnOff", "revoke"] as const;

export type IntegrationsState =
  | { status: "ready"; data: AdminIntegrationList }
  | Exclude<ResourceFallbackState, { status: "ready" }>;

export function labelText(t: Translator, label: Label): string {
  return "key" in label ? t(label.key) : label.text;
}

function Guide({ t, guide, open }: { t: Translator; guide: ProviderGuide; open: boolean }) {
  return (
    <details open={open} className="rounded-control border border-border p-3">
      <summary className={`cursor-pointer rounded-control font-medium ${focusClass}`}>
        {t("intg.guide.title")}
      </summary>
      <ol className="mt-3 flex list-decimal flex-col gap-2 ps-5">
        {guide.stepKeys.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ol>
      <ul className="mt-3 flex flex-col gap-1">
        {guide.links.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className={standaloneLinkClass}
            >
              {t("intg.guide.newTab", { label: t(link.labelKey) })}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

function SecretRow({
  t,
  uiLocale,
  provider,
  secret,
  storage,
  hintKey,
  showRevoke,
  canManage,
  busy,
  onAction,
}: {
  t: Translator;
  uiLocale: string;
  provider: string;
  secret: AdminIntegrationSecret;
  storage: AdminIntegrationStorage;
  hintKey: string | undefined;
  showRevoke: boolean;
  canManage: boolean;
  busy: boolean;
  onAction: (action: SecretAction) => void;
}) {
  const view = secretView(secret, storage);
  const field = labelText(t, secretFieldLabel(secret.field));
  const names = { field, provider };
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-t border-border pt-3">
      <div className="flex min-w-0 grow basis-64 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium wrap-break-word">{field}</span>
          <StatusBadge tone={view.tone} label={t(view.statusKey)} />
        </p>
        {view.envVariable === null ? null : (
          <p className="text-sm wrap-break-word text-muted-foreground">
            {t("intg.secret.envNote", { variable: view.envVariable })}
          </p>
        )}
        {view.savedAt === null ? null : (
          <p className="text-sm text-muted-foreground">
            {t("intg.secret.savedAt", { date: formatDateTime(view.savedAt, uiLocale) })}
          </p>
        )}
        {view.needsReentry ? (
          <Alert variant="warning">{t("intg.secret.needsReentry")}</Alert>
        ) : null}
        {hintKey === undefined ? null : (
          <p className="max-w-prose text-sm text-muted-foreground">{t(hintKey)}</p>
        )}
      </div>
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          {view.enter === null ? null : (
            <Button
              variant="secondary"
              disabled={busy || view.enter.disabled}
              aria-label={t(`intg.action.${view.enter.mode}Label`, names)}
              onClick={() => onAction(view.enter?.mode ?? "enter")}
            >
              {t(`intg.action.${view.enter.mode}`)}
            </Button>
          )}
          {view.removableVersionId === null ? null : (
            <Button
              variant="secondary"
              disabled={busy}
              aria-label={t("intg.action.removeLabel", names)}
              onClick={() => onAction("remove")}
            >
              {t("intg.action.remove")}
            </Button>
          )}
          {!showRevoke || view.revocableVersionId === null ? null : (
            <Button
              variant="secondary"
              disabled={busy}
              aria-label={t("intg.action.revokeLabel", names)}
              onClick={() => onAction("revoke")}
            >
              {t("intg.action.revoke")}
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}

function ProviderCard({
  t,
  uiLocale,
  integration,
  revision,
  storage,
  canManage,
  busy,
  onAction,
  onReload,
}: {
  t: Translator;
  uiLocale: string;
  integration: AdminIntegration;
  revision: number;
  storage: AdminIntegrationStorage;
  canManage: boolean;
  busy: boolean;
  onAction: (
    action: SecretAction,
    secret: AdminIntegrationSecret | null,
    version?: AdminIntegrationVersion,
  ) => void;
  onReload: () => void;
}) {
  const headingId = `intg-provider-${integration.id}`;
  const name = labelText(t, providerLabel(integration.providerCode));
  const guide = providerGuide(integration.providerCode);
  const runtime = providerRuntime(integration, storage);
  const isUntouched = integration.secrets.every((secret) => secret.state === "not_set");
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-background p-4"
    >
      <h3 id={headingId} className="text-lg font-semibold wrap-break-word">
        {name}
      </h3>
      {guide === null ? null : <Guide t={t} guide={guide} open={isUntouched} />}
      {canManage && (runtime.turnOn || runtime.turnOff) ? (
        <div className="flex flex-wrap gap-2">
          {runtime.turnOn ? (
            <Button
              disabled={busy}
              aria-label={t("intg.action.turnOnLabel", { provider: name })}
              onClick={() => onAction("turnOn", null)}
            >
              {t("intg.action.turnOn")}
            </Button>
          ) : null}
          {runtime.turnOff ? (
            <Button
              variant="secondary"
              disabled={busy}
              aria-label={t("intg.action.turnOffLabel", { provider: name })}
              onClick={() => onAction("turnOff", null)}
            >
              {t("intg.action.turnOff")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {integration.versions.length === 0 ? null : (
        <IntegrationVersions
          key={`${revision}:${String(busy)}`}
          t={t}
          uiLocale={uiLocale}
          integration={integration}
          revision={revision}
          canManage={canManage}
          busy={busy}
          storageReady={storage === "ready"}
          onRevoke={(version) => onAction("revoke", null, version)}
          onReload={onReload}
        />
      )}
      <ul className="flex flex-col gap-3">
        {integration.secrets.map((secret) => (
          <SecretRow
            key={secret.field}
            t={t}
            uiLocale={uiLocale}
            provider={name}
            secret={secret}
            storage={storage}
            hintKey={guide?.fieldHintKeys[secret.field]}
            showRevoke={integration.versions.length === 0}
            canManage={canManage}
            busy={busy}
            onAction={(action) => onAction(action, secret)}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * The Integrations screen: whether a saved email key is in use, whether the server can store one at all, then the
 * installed providers by kind. Props in, markup out; no secret ever reaches it.
 */
export function IntegrationsListView({
  t,
  uiLocale,
  state,
  canManage,
  busy,
  onRetry,
  onAction,
}: {
  t: Translator;
  uiLocale: string;
  state: IntegrationsState;
  canManage: boolean;
  /** A write or a reload runs: the revision on screen may be old, so no new change starts. */
  busy: boolean;
  onRetry: () => void;
  onAction: (
    action: SecretAction,
    integration: AdminIntegration,
    secret: AdminIntegrationSecret | null,
    version?: AdminIntegrationVersion,
  ) => void;
}) {
  if (state.status !== "ready") return <ResourceFallback t={t} state={state} onRetry={onRetry} />;
  const { storage, items } = state.data;
  return (
    <div className="flex flex-col gap-6">
      <Alert variant="info" title={t("intg.inactive.title")}>
        <p>{t("intg.inactive.body")}</p>
      </Alert>
      {storage === "disabled" ? (
        <Alert variant="warning" title={t("intg.storageDisabled.title")}>
          <p>{t("intg.storageDisabled.body", { variable: STORAGE_KEY_VARIABLE })}</p>
        </Alert>
      ) : null}
      {items.length === 0 ? (
        <EmptyState title={t("intg.empty.title")} description={t("intg.empty.body")} />
      ) : (
        groupByKind(items).map((group) => (
          <section
            key={group.kind}
            aria-labelledby={`intg-kind-${group.kind}`}
            className="flex flex-col gap-3"
          >
            <h2 id={`intg-kind-${group.kind}`} className="text-xl font-semibold">
              {t(`intg.kind.${group.kind}`)}
            </h2>
            {group.items.map((integration) => (
              <ProviderCard
                key={integration.id}
                t={t}
                uiLocale={uiLocale}
                integration={integration}
                storage={storage}
                revision={state.data.revision}
                onReload={onRetry}
                canManage={canManage}
                busy={busy}
                onAction={(action, secret, version) =>
                  onAction(action, integration, secret, version)
                }
              />
            ))}
          </section>
        ))
      )}
    </div>
  );
}
