import { Alert, Button, Field, Input, type Translator } from "@fluxkit/ui";
import { useRef, useState, type FormEvent, type Ref } from "react";
import { describeFailure, type MessageDescriptor } from "../../lib/problem-messages";
import { createSingleFlight } from "../../lib/single-flight";
import { useI18n } from "../../i18n/i18n-context";
import { useSession, type SignInOutcome } from "../../session/session-context";
import { FailureMessage } from "../../views/status-views";

/** What the form shows after a failed attempt. */
export type SignInMessage =
  | { kind: "rejected" }
  | { kind: "throttled"; minutes: number | null }
  | { kind: "failure"; descriptor: MessageDescriptor };

export function signInMessage(outcome: SignInOutcome): SignInMessage | null {
  switch (outcome.status) {
    case "signedIn":
      return null;
    case "rejected":
      return { kind: "rejected" };
    case "throttled":
      return { kind: "throttled", minutes: outcome.minutes };
    case "failed":
      return { kind: "failure", descriptor: describeFailure(outcome.failure) };
  }
}

export interface SignInFormViewProps {
  t: Translator;
  idPrefix: string;
  email: string;
  password: string;
  busy: boolean;
  message: SignInMessage | null;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  passwordRef?: Ref<HTMLInputElement>;
}

function MessageView({ t, message }: { t: Translator; message: SignInMessage }) {
  if (message.kind === "failure") return <FailureMessage t={t} descriptor={message.descriptor} />;
  const text =
    message.kind === "rejected"
      ? t("auth.login.failed")
      : message.minutes === null
        ? t("auth.login.tooMany")
        : t.plural("auth.login.tooManyWait", message.minutes);
  return (
    <Alert variant="danger">
      <p>{text}</p>
    </Alert>
  );
}

/**
 * The sign-in form, used by the sign-in page and the re-sign-in dialog. `method="post"` and no `action` (the repo-wide
 * form guard): a submit before the script runs never puts the password into a URL.
 */
export function SignInFormView({
  t,
  idPrefix,
  email,
  password,
  busy,
  message,
  onEmail,
  onPassword,
  onSubmit,
  passwordRef,
}: SignInFormViewProps) {
  return (
    <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4">
      {message === null ? null : <MessageView t={t} message={message} />}
      <Field id={`${idPrefix}-email`} label={t("auth.login.email")} required>
        {(control) => (
          <Input
            {...control}
            type="email"
            name="email"
            autoComplete="username"
            maxLength={1024}
            value={email}
            onChange={(event) => onEmail(event.target.value)}
          />
        )}
      </Field>
      <Field id={`${idPrefix}-password`} label={t("auth.login.password")} required>
        {(control) => (
          <Input
            {...control}
            ref={passwordRef}
            type="password"
            name="password"
            autoComplete="current-password"
            maxLength={1024}
            value={password}
            onChange={(event) => onPassword(event.target.value)}
          />
        )}
      </Field>
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? t("auth.login.submitting") : t("auth.login.submit")}
        </Button>
      </div>
    </form>
  );
}

/** Stateful sign-in form. The password is cleared after every failed attempt (as in the storefront). */
export function SignInForm({
  idPrefix,
  initialEmail = "",
}: {
  idPrefix: string;
  initialEmail?: string;
}) {
  const { t } = useI18n();
  const { signIn } = useSession();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<SignInMessage | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  // Two submits in one task (before React renders the busy button) send one sign-in.
  const [flight] = useState(createSingleFlight);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void flight.run(attempt);
  }

  async function attempt() {
    setBusy(true);
    setMessage(null);
    const outcome = await signIn({ email, password });
    setBusy(false);
    const next = signInMessage(outcome);
    if (next !== null) {
      setPassword("");
      setMessage(next);
      passwordRef.current?.focus();
    }
  }

  return (
    <SignInFormView
      t={t}
      idPrefix={idPrefix}
      email={email}
      password={password}
      busy={busy}
      message={message}
      onEmail={setEmail}
      onPassword={setPassword}
      onSubmit={(event) => void submit(event)}
      passwordRef={passwordRef}
    />
  );
}
