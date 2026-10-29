import type { AdminPrivacyLookup, PrivacyRequestKind } from "@fluxkit/api-client";
import {
  Alert,
  Button,
  DataTable,
  DescriptionList,
  Field,
  Input,
  Select,
  StatusBadge,
  Textarea,
  type DataTableColumn,
  type DescriptionListItem,
  type Translator,
} from "@fluxkit/ui";
import type { FormEvent, Ref } from "react";
import { Link } from "react-router";
import { formatDateTime } from "../../lib/format";
import { buildPath, PATHS } from "../../router/paths";
import { DescriptorText, ErrorBox, linkClass } from "./privacy-frame";
import type { MessageDescriptor } from "../../lib/problem-messages";
import {
  NOTE_MAX_LENGTH,
  ORDER_STATUS_TONES,
  kindLabelKey,
  orderStatusKey,
  type CreateRequestForm,
  type CreateRequestIssue,
} from "./privacy-view";
import { requestHref } from "./requests-view";

export const EMAIL_MAX_LENGTH = 254;

/** The lookup form: the address goes in the POST body (`method="post"`), never in a URL. */
export function LookupForm({
  t,
  email,
  onEmailChange,
  onSubmit,
  busy,
  error,
  fieldError,
  errorRef,
  inputRef,
}: {
  t: Translator;
  email: string;
  onEmailChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  error: MessageDescriptor | null;
  fieldError: MessageDescriptor | null;
  errorRef?: Ref<HTMLDivElement>;
  inputRef?: Ref<HTMLInputElement>;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }
  return (
    <form
      method="post"
      onSubmit={submit}
      noValidate
      aria-busy={busy || undefined}
      className="flex max-w-xl flex-col gap-4"
    >
      <ErrorBox t={t} descriptor={error} innerRef={errorRef} />
      <Field
        id="privacy-lookup-email"
        label={t("personal.lookup.email")}
        hint={t("personal.lookup.emailHint")}
        error={fieldError === null ? undefined : <DescriptorText t={t} descriptor={fieldError} />}
        required
        requiredIndicator={t("personal.requiredMark")}
      >
        {(control) => (
          <Input
            {...control}
            ref={inputRef}
            name="email"
            type="email"
            value={email}
            maxLength={EMAIL_MAX_LENGTH}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            onChange={(event) => onEmailChange(event.target.value)}
          />
        )}
      </Field>
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? t("personal.lookup.searching") : t("personal.lookup.submit")}
        </Button>
      </div>
    </form>
  );
}

/** What the shop holds for the address: the account, the guest orders, the mail count and the open requests. */
export function LookupResultView({
  t,
  uiLocale,
  result,
}: {
  t: Translator;
  uiLocale: string;
  result: AdminPrivacyLookup;
}) {
  const account = result.customer;
  const accountItems: DescriptionListItem[] =
    account === null
      ? []
      : [
          {
            id: "name",
            term: t("personal.lookup.accountName"),
            description: (
              <Link to={buildPath(PATHS.customerDetail, { id: account.id })} className={linkClass}>
                {t("personal.lookup.fullName", {
                  first: account.firstName,
                  last: account.lastName,
                })}
              </Link>
            ),
          },
          {
            id: "email",
            term: t("personal.lookup.accountEmail"),
            description: <span className="break-all">{account.email}</span>,
          },
          {
            id: "active",
            term: t("personal.lookup.accountActive"),
            description: t(account.isActive ? "personal.lookup.yes" : "personal.lookup.no"),
          },
          {
            id: "created",
            term: t("personal.lookup.accountCreated"),
            description: formatDateTime(account.createdAt, uiLocale),
          },
          {
            id: "orders",
            term: t("personal.lookup.accountOrders"),
            description: new Intl.NumberFormat(uiLocale).format(account.orderCount),
          },
        ];
  const orderColumns: DataTableColumn<AdminPrivacyLookup["guestOrders"][number]>[] = [
    {
      id: "number",
      header: t("personal.lookup.orderNumber"),
      cell: (row) => (
        <Link to={buildPath(PATHS.orderDetail, { id: row.id })} className={linkClass}>
          {row.number}
        </Link>
      ),
    },
    {
      id: "status",
      header: t("personal.lookup.orderStatus"),
      cell: (row) => (
        <StatusBadge tone={ORDER_STATUS_TONES[row.status]} label={t(orderStatusKey(row.status))} />
      ),
    },
    {
      id: "placed",
      header: t("personal.lookup.orderPlaced"),
      cell: (row) => formatDateTime(row.placedAt, uiLocale),
    },
    {
      id: "erased",
      header: t("personal.lookup.orderContact"),
      cell: (row) =>
        t(row.contactErased ? "personal.lookup.contactErased" : "personal.lookup.contactKept"),
    },
  ];
  const nothing = account === null && result.guestOrders.length === 0 && result.mailCount === 0;
  return (
    <div className="flex flex-col gap-6">
      {nothing ? <Alert variant="info">{t("personal.lookup.nothing")}</Alert> : null}
      <section aria-labelledby="privacy-lookup-account" className="flex max-w-3xl flex-col gap-3">
        <h2 id="privacy-lookup-account" className="text-lg font-semibold text-foreground">
          {t("personal.lookup.accountTitle")}
        </h2>
        {account === null ? (
          <p className="text-muted-foreground">{t("personal.lookup.noAccount")}</p>
        ) : (
          <DescriptionList items={accountItems} />
        )}
      </section>
      <section aria-labelledby="privacy-lookup-orders" className="flex flex-col gap-3">
        <h2 id="privacy-lookup-orders" className="text-lg font-semibold text-foreground">
          {t("personal.lookup.guestOrdersTitle")}
        </h2>
        <p className="max-w-prose text-muted-foreground">{t("personal.lookup.guestOrdersNote")}</p>
        <DataTable
          caption={t("personal.lookup.guestOrdersCaption")}
          captionHidden
          columns={orderColumns}
          rows={result.guestOrders}
          rowKey={(row) => row.id}
          emptyMessage={t("personal.lookup.noGuestOrders")}
        />
      </section>
      <section aria-labelledby="privacy-lookup-mail" className="flex max-w-3xl flex-col gap-2">
        <h2 id="privacy-lookup-mail" className="text-lg font-semibold text-foreground">
          {t("personal.lookup.mailTitle")}
        </h2>
        <p>{t.plural("personal.lookup.mailCount", result.mailCount)}</p>
      </section>
      <section aria-labelledby="privacy-lookup-open" className="flex max-w-3xl flex-col gap-2">
        <h2 id="privacy-lookup-open" className="text-lg font-semibold text-foreground">
          {t("personal.lookup.openTitle")}
        </h2>
        {result.openRequests.length === 0 ? (
          <p className="text-muted-foreground">{t("personal.lookup.noOpen")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {result.openRequests.map((request) => (
              <li key={request.id}>
                <Link to={requestHref(request.id)} className={linkClass}>
                  {t("personal.lookup.openItem", {
                    kind: t(kindLabelKey(request.kind)),
                    date: formatDateTime(request.receivedAt, uiLocale),
                  })}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function issueKey(issue: CreateRequestIssue): string {
  return `personal.create.issue.${issue}`;
}

/** Records a request for what the lookup found. The note is how the identity was checked: never personal data. */
export function CreateRequestFormView({
  t,
  hasAccount,
  values,
  onChange,
  onSubmit,
  busy,
  issue,
  error,
  errorRef,
}: {
  t: Translator;
  hasAccount: boolean;
  values: CreateRequestForm;
  onChange: (values: CreateRequestForm) => void;
  onSubmit: () => void;
  busy: boolean;
  issue: CreateRequestIssue | null;
  error: MessageDescriptor | null;
  errorRef?: Ref<HTMLDivElement>;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }
  const kinds: PrivacyRequestKind[] = ["export", "erasure"];
  return (
    <form
      method="post"
      onSubmit={submit}
      noValidate
      aria-busy={busy || undefined}
      aria-labelledby="privacy-create-title"
      className="flex max-w-xl flex-col gap-4"
    >
      <h2 id="privacy-create-title" className="text-lg font-semibold text-foreground">
        {t("personal.create.title")}
      </h2>
      <p className="text-muted-foreground">{t("personal.create.intro")}</p>
      <ErrorBox t={t} descriptor={error} innerRef={errorRef} />
      <Field id="privacy-create-kind" label={t("personal.create.kind")}>
        {(control) => (
          <Select
            {...control}
            name="kind"
            value={values.kind}
            disabled={busy}
            onChange={(event) =>
              onChange({ ...values, kind: event.target.value === "erasure" ? "erasure" : "export" })
            }
          >
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {t(kindLabelKey(kind))}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        id="privacy-create-subject"
        label={t("personal.create.subject")}
        hint={t("personal.create.subjectHint")}
        error={issue === "account_missing" ? t(issueKey(issue)) : undefined}
      >
        {(control) => (
          <Select
            {...control}
            name="subject"
            value={values.subject}
            disabled={busy}
            onChange={(event) =>
              onChange({
                ...values,
                subject: event.target.value === "account" ? "account" : "address",
              })
            }
          >
            <option value="address">{t("personal.create.subjectAddress")}</option>
            {hasAccount ? (
              <option value="account">{t("personal.create.subjectAccount")}</option>
            ) : null}
          </Select>
        )}
      </Field>
      <Field
        id="privacy-create-note"
        label={t("personal.create.note")}
        hint={t("personal.create.noteHint", { max: NOTE_MAX_LENGTH })}
        error={issue === "note_too_long" ? t(issueKey(issue), { max: NOTE_MAX_LENGTH }) : undefined}
      >
        {(control) => (
          <Textarea
            {...control}
            name="note"
            rows={3}
            value={values.note}
            maxLength={NOTE_MAX_LENGTH + 100}
            disabled={busy}
            onChange={(event) => onChange({ ...values, note: event.target.value })}
          />
        )}
      </Field>
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? t("personal.create.sending") : t("personal.create.submit")}
        </Button>
      </div>
    </form>
  );
}
