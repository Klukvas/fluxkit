import type { AdminSessionUser } from "@fluxkit/api-client";
import {
  Alert,
  Button,
  DescriptionList,
  Field,
  Input,
  LiveRegion,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import { useRef, useState, type FormEvent, type Ref } from "react";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { failureFromError } from "../../lib/failure";
import { formatDateTime } from "../../lib/format";
import { fieldErrorsFromProblem } from "../../lib/form-errors";
import { describeFailure, type MessageDescriptor } from "../../lib/problem-messages";
import { UnsavedChangesDialog } from "../../router/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "../../router/unsaved-changes";
import { useSession } from "../../session/session-context";
import { PageHeading } from "../../views/status-views";
import {
  PASSWORD_LIMITS,
  isPasswordFormDirty,
  localPasswordErrors,
  type PasswordField,
  type PasswordFormValues,
} from "./password-form";

export function AccountDetailsView({
  t,
  locale,
  user,
}: {
  t: Translator;
  locale: Locale;
  user: AdminSessionUser;
}) {
  return (
    <section aria-labelledby="account-details" className="flex flex-col gap-3">
      <h2 id="account-details" className="text-lg font-semibold">
        {t("account.details")}
      </h2>
      <DescriptionList
        items={[
          { id: "email", term: t("account.email"), description: user.email },
          { id: "role", term: t("account.role"), description: t(`role.${user.role}`) },
          {
            id: "lastLogin",
            term: t("account.lastLogin"),
            description:
              user.lastLoginAt === null
                ? t("account.lastLoginNever")
                : formatDateTime(user.lastLoginAt, locale),
          },
        ]}
      />
    </section>
  );
}

export interface PasswordFormViewProps {
  t: Translator;
  values: PasswordFormValues;
  fieldErrors: Partial<Record<PasswordField, MessageDescriptor>>;
  summary: MessageDescriptor[];
  busy: boolean;
  done: boolean;
  onChange: (field: PasswordField, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  summaryRef?: Ref<HTMLDivElement>;
}

const FIELDS: { name: PasswordField; labelKey: string; autoComplete: string }[] = [
  {
    name: "currentPassword",
    labelKey: "account.password.current",
    autoComplete: "current-password",
  },
  { name: "newPassword", labelKey: "account.password.new", autoComplete: "new-password" },
  { name: "repeatPassword", labelKey: "account.password.repeat", autoComplete: "new-password" },
];

export function PasswordFormView({
  t,
  values,
  fieldErrors,
  summary,
  busy,
  done,
  onChange,
  onSubmit,
  summaryRef,
}: PasswordFormViewProps) {
  const describe = (descriptor: MessageDescriptor) => t(descriptor.key, descriptor.values);
  return (
    <section aria-labelledby="account-password" className="flex flex-col gap-3">
      <h2 id="account-password" className="text-lg font-semibold">
        {t("account.password.heading")}
      </h2>
      <LiveRegion>{done ? t("account.password.changed") : null}</LiveRegion>
      <form method="post" onSubmit={onSubmit} className="flex max-w-md flex-col gap-4">
        {summary.length === 0 ? null : (
          <div ref={summaryRef} tabIndex={-1}>
            <Alert variant="danger">
              <ul className="flex flex-col gap-1">
                {summary.map((descriptor, index) => (
                  <li key={`${descriptor.key}-${index}`}>
                    {describe(descriptor)}
                    {descriptor.code === undefined ? null : (
                      <small className="ms-2 text-muted-foreground">
                        {t("errors.reference", { code: descriptor.code })}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
            </Alert>
          </div>
        )}
        {FIELDS.map((field) => {
          const error = fieldErrors[field.name];
          return (
            <Field
              key={field.name}
              id={`account-${field.name}`}
              label={t(field.labelKey)}
              hint={
                field.name === "newPassword"
                  ? t("account.password.newHint", {
                      min: PASSWORD_LIMITS.minLength,
                      max: PASSWORD_LIMITS.maxLength,
                    })
                  : undefined
              }
              error={error === undefined ? undefined : describe(error)}
              required
            >
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  name={field.name}
                  autoComplete={field.autoComplete}
                  minLength={
                    field.name === "currentPassword" ? undefined : PASSWORD_LIMITS.minLength
                  }
                  maxLength={field.name === "currentPassword" ? 1024 : PASSWORD_LIMITS.maxLength}
                  value={values[field.name]}
                  onChange={(event) => onChange(field.name, event.target.value)}
                />
              )}
            </Field>
          );
        })}
        <div>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            {busy ? t("account.password.submitting") : t("account.password.submit")}
          </Button>
        </div>
      </form>
    </section>
  );
}

const EMPTY: PasswordFormValues = { currentPassword: "", newPassword: "", repeatPassword: "" };

/** `/account`: the own user (from `me`) and the own password change, which ends the other sessions (ADR 0009). */
export function AccountPage() {
  const { t, locale } = useI18n();
  const session = useSession();
  const [values, setValues] = useState<PasswordFormValues>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PasswordField, MessageDescriptor>>>(
    {},
  );
  const [summary, setSummary] = useState<MessageDescriptor[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [crash, setCrash] = useState<{ error: unknown } | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const blocker = useUnsavedChangesGuard(isPasswordFormDirty(values) && !busy);

  if (crash !== null) throw crash.error;
  const user = session.state.me?.user;

  function showErrors(
    fields: Partial<Record<PasswordField, MessageDescriptor>>,
    other: MessageDescriptor[],
  ) {
    setFieldErrors(fields);
    setSummary(other);
    requestAnimationFrame(() => {
      if (other.length > 0) summaryRef.current?.focus();
      else {
        const first = FIELDS.find((field) => fields[field.name] !== undefined);
        if (first !== undefined) document.getElementById(`account-${first.name}`)?.focus();
      }
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setDone(false);
    const local = localPasswordErrors(values);
    if (Object.keys(local).length > 0) {
      showErrors(local, []);
      return;
    }
    setBusy(true);
    try {
      const result = await adminClient.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      if (result.ok) {
        setValues(EMPTY);
        setFieldErrors({});
        setSummary([]);
        setDone(true);
      } else {
        const mapped = fieldErrorsFromProblem(
          result.problem,
          ["currentPassword", "newPassword"],
          result.status,
        );
        showErrors(mapped.fields, mapped.other);
      }
    } catch (error) {
      try {
        const failure = failureFromError(error);
        if (failure !== null) showErrors({}, [describeFailure(failure)]);
      } catch (bug) {
        setCrash({ error: bug });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeading>{t("page.account.title")}</PageHeading>
      {user === undefined ? null : <AccountDetailsView t={t} locale={locale} user={user} />}
      <PasswordFormView
        t={t}
        values={values}
        fieldErrors={fieldErrors}
        summary={summary}
        busy={busy}
        done={done}
        onChange={(field, value) => setValues((current) => ({ ...current, [field]: value }))}
        onSubmit={(event) => void submit(event)}
        summaryRef={summaryRef}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}
