import type {
  AdminShippingProviderCheck,
  AdminShippingProviderSettings,
} from "@fluxkit/api-client";
import {
  Alert,
  Button,
  DescriptionList,
  EmptyState,
  Field,
  Input,
  LiveRegion,
  Textarea,
  type Translator,
} from "@fluxkit/ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { describeProblem, type MessageDescriptor } from "../../lib/problem-messages";
import { runWrite, type WriteOutcome } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { useRefreshingResource } from "../../lib/use-refreshing-resource";
import { useResource } from "../../lib/use-resource";
import { PATHS } from "../../router/paths";
import { useUnsavedChangesGuard } from "../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../router/unsaved-changes-dialog";
import { ResourceFallback } from "../../views/status-views";
import { describe } from "../catalog-dictionaries/form-parts";
import { linkClass } from "../catalog-dictionaries/dictionary-frame";
import { CODE_PATTERN } from "../catalog-dictionaries/form-rules";
import { carrierCodesOf, providerHref } from "./method-view";
import {
  MAX_LISTED_ISSUES,
  SETTINGS_MAX_BYTES,
  parseSettingsText,
  settingsIssuesFromProblem,
  settingsToText,
  type SettingsIssue,
} from "./provider-settings";
import { CHECK_REASONS, safeProviderCodes } from "./shipping-errors";
import { ShippingFrame } from "./shipping-frame";
import { useCanManageShipping } from "./shipping-permissions";

const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

// ------------------------------------------------------------------ the list of carriers

/** What the credentials note says, on both carrier screens: keys are environment variables, never typed or shown here. */
function CredentialsNote({ t }: { t: Translator }) {
  return (
    <Alert variant="info" title={t("ship.providers.credentialsTitle")}>
      <p>{t("ship.providers.credentialsBody")}</p>
    </Alert>
  );
}

export interface ProvidersViewProps {
  t: Translator;
  /** The carriers the methods name, or `null` while they are being read. */
  codes: readonly string[] | null;
  /** More methods exist than were read, so the list may miss a carrier. */
  partial: boolean;
  typed: string;
  onTyped: (value: string) => void;
}

/**
 * The carriers screen: the carriers the methods name (the API has no list of the enabled ones) and a field for the code of
 * another one. Opening is a link, so nothing is sent from here.
 */
export function ProvidersView({ t, codes, partial, typed, onTyped }: ProvidersViewProps) {
  const code = typed.trim();
  const valid = CODE_PATTERN.test(code);
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <CredentialsNote t={t} />
      <section aria-labelledby="providers-used" className="flex flex-col gap-2">
        <h2 id="providers-used" className="text-lg font-semibold text-foreground">
          {t("ship.providers.usedTitle")}
        </h2>
        {codes === null ? (
          <p className="text-muted-foreground">{t("status.loading")}</p>
        ) : codes.length === 0 ? (
          <EmptyState
            title={t("ship.providers.noneTitle")}
            description={t("ship.providers.noneBody")}
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {codes.map((entry) => (
              <li key={entry}>
                <Link to={providerHref(entry)} className={`${linkClass} break-all`}>
                  {entry}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {partial ? (
          <p className="text-sm text-muted-foreground">{t("ship.providers.partial")}</p>
        ) : null}
      </section>
      <section aria-labelledby="providers-open" className="flex flex-col gap-3">
        <h2 id="providers-open" className="text-lg font-semibold text-foreground">
          {t("ship.providers.openTitle")}
        </h2>
        <Field
          id="providers-code"
          label={t("ship.providers.codeLabel")}
          hint={t("ship.providers.codeHint")}
          error={code !== "" && !valid ? t("ship.error.codeFormat") : undefined}
        >
          {(control) => (
            <Input
              {...control}
              name="providerCode"
              value={typed}
              maxLength={64}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) => onTyped(event.target.value)}
            />
          )}
        </Field>
        <p>
          {valid ? (
            <Link to={providerHref(code)} className={linkClass}>
              {t("ship.providers.open", { code })}
            </Link>
          ) : (
            <span aria-disabled="true" className="text-muted-foreground">
              {t("ship.providers.openDisabled")}
            </span>
          )}
        </p>
      </section>
    </div>
  );
}

function ProvidersList() {
  const { t } = useI18n();
  const [typed, setTyped] = useState("");
  const methods = useResource(
    (signal) => adminClient.listShippingMethods({ limit: 100, offset: 0, signal }),
    [],
  );
  return (
    <ShippingFrame t={t} current="shippingProviders" title={t("page.shippingProviders.title")}>
      {methods.status === "error" ||
      methods.status === "forbidden" ||
      methods.status === "notFound" ? (
        <ResourceFallback t={t} state={methods} onRetry={methods.reload} />
      ) : (
        <ProvidersView
          t={t}
          codes={methods.status === "ready" ? carrierCodesOf(methods.data.items) : null}
          partial={methods.status === "ready" && methods.data.total > methods.data.items.length}
          typed={typed}
          onTyped={setTyped}
        />
      )}
    </ShippingFrame>
  );
}

/** `/shipping/providers`: the carriers of the shop. */
export function ShippingProvidersPage() {
  return <ProvidersList />;
}

// ------------------------------------------------------------------ one carrier

/** What a connection check ended with, in the terms the screen shows. */
export type CheckView =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok" }
  | { kind: "failed"; reason: string; providerCodes: string[] }
  | { kind: "problem"; descriptor: MessageDescriptor }
  | { kind: "unknown" };

/** The view of a finished check: the typed reason (never carrier text) and the raw carrier codes of a failure. */
export function checkViewFrom(outcome: WriteOutcome<AdminShippingProviderCheck>): CheckView {
  switch (outcome.kind) {
    case "aborted":
      return { kind: "idle" };
    case "unknown":
      return { kind: "unknown" };
    case "problem":
      return { kind: "problem", descriptor: describeProblem(outcome.status, outcome.problem) };
    case "ok":
      return outcome.data.ok
        ? { kind: "ok" }
        : {
            kind: "failed",
            reason: (CHECK_REASONS as readonly string[]).includes(outcome.data.reason)
              ? outcome.data.reason
              : "unavailable",
            providerCodes: safeProviderCodes(outcome.data.providerCodes),
          };
  }
}

export function CheckResult({ t, view }: { t: Translator; view: CheckView }) {
  switch (view.kind) {
    case "idle":
      return null;
    case "running":
      return <p className="text-muted-foreground">{t("ship.check.running")}</p>;
    case "ok":
      return <Alert variant="success">{t("ship.check.ok")}</Alert>;
    case "failed":
      return (
        <Alert variant="danger" title={t("ship.check.failedTitle")}>
          <p>{t(`ship.check.reason.${view.reason}`)}</p>
          {view.providerCodes.length === 0 ? null : (
            <p className="text-sm">
              {t("ship.check.codes")}{" "}
              <span className="break-all font-mono">{view.providerCodes.join(", ")}</span>
            </p>
          )}
        </Alert>
      );
    case "problem":
      return (
        <Alert variant="danger">
          <p>
            {describe(t, view.descriptor)}
            {view.descriptor.code === undefined ? null : (
              <small className="ms-2 text-muted-foreground">
                {t("errors.reference", { code: view.descriptor.code })}
              </small>
            )}
          </p>
        </Alert>
      );
    case "unknown":
      return (
        <Alert variant="warning" title={t("ship.check.unknownTitle")}>
          <p>{t("ship.check.unknownBody")}</p>
        </Alert>
      );
  }
}

type SaveView =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "unknown" }
  | { kind: "refused"; issues: SettingsIssue[]; top: MessageDescriptor | null; more: boolean };

export function SaveResult({ t, view }: { t: Translator; view: SaveView }) {
  switch (view.kind) {
    case "idle":
      return null;
    case "saved":
      return <Alert variant="success">{t("ship.settings.saved")}</Alert>;
    case "unknown":
      return (
        <Alert variant="warning" title={t("dict.unknown.title")}>
          <p>{t("ship.settings.unknownBody")}</p>
        </Alert>
      );
    case "refused":
      return (
        <Alert variant="danger" title={t("ship.settings.refusedTitle")}>
          {view.top === null ? null : <p>{describe(t, view.top)}</p>}
          {view.issues.length === 0 ? null : (
            <ul className="flex flex-col gap-1">
              {view.issues.map((entry, index) => (
                <li key={`${entry.path}-${String(index)}`}>
                  <span className="break-all font-mono">{entry.path}</span>
                  {": "}
                  {describe(t, entry.descriptor)}
                </li>
              ))}
            </ul>
          )}
          {view.more ? (
            <p className="text-sm">{t("ship.settings.moreIssues", { max: MAX_LISTED_ISSUES })}</p>
          ) : null}
        </Alert>
      );
  }
}

function ProviderPanel({ code, loaded }: { code: string; loaded: AdminShippingProviderSettings }) {
  const { t, locale } = useI18n();
  const canManage = useCanManageShipping();
  const [initialText, setInitialText] = useState(() => settingsToText(loaded.settings));
  const [text, setText] = useState(initialText);
  const [saved, setSaved] = useState<AdminShippingProviderSettings>(loaded);
  const [localIssue, setLocalIssue] = useState<MessageDescriptor | null>(null);
  const [saveView, setSaveView] = useState<SaveView>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [saveFlight] = useState(createSingleFlight);
  const [checkFlight] = useState(createSingleFlight);
  const [checkView, setCheckView] = useState<CheckView>({ kind: "idle" });
  const [checkBusy, setCheckBusy] = useState(false);
  const saveRef = useRef<HTMLDivElement>(null);
  const checkRef = useRef<HTMLDivElement>(null);
  const blocker = useUnsavedChangesGuard(text !== initialText && !busy);

  useEffect(() => {
    if (saveView.kind !== "idle") saveRef.current?.focus();
  }, [saveView]);
  useEffect(() => {
    if (checkView.kind !== "idle" && checkView.kind !== "running") checkRef.current?.focus();
  }, [checkView]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    const parsed = parseSettingsText(text);
    if (!parsed.ok) {
      setLocalIssue(parsed.issue);
      setSaveView({ kind: "idle" });
      document.getElementById("provider-settings")?.focus();
      return;
    }
    setLocalIssue(null);
    const running = saveFlight.run(() =>
      runWrite(() => adminClient.putShippingProviderSettings(code, { settings: parsed.settings })),
    );
    if (running === null) return;
    setBusy(true);
    setSaveView({ kind: "idle" });
    const outcome = await running.finally(() => setBusy(false));
    if (outcome.kind === "aborted") return;
    if (outcome.kind === "ok") {
      const next = settingsToText(outcome.data.settings);
      setSaved(outcome.data);
      setInitialText(next);
      setText(next);
      setSaveView({ kind: "saved" });
    } else if (outcome.kind === "problem") {
      const issues = settingsIssuesFromProblem(outcome.problem);
      setSaveView({
        kind: "refused",
        issues,
        top: issues.length === 0 ? describeProblem(outcome.status, outcome.problem) : null,
        more: (outcome.problem.errors?.length ?? 0) > MAX_LISTED_ISSUES,
      });
    } else {
      setSaveView({ kind: "unknown" });
    }
  }

  async function check() {
    const running = checkFlight.run(() => runWrite(() => adminClient.checkShippingProvider(code)));
    if (running === null) return;
    setCheckBusy(true);
    setCheckView({ kind: "running" });
    const outcome = await running.finally(() => setCheckBusy(false));
    setCheckView(checkViewFrom(outcome));
  }

  const meta = [
    {
      id: "saved",
      term: t("ship.settings.lastSaved"),
      description:
        saved.updatedAt === null
          ? t("ship.settings.neverSaved")
          : formatDateTime(saved.updatedAt, locale),
    },
  ];

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <CredentialsNote t={t} />
      <section aria-labelledby="provider-settings-title" className="flex flex-col gap-3">
        <h2 id="provider-settings-title" className="text-lg font-semibold text-foreground">
          {t("ship.settings.title")}
        </h2>
        <p className="max-w-prose text-muted-foreground">{t("ship.settings.intro")}</p>
        <DescriptionList items={meta} />
        <form
          method="post"
          onSubmit={(event) => void save(event)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div ref={saveRef} tabIndex={-1} className={focusClass}>
            <LiveRegion>
              <SaveResult t={t} view={saveView} />
            </LiveRegion>
          </div>
          <Field
            id="provider-settings"
            label={t("ship.settings.label")}
            hint={t("ship.settings.hint", { max: SETTINGS_MAX_BYTES / 1024 })}
            error={localIssue === null ? undefined : describe(t, localIssue)}
            required
            requiredIndicator={t("dict.form.requiredMark")}
          >
            {(control) => (
              <Textarea
                {...control}
                name="settings"
                rows={14}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                className="font-mono"
                value={text}
                readOnly={!canManage}
                onChange={(event) => setText(event.target.value)}
              />
            )}
          </Field>
          {canManage ? (
            <div>
              <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
                {busy ? t("dict.form.saving") : t("ship.settings.save")}
              </Button>
            </div>
          ) : null}
        </form>
      </section>
      <section aria-labelledby="provider-check-title" className="flex flex-col gap-3">
        <h2 id="provider-check-title" className="text-lg font-semibold text-foreground">
          {t("ship.check.title")}
        </h2>
        <p className="max-w-prose text-muted-foreground">{t("ship.check.intro")}</p>
        {canManage ? (
          <div>
            <Button
              variant="secondary"
              disabled={checkBusy}
              aria-busy={checkBusy || undefined}
              onClick={() => void check()}
            >
              {checkBusy ? t("ship.check.running") : t("ship.check.button")}
            </Button>
          </div>
        ) : null}
        <div ref={checkRef} tabIndex={-1} className={focusClass}>
          <LiveRegion>
            <CheckResult t={t} view={checkView} />
          </LiveRegion>
        </div>
      </section>
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}

/** A carrier the shop does not run: the API answers `404` for a code that is not in `SHIPPING_PROVIDERS_ENABLED`. */
export function ProviderNotEnabled({ t, code }: { t: Translator; code: string }) {
  return (
    <Alert variant="warning" title={t("ship.provider.notEnabledTitle", { code })}>
      <p>{t("ship.provider.notEnabledBody")}</p>
    </Alert>
  );
}

function ProviderScreen({ code }: { code: string }) {
  const { t } = useI18n();
  const resource = useRefreshingResource(
    (signal) => adminClient.getShippingProviderSettings(code, { signal }),
    [code],
  );
  return (
    <ShippingFrame t={t} current="shippingProviders" title={t("ship.provider.title", { code })}>
      <p>
        <Link to={PATHS.shippingProviders} className={linkClass}>
          {t("ship.provider.back")}
        </Link>
      </p>
      {resource.fallback?.status === "notFound" ? (
        <ProviderNotEnabled t={t} code={code} />
      ) : resource.fallback !== null ? (
        <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
      ) : resource.data === null ? null : (
        <ProviderPanel key={code} code={code} loaded={resource.data} />
      )}
    </ShippingFrame>
  );
}

/** `/shipping/providers/:code`: the saved profile of one carrier and its connection check. */
export function ShippingProviderDetailPage() {
  const { t } = useI18n();
  const { code } = useParams();
  if (code === undefined) throw new Error("The carrier route has no code parameter.");
  if (!CODE_PATTERN.test(code)) {
    return (
      <ShippingFrame
        t={t}
        current="shippingProviders"
        title={t("page.shippingProviderDetail.title")}
      >
        <ResourceFallback t={t} state={{ status: "notFound" }} onRetry={() => undefined} />
      </ShippingFrame>
    );
  }
  return <ProviderScreen key={code} code={code} />;
}
