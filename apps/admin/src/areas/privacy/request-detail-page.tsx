import type { AdminErasurePreview, AdminResult } from "@fluxkit/api-client";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { describeFailure, type MessageDescriptor } from "../../lib/problem-messages";
import { runWrite, type WriteOutcome } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { useRefreshingResource } from "../../lib/use-refreshing-resource";
import { PATHS } from "../../router/paths";
import { ResourceFallback } from "../../views/status-views";
import { browserDownloadEnvironment, downloadBlob } from "./export-download";
import { describePrivacyProblem, readErasureReasons } from "./privacy-errors";
import { ErrorBox, PrivacyFrame, StatusLine, linkClass } from "./privacy-frame";
import { useCanManagePrivacy } from "./privacy-permissions";
import {
  confirmationMatches,
  eraseNotice,
  exportBlob,
  exportBody,
  exportFileName,
  exportNotice,
  offeredRequestActions,
  type RejectReason,
  type RequestAction,
  type RequestNotice,
} from "./privacy-view";
import {
  EraseDialog,
  ErasurePreviewView,
  RejectDialog,
  RequestButtons,
  RequestFacts,
  RequestNoticeView,
  SubjectEmailField,
} from "./request-detail-view";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function RequestDetail({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const canManage = useCanManagePrivacy();
  // The request is read again after each write; the page (and its status line) stays while it runs.
  const resource = useRefreshingResource(
    (signal) => adminClient.getPrivacyRequest(id, { signal }),
    [id],
  );
  const [notice, setNotice] = useState<RequestNotice | null>(null);
  const [actionError, setActionError] = useState<MessageDescriptor | null>(null);
  const [asking, setAsking] = useState<"erase" | "reject" | null>(null);
  const [dialogError, setDialogError] = useState<MessageDescriptor | null>(null);
  const [dialogReasons, setDialogReasons] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // An email subject's address is typed here, kept in this component only (never in a URL or storage) and sent in bodies.
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<MessageDescriptor | null>(null);
  const [preview, setPreview] = useState<{ email: string; data: AdminErasurePreview } | null>(null);
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState<MessageDescriptor | null>(null);
  const [rejectValues, setRejectValues] = useState<{ reason: RejectReason; note: string }>({
    reason: "identity_not_confirmed",
    note: "",
  });
  const [flight] = useState(createSingleFlight);
  const statusRef = useRef<HTMLDivElement>(null);
  const actionErrorRef = useRef<HTMLDivElement>(null);
  const dialogErrorRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const typedRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (notice !== null) statusRef.current?.focus();
  }, [notice]);
  useEffect(() => {
    if (actionError !== null) actionErrorRef.current?.focus();
  }, [actionError]);
  useEffect(() => {
    if (dialogError !== null) dialogErrorRef.current?.focus();
  }, [dialogError]);
  useEffect(() => {
    if (typedError !== null) typedRef.current?.focus();
  }, [typedError]);

  /** One write through the single flight (a second request while one runs sends nothing), never retried. */
  async function send<T>(write: () => Promise<AdminResult<T>>): Promise<WriteOutcome<T> | null> {
    const running = flight.run(() => runWrite(write));
    if (running === null) return null;
    setBusy(true);
    try {
      return await running;
    } finally {
      setBusy(false);
    }
  }

  const request = resource.data;
  const actions = request === null ? [] : offeredRequestActions(request, canManage);

  /** The body of the export, preview and erase calls, or `null` after showing why there is none. */
  function bodyOrComplain() {
    if (request === null) return null;
    const built = exportBody(request, email);
    if (built.ok) return built.body;
    setEmailError({ key: `personal.detail.issue.${built.reason}` });
    emailRef.current?.focus();
    return null;
  }

  function showProblem(outcome: WriteOutcome<unknown> & { kind: "problem" }) {
    setActionError(describePrivacyProblem(outcome.status, outcome.problem, outcome.retryAfter));
    resource.reload();
  }

  async function doExport() {
    const body = bodyOrComplain();
    if (body === null) return;
    setEmailError(null);
    setActionError(null);
    setNotice(null);
    const outcome = await send(() => adminClient.exportPrivacyRequest(id, body));
    if (outcome === null || outcome.kind === "aborted") return;
    if (outcome.kind === "problem") return showProblem(outcome);
    if (outcome.kind === "unknown") {
      setNotice({ kind: "lost", action: "export" });
    } else {
      // The file comes from the typed client's parsed document, written as JSON with the JSON media type.
      downloadBlob(
        exportBlob(outcome.data),
        exportFileName(outcome.data),
        browserDownloadEnvironment(),
      );
      setNotice(exportNotice(outcome.data));
    }
    resource.reload();
  }

  async function doPreview() {
    const body = bodyOrComplain();
    if (body === null) return;
    setEmailError(null);
    setActionError(null);
    setNotice(null);
    const outcome = await send(() => adminClient.previewPrivacyErasure(id, body));
    if (outcome === null || outcome.kind === "aborted") return;
    if (outcome.kind === "problem") {
      setPreview(null);
      return showProblem(outcome);
    }
    if (outcome.kind === "unknown") {
      setPreview(null);
      setActionError(describeFailure(outcome.failure));
      return;
    }
    setPreview({ email: email.trim(), data: outcome.data });
    statusRef.current?.focus();
  }

  function askErase() {
    setNotice(null);
    setActionError(null);
    setDialogError(null);
    setDialogReasons([]);
    setTyped("");
    setTypedError(null);
    setAsking("erase");
  }

  function askReject() {
    setNotice(null);
    setActionError(null);
    setDialogError(null);
    setRejectValues({ reason: "identity_not_confirmed", note: "" });
    setAsking("reject");
  }

  function close() {
    if (busy || flight.pending()) return;
    setAsking(null);
    setDialogError(null);
    setDialogReasons([]);
  }

  async function confirmErase() {
    // The typed word is checked before anything is sent: a dialog without it never reaches the API.
    if (!confirmationMatches(typed, t("personal.erase.word"))) {
      setTypedError({ key: "personal.erase.typedMismatch" });
      return;
    }
    setTypedError(null);
    const body = bodyOrComplain();
    if (body === null) {
      setAsking(null);
      return;
    }
    const outcome = await send(() =>
      adminClient.erasePrivacyRequest(id, { ...body, confirm: true }),
    );
    if (outcome === null || outcome.kind === "aborted") return;
    if (outcome.kind === "problem") {
      // The dialog stays open with the reason (and the blockers); the request is read again.
      setDialogError(describePrivacyProblem(outcome.status, outcome.problem, outcome.retryAfter));
      setDialogReasons(readErasureReasons(outcome.problem));
      resource.reload();
      return;
    }
    setAsking(null);
    setDialogError(null);
    setPreview(null);
    setNotice(
      outcome.kind === "unknown" ? { kind: "lost", action: "erase" } : eraseNotice(outcome.data),
    );
    resource.reload();
  }

  async function confirmReject() {
    const note = rejectValues.note.trim();
    const outcome = await send(() =>
      adminClient.rejectPrivacyRequest(id, {
        reasonCode: rejectValues.reason,
        ...(note === "" ? {} : { note }),
      }),
    );
    if (outcome === null || outcome.kind === "aborted") return;
    if (outcome.kind === "problem") {
      setDialogError(describePrivacyProblem(outcome.status, outcome.problem, outcome.retryAfter));
      resource.reload();
      return;
    }
    setAsking(null);
    setDialogError(null);
    setNotice(
      outcome.kind === "unknown" ? { kind: "lost", action: "reject" } : { kind: "rejected" },
    );
    resource.reload();
  }

  // A preview belongs to the address it was made for: a changed address needs a new one.
  const previewValid = preview !== null && preview.email === email.trim();
  const showEmailField = request !== null && request.subjectKind === "email" && actions.length > 0;
  const hasErase = (actions as RequestAction[]).includes("erase");

  return (
    <PrivacyFrame t={t} current="privacyRequestDetail" title={t("page.privacyRequestDetail.title")}>
      <p>
        <Link to={PATHS.privacy} className={linkClass}>
          {t("personal.detail.back")}
        </Link>
      </p>
      {resource.fallback !== null ? (
        <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
      ) : request === null ? null : (
        <>
          <StatusLine innerRef={statusRef}>
            <RequestNoticeView t={t} notice={notice} />
          </StatusLine>
          <ErrorBox t={t} descriptor={actionError} innerRef={actionErrorRef} />
          <RequestFacts t={t} uiLocale={locale} request={request} />
          {actions.length === 0 ? null : (
            <section aria-labelledby="privacy-actions" className="flex max-w-3xl flex-col gap-3">
              <h2 id="privacy-actions" className="text-lg font-semibold text-foreground">
                {t("personal.detail.actionsTitle")}
              </h2>
              {showEmailField ? (
                <SubjectEmailField
                  t={t}
                  value={email}
                  onChange={(value) => {
                    setEmail(value);
                    setEmailError(null);
                  }}
                  error={emailError}
                  inputRef={emailRef}
                  disabled={busy}
                />
              ) : null}
              {hasErase && !previewValid ? (
                <p className="text-muted-foreground">{t("personal.detail.previewFirst")}</p>
              ) : null}
              <RequestButtons
                t={t}
                actions={actions}
                busy={busy}
                canErase={previewValid && preview.data.blockers.length === 0}
                onExport={() => void doExport()}
                onPreview={() => void doPreview()}
                onErase={askErase}
                onReject={askReject}
              />
            </section>
          )}
          {previewValid ? <ErasurePreviewView t={t} preview={preview.data} /> : null}
        </>
      )}
      <EraseDialog
        t={t}
        open={asking === "erase"}
        busy={busy}
        typed={typed}
        onTypedChange={(value) => {
          setTyped(value);
          setTypedError(null);
        }}
        typedError={typedError}
        error={dialogError}
        reasons={dialogReasons}
        errorRef={dialogErrorRef}
        typedRef={typedRef}
        onSubmit={() => void confirmErase()}
        onClose={close}
      />
      <RejectDialog
        t={t}
        open={asking === "reject"}
        busy={busy}
        reason={rejectValues.reason}
        note={rejectValues.note}
        onChange={setRejectValues}
        error={dialogError}
        errorRef={dialogErrorRef}
        onSubmit={() => void confirmReject()}
        onClose={close}
      />
    </PrivacyFrame>
  );
}

/** `/privacy/requests/:id`: one request with its export, erasure (preview, then a typed confirmation) and reject. */
export function PrivacyRequestDetailPage() {
  const { t } = useI18n();
  const { id } = useParams();
  if (id === undefined) throw new Error("The privacy request route has no id parameter.");
  if (!UUID_PATTERN.test(id)) {
    return (
      <PrivacyFrame
        t={t}
        current="privacyRequestDetail"
        title={t("page.privacyRequestDetail.title")}
      >
        <ResourceFallback t={t} state={{ status: "notFound" }} onRetry={() => undefined} />
      </PrivacyFrame>
    );
  }
  return <RequestDetail key={id} id={id} />;
}
