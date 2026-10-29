import type { AdminErasurePreview, AdminPrivacyRequest } from "@fluxkit/api-client";
import {
  Alert,
  Badge,
  Button,
  DescriptionList,
  Dialog,
  Field,
  Input,
  Select,
  StatusBadge,
  Textarea,
  type DescriptionListItem,
  type Translator,
} from "@fluxkit/ui";
import type { FormEvent, ReactNode, Ref } from "react";
import { formatDateTime } from "../../lib/format";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { blockerReasonKey } from "./privacy-errors";
import { DescriptorText, ErrorBox } from "./privacy-frame";
import {
  NOTE_MAX_LENGTH,
  REJECT_REASONS,
  REQUEST_STATUS_TONES,
  kindLabelKey,
  resultRows,
  statusLabelKey,
  type RejectReason,
  type RequestAction,
  type RequestNotice,
} from "./privacy-view";

/** The facts of one request: kind, status, dates, subject, note and the stored result (counts and codes only). */
export function RequestFacts({
  t,
  uiLocale,
  request,
}: {
  t: Translator;
  uiLocale: string;
  request: AdminPrivacyRequest;
}) {
  const rows = resultRows(request.result);
  const items: DescriptionListItem[] = [
    { id: "kind", term: t("personal.detail.kind"), description: t(kindLabelKey(request.kind)) },
    {
      id: "status",
      term: t("personal.detail.status"),
      description: (
        <StatusBadge
          tone={REQUEST_STATUS_TONES[request.status]}
          label={t(statusLabelKey(request.status))}
        />
      ),
    },
    {
      id: "subject",
      term: t("personal.detail.subject"),
      description:
        request.subjectKind === "customer"
          ? t("personal.detail.subjectCustomer")
          : t("personal.detail.subjectEmail"),
    },
    {
      id: "channel",
      term: t("personal.detail.channel"),
      description: t(`personal.channel.${request.channel}`),
    },
    {
      id: "received",
      term: t("personal.detail.received"),
      description: formatDateTime(request.receivedAt, uiLocale),
    },
    {
      id: "due",
      term: t("personal.detail.due"),
      description: (
        <span className="flex flex-wrap items-center gap-2">
          {formatDateTime(request.dueAt, uiLocale)}
          {request.overdue ? <Badge variant="danger">{t("personal.list.overdue")}</Badge> : null}
        </span>
      ),
    },
    {
      id: "completed",
      term: t("personal.detail.completed"),
      description:
        request.completedAt === null ? "-" : formatDateTime(request.completedAt, uiLocale),
    },
    {
      id: "handledBy",
      term: t("personal.detail.handledBy"),
      description:
        request.handledBy === null
          ? t("personal.detail.handledByNobody")
          : t("personal.detail.handledByAdmin", { id: request.handledBy.slice(0, 8) }),
    },
    {
      id: "note",
      term: t("personal.detail.note"),
      description:
        request.note === null ? (
          t("personal.detail.noNote")
        ) : (
          <span className="break-words">{request.note}</span>
        ),
    },
  ];
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="privacy-facts" className="flex max-w-3xl flex-col gap-3">
        <h2 id="privacy-facts" className="text-lg font-semibold text-foreground">
          {t("personal.detail.factsTitle")}
        </h2>
        <DescriptionList items={items} />
      </section>
      {rows.length === 0 ? null : (
        <section aria-labelledby="privacy-result" className="flex max-w-3xl flex-col gap-3">
          <h2 id="privacy-result" className="text-lg font-semibold text-foreground">
            {t("personal.detail.resultTitle")}
          </h2>
          <p className="text-muted-foreground">{t("personal.detail.resultNote")}</p>
          <DescriptionList
            items={rows.map((row) => ({
              id: row.id,
              term: t(row.labelKey),
              description:
                typeof row.value === "boolean"
                  ? t(row.value ? "personal.lookup.yes" : "personal.lookup.no")
                  : Array.isArray(row.value)
                    ? row.value.join(", ")
                    : String(row.value),
            }))}
          />
        </section>
      )}
    </div>
  );
}

/** What the last action did, in words. Only what the API confirmed is claimed. */
export function RequestNoticeView({ t, notice }: { t: Translator; notice: RequestNotice | null }) {
  if (notice === null) return null;
  switch (notice.kind) {
    case "exported":
      return (
        <Alert variant="success">
          <p>
            {t("personal.notice.exported", {
              file: notice.file,
              orders: notice.orders,
              mail: notice.mail,
              sessions: notice.sessions,
            })}
          </p>
          <p className="mt-1">{t("personal.notice.exportedCare")}</p>
        </Alert>
      );
    case "erased":
      return (
        <Alert variant="success">
          <p>{t("personal.notice.erased")}</p>
          {notice.orders === null || notice.mail === null ? null : (
            <p className="mt-1">
              {t("personal.notice.erasedCounts", { orders: notice.orders, mail: notice.mail })}
            </p>
          )}
          {notice.accountDeleted === null ? null : (
            <p className="mt-1">
              {t(
                notice.accountDeleted
                  ? "personal.notice.erasedAccount"
                  : "personal.notice.erasedNoAccount",
              )}
            </p>
          )}
          <p className="mt-1">{t("personal.notice.erasedLimits")}</p>
        </Alert>
      );
    case "erase_unconfirmed":
      return <Alert variant="warning">{t("personal.notice.eraseUnconfirmed")}</Alert>;
    case "rejected":
      return <Alert variant="success">{t("personal.notice.rejected")}</Alert>;
    case "lost":
      return <Alert variant="warning">{t(`personal.notice.lost.${notice.action}`)}</Alert>;
  }
}

/** The preview of an erasure: counts and blockers in words. Nothing has changed yet. */
export function ErasurePreviewView({
  t,
  preview,
}: {
  t: Translator;
  preview: AdminErasurePreview;
}) {
  return (
    <section aria-labelledby="privacy-preview" className="flex max-w-3xl flex-col gap-3">
      <h2 id="privacy-preview" className="text-lg font-semibold text-foreground">
        {t("personal.preview.title")}
      </h2>
      <p className="text-muted-foreground">{t("personal.preview.nothingChanged")}</p>
      <DescriptionList
        items={[
          {
            id: "account",
            term: t("personal.preview.account"),
            description: t(
              preview.accountFound ? "personal.preview.accountYes" : "personal.preview.accountNo",
            ),
          },
          { id: "orders", term: t("personal.preview.orders"), description: String(preview.orders) },
          {
            id: "toAnonymise",
            term: t("personal.preview.ordersToAnonymise"),
            description: String(preview.ordersToAnonymise),
          },
          { id: "mail", term: t("personal.preview.mail"), description: String(preview.mail) },
        ]}
      />
      {preview.blockers.length === 0 ? (
        <Alert variant="success">{t("personal.preview.noBlockers")}</Alert>
      ) : (
        <Alert variant="warning" title={t("personal.preview.blockedTitle")}>
          <p>{t("personal.preview.blockedBody")}</p>
          <ul className="mt-2 list-disc ps-5">
            {preview.blockers.map((blocker, index) => (
              <li key={`${blocker.orderNumber ?? "mail"}-${blocker.reason}-${index}`}>
                {blocker.orderNumber === null
                  ? t(blockerReasonKey(blocker.reason))
                  : t("personal.preview.blockerOrder", {
                      number: blocker.orderNumber,
                      reason: t(blockerReasonKey(blocker.reason)),
                    })}
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </section>
  );
}

/** The blockers of a refused erase, inside the dialog: each reason once, in words. */
export function ReasonList({ t, reasons }: { t: Translator; reasons: readonly string[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="mt-2 list-disc ps-5">
      {reasons.map((reason) => (
        <li key={reason}>{t(blockerReasonKey(reason))}</li>
      ))}
    </ul>
  );
}

export interface EraseDialogProps {
  t: Translator;
  open: boolean;
  busy: boolean;
  typed: string;
  onTypedChange: (value: string) => void;
  typedError: MessageDescriptor | null;
  error: MessageDescriptor | null;
  reasons: readonly string[];
  errorRef?: Ref<HTMLDivElement>;
  typedRef?: Ref<HTMLInputElement>;
  onSubmit: () => void;
  onClose: () => void;
}

/**
 * The confirmation of an erasure (irreversible). It names what will happen, what is kept and what cannot be reached, and
 * asks for the shown word to be typed; Enter in the field submits, Escape closes, the focus starts on "keep".
 */
export function EraseDialog({
  t,
  open,
  busy,
  typed,
  onTypedChange,
  typedError,
  error,
  reasons,
  errorRef,
  typedRef,
  onSubmit,
  onClose,
}: EraseDialogProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      role="alertdialog"
      title={t("personal.erase.title")}
      footer={
        <>
          <Button variant="secondary" data-autofocus="" disabled={busy} onClick={onClose}>
            {t("personal.erase.keep")}
          </Button>
          <Button
            type="submit"
            form="privacy-erase"
            variant="danger"
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? t("personal.dialog.sending") : t("personal.erase.submit")}
          </Button>
        </>
      }
    >
      <form
        id="privacy-erase"
        method="post"
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4"
      >
        <ErrorBox t={t} descriptor={error} innerRef={errorRef}>
          <ReasonList t={t} reasons={reasons} />
        </ErrorBox>
        <Alert variant="danger" title={t("personal.erase.irreversible")}>
          <p>{t("personal.erase.deletes")}</p>
          <p className="mt-1">{t("personal.erase.keeps")}</p>
          <p className="mt-1">{t("personal.erase.limits")}</p>
        </Alert>
        <Field
          id="privacy-erase-word"
          label={t("personal.erase.typeLabel", { word: t("personal.erase.word") })}
          hint={t("personal.erase.typeHint")}
          error={typedError === null ? undefined : <DescriptorText t={t} descriptor={typedError} />}
          required
          requiredIndicator={t("personal.requiredMark")}
        >
          {(control) => (
            <Input
              {...control}
              ref={typedRef}
              name="confirmation"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => onTypedChange(event.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

export interface RejectDialogProps {
  t: Translator;
  open: boolean;
  busy: boolean;
  reason: RejectReason;
  note: string;
  onChange: (values: { reason: RejectReason; note: string }) => void;
  error: MessageDescriptor | null;
  errorRef?: Ref<HTMLDivElement>;
  onSubmit: () => void;
  onClose: () => void;
}

/** Closes an open request without acting on it: a reason code and an optional note (no personal data). */
export function RejectDialog({
  t,
  open,
  busy,
  reason,
  note,
  onChange,
  error,
  errorRef,
  onSubmit,
  onClose,
}: RejectDialogProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      role="alertdialog"
      title={t("personal.reject.title")}
      footer={
        <>
          <Button variant="secondary" data-autofocus="" disabled={busy} onClick={onClose}>
            {t("personal.reject.keep")}
          </Button>
          <Button
            type="submit"
            form="privacy-reject"
            variant="danger"
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? t("personal.dialog.sending") : t("personal.reject.submit")}
          </Button>
        </>
      }
    >
      <form
        id="privacy-reject"
        method="post"
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4"
      >
        <ErrorBox t={t} descriptor={error} innerRef={errorRef} />
        <p className="text-muted-foreground">{t("personal.reject.body")}</p>
        <Field id="privacy-reject-reason" label={t("personal.reject.reason")}>
          {(control) => (
            <Select
              {...control}
              name="reasonCode"
              value={reason}
              disabled={busy}
              onChange={(event) =>
                onChange({
                  reason: (REJECT_REASONS as readonly string[]).includes(event.target.value)
                    ? (event.target.value as RejectReason)
                    : "not_applicable",
                  note,
                })
              }
            >
              {REJECT_REASONS.map((code) => (
                <option key={code} value={code}>
                  {t(`personal.reject.option.${code}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          id="privacy-reject-note"
          label={t("personal.reject.note")}
          hint={t("personal.create.noteHint", { max: NOTE_MAX_LENGTH })}
        >
          {(control) => (
            <Textarea
              {...control}
              name="note"
              rows={3}
              value={note}
              maxLength={NOTE_MAX_LENGTH}
              disabled={busy}
              onChange={(event) => onChange({ reason, note: event.target.value })}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

/** The address of an email subject, typed again: only a hash of it is stored, so the routes need it in the body. */
export function SubjectEmailField({
  t,
  value,
  onChange,
  error,
  inputRef,
  disabled,
}: {
  t: Translator;
  value: string;
  onChange: (value: string) => void;
  error: MessageDescriptor | null;
  inputRef?: Ref<HTMLInputElement>;
  disabled: boolean;
}) {
  return (
    <div className="max-w-xl">
      <Field
        id="privacy-subject-email"
        label={t("personal.detail.emailAgain")}
        hint={t("personal.detail.emailAgainHint")}
        error={error === null ? undefined : <DescriptorText t={t} descriptor={error} />}
        required
        requiredIndicator={t("personal.requiredMark")}
      >
        {(control) => (
          <Input
            {...control}
            ref={inputRef}
            name="email"
            type="email"
            value={value}
            maxLength={254}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </Field>
    </div>
  );
}

/** The buttons of the request, only the ones the request allows (`offeredRequestActions`). */
export function RequestButtons({
  t,
  actions,
  busy,
  canErase,
  onExport,
  onPreview,
  onErase,
  onReject,
}: {
  t: Translator;
  actions: readonly RequestAction[];
  busy: boolean;
  /** An erasure preview without blockers is on screen. */
  canErase: boolean;
  onExport: () => void;
  onPreview: () => void;
  onErase: () => void;
  onReject: () => void;
}): ReactNode {
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {actions.includes("export") ? (
        <Button variant="secondary" disabled={busy} onClick={onExport}>
          {t("personal.action.export")}
        </Button>
      ) : null}
      {actions.includes("erase") ? (
        <>
          <Button variant="secondary" disabled={busy} onClick={onPreview}>
            {t("personal.action.preview")}
          </Button>
          <Button variant="danger" disabled={busy || !canErase} onClick={onErase}>
            {t("personal.action.erase")}
          </Button>
        </>
      ) : null}
      {actions.includes("reject") ? (
        <Button variant="secondary" disabled={busy} onClick={onReject}>
          {t("personal.action.reject")}
        </Button>
      ) : null}
    </div>
  );
}
