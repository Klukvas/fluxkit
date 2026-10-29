import type { AdminPrivacyLookup } from "@fluxkit/api-client";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { describeFailure, type MessageDescriptor } from "../../lib/problem-messages";
import { runWrite } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { buildPath, PATHS } from "../../router/paths";
import { CreateRequestFormView, LookupForm, LookupResultView } from "./lookup-view";
import { describePrivacyProblem } from "./privacy-errors";
import { PrivacyFrame, StatusLine, linkClass } from "./privacy-frame";
import { useCanManagePrivacy } from "./privacy-permissions";
import {
  checkEmail,
  createRequestBody,
  type CreateRequestForm,
  type CreateRequestIssue,
} from "./privacy-view";

interface Found {
  /** The address that was looked up. It lives in this component's state only: never in a URL, storage or a log. */
  email: string;
  result: AdminPrivacyLookup;
}

/**
 * `/privacy/lookup`: what the shop holds for an email address. The address is typed here and sent in a POST body; the
 * lookup is audited by the API. From the result the owner records an export or erasure request.
 */
export function PrivacyLookupPage() {
  const { t, locale } = useI18n();
  const canManage = useCanManagePrivacy();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<MessageDescriptor | null>(null);
  const [error, setError] = useState<MessageDescriptor | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<CreateRequestForm>({
    kind: "export",
    subject: "address",
    customerId: null,
    email: "",
    note: "",
  });
  const [issue, setIssue] = useState<CreateRequestIssue | null>(null);
  const [createError, setCreateError] = useState<MessageDescriptor | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [flight] = useState(createSingleFlight);
  const statusRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const createErrorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (error !== null) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (createError !== null) createErrorRef.current?.focus();
  }, [createError]);
  useEffect(() => {
    if (found !== null || createdId !== null) statusRef.current?.focus();
  }, [found, createdId]);

  async function lookup() {
    const checked = checkEmail(email);
    if (!checked.ok) {
      setFieldError({ key: `personal.lookup.issue.${checked.reason}` });
      inputRef.current?.focus();
      return;
    }
    setFieldError(null);
    setError(null);
    const running = flight.run(() =>
      runWrite(() => adminClient.privacyLookup({ email: checked.email })),
    );
    if (running === null) return;
    setBusy(true);
    try {
      const outcome = await running;
      if (outcome.kind === "aborted") return;
      if (outcome.kind === "problem") {
        setFound(null);
        setError(describePrivacyProblem(outcome.status, outcome.problem, outcome.retryAfter));
      } else if (outcome.kind === "unknown") {
        // No answer: the lookup changes nothing but is audited. Nothing is repeated by itself.
        setFound(null);
        setError(describeFailure(outcome.failure));
      } else {
        setFound({ email: checked.email, result: outcome.data });
        setForm({
          kind: "export",
          subject: "address",
          customerId: outcome.data.customer?.id ?? null,
          email: checked.email,
          note: "",
        });
        setIssue(null);
        setCreateError(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const built = createRequestBody(form);
    if (!built.ok) {
      setIssue(built.reason);
      return;
    }
    setIssue(null);
    setCreateError(null);
    setCreatedId(null);
    const running = flight.run(() => runWrite(() => adminClient.createPrivacyRequest(built.body)));
    if (running === null) return;
    setBusy(true);
    try {
      const outcome = await running;
      if (outcome.kind === "aborted") return;
      if (outcome.kind === "problem") {
        setCreateError(describePrivacyProblem(outcome.status, outcome.problem, outcome.retryAfter));
      } else if (outcome.kind === "unknown") {
        // The request may or may not exist; the list shows what the server has. Never sent again by itself.
        setCreateError({ key: "personal.create.lost" });
      } else {
        // A link, not a redirect: the owner opens the new request when ready (the SPA navigates only through links).
        setCreatedId(outcome.data.id);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <PrivacyFrame t={t} current="privacyLookup" title={t("page.privacyLookup.title")}>
      <p className="max-w-prose text-muted-foreground">{t("personal.lookup.intro")}</p>
      <LookupForm
        t={t}
        email={email}
        onEmailChange={(value) => {
          setEmail(value);
          setFieldError(null);
        }}
        onSubmit={() => void lookup()}
        busy={busy}
        error={error}
        fieldError={fieldError}
        errorRef={errorRef}
        inputRef={inputRef}
      />
      <StatusLine innerRef={statusRef}>
        {createdId !== null ? (
          <p>
            {t("personal.create.done")}{" "}
            <Link
              to={buildPath(PATHS.privacyRequestDetail, { id: createdId })}
              className={linkClass}
            >
              {t("personal.create.open")}
            </Link>
          </p>
        ) : found === null ? null : (
          <p>{t("personal.lookup.done")}</p>
        )}
      </StatusLine>
      {found === null ? null : (
        <>
          <LookupResultView t={t} uiLocale={locale} result={found.result} />
          {canManage ? (
            <CreateRequestFormView
              t={t}
              hasAccount={found.result.customer !== null}
              values={form}
              onChange={setForm}
              onSubmit={() => void create()}
              busy={busy}
              issue={issue}
              error={createError}
              errorRef={createErrorRef}
            />
          ) : null}
        </>
      )}
    </PrivacyFrame>
  );
}
