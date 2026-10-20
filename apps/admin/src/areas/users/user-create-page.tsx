import type { AdminUser } from "@fluxkit/api-client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { runWrite } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { useCrash } from "../../lib/use-crash";
import { UnsavedChangesDialog } from "../../router/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "../../router/unsaved-changes";
import { generatePassword } from "./password-generator";
import {
  CreateUnknownView,
  CreateUserFormView,
  CreateUserScreen,
  CreatedPanel,
} from "./user-create-view";
import {
  EMPTY_CREATE_VALUES,
  createBody,
  createErrorsFromProblem,
  createFormErrors,
  isCreateDirty,
  type CreateField,
  type CreateUserValues,
} from "./user-form";
import { LOOKUP_PAGE_SIZE, findUserByEmail, type LookupResult } from "./user-lookup";

const FIELD_ORDER: readonly CreateField[] = ["email", "role", "password"];
const FIELD_IDS: Record<CreateField, string> = {
  email: "user-email",
  role: "user-role-viewer",
  password: "user-password",
};

/**
 * `/users/new`: create an admin user (owner only). The typed values, the password included, live only in this form's
 * state: never in the URL, storage or a log. The create is sent once (single flight, `runWrite`, never retried); after
 * every answer the password is cleared and hidden. Success shows a focused panel without the password; a lost answer
 * reads the list to say whether a user with that email is stored now, and never claims the request landed.
 */
export function UserCreatePage() {
  const { t } = useI18n();
  const [values, setValues] = useState<CreateUserValues>(EMPTY_CREATE_VALUES);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [passwordGenerated, setPasswordGenerated] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<CreateField, MessageDescriptor>>>(
    {},
  );
  const [summary, setSummary] = useState<MessageDescriptor[]>([]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<AdminUser | null>(null);
  const [unknown, setUnknown] = useState<{ lookup: LookupResult | null } | null>(null);
  const [flight] = useState(createSingleFlight);
  const summaryRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const unknownRef = useRef<HTMLDivElement>(null);
  const crash = useCrash();
  const blocker = useUnsavedChangesGuard(created === null && isCreateDirty(values) && !busy);

  useEffect(() => {
    if (created !== null) panelRef.current?.focus();
  }, [created]);
  useEffect(() => {
    if (unknown !== null) unknownRef.current?.focus();
  }, [unknown]);

  function clearPassword() {
    setValues((current) => ({ ...current, password: "" }));
    setPasswordVisible(false);
    setPasswordGenerated(false);
  }

  function showErrors(
    fields: Partial<Record<CreateField, MessageDescriptor>>,
    other: MessageDescriptor[],
  ) {
    setFieldErrors(fields);
    setSummary(other);
    requestAnimationFrame(() => {
      if (other.length > 0) summaryRef.current?.focus();
      else {
        const first = FIELD_ORDER.find((field) => fields[field] !== undefined);
        if (first !== undefined) document.getElementById(FIELD_IDS[first])?.focus();
      }
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await send();
    } catch (bug) {
      // A bug (not a failed request: `runWrite` and the lookup turn those into outcomes) goes to the error boundary.
      crash(bug);
    }
  }

  async function send() {
    const local = createFormErrors(values);
    if (Object.keys(local).length > 0) {
      showErrors(local, []);
      return;
    }
    const body = createBody(values);
    const running = flight.run(() => runWrite(() => adminClient.createUser(body)));
    if (running === null) return;
    setBusy(true);
    setUnknown(null);
    const outcome = await running.finally(() => setBusy(false));
    if (outcome.kind === "aborted") return;
    // Whatever the answer, the password leaves the form: it is typed again (or generated) for another attempt.
    clearPassword();
    if (outcome.kind === "ok") {
      setFieldErrors({});
      setSummary([]);
      setValues(EMPTY_CREATE_VALUES);
      setCreated(outcome.data);
    } else if (outcome.kind === "problem") {
      const mapped = createErrorsFromProblem(outcome.status, outcome.problem);
      showErrors(mapped.fields, mapped.other);
    } else {
      setFieldErrors({});
      setSummary([]);
      setUnknown({ lookup: null });
      const lookup = await findUserByEmail(body.email, (offset) =>
        adminClient.listUsers({ limit: LOOKUP_PAGE_SIZE, offset }),
      );
      setUnknown({ lookup });
    }
  }

  if (created !== null) {
    return (
      <CreateUserScreen t={t}>
        <CreatedPanel
          t={t}
          user={created}
          panelRef={panelRef}
          onCreateAnother={() => setCreated(null)}
        />
      </CreateUserScreen>
    );
  }

  return (
    <CreateUserScreen t={t}>
      <div ref={unknownRef} tabIndex={-1}>
        {unknown === null ? null : <CreateUnknownView t={t} lookup={unknown.lookup} />}
      </div>
      <CreateUserFormView
        t={t}
        values={values}
        fieldErrors={fieldErrors}
        summary={summary}
        busy={busy}
        passwordVisible={passwordVisible}
        passwordGenerated={passwordGenerated}
        onEmailChange={(email) => setValues((current) => ({ ...current, email }))}
        onRoleChange={(role) => setValues((current) => ({ ...current, role }))}
        onPasswordChange={(password) => {
          setValues((current) => ({ ...current, password }));
          setPasswordGenerated(false);
        }}
        onTogglePassword={() => setPasswordVisible((visible) => !visible)}
        onGeneratePassword={() => {
          setValues((current) => ({ ...current, password: generatePassword() }));
          setPasswordVisible(true);
          setPasswordGenerated(true);
        }}
        onSubmit={(event) => void submit(event)}
        summaryRef={summaryRef}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </CreateUserScreen>
  );
}
