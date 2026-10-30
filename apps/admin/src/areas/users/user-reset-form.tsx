import { Alert, Button, type Translator } from "@fluxkit/ui";
import { useEffect, useRef, useState, type FormEvent, type Ref } from "react";
import type { MessageDescriptor } from "../../lib/problem-messages";
import type { WriteOutcome } from "../../lib/run-write";
import { useFocusAfterCommit } from "../../lib/use-focus-after-commit";
import { generatePassword } from "./password-generator";
import { ResetPasswordDialog } from "./user-dialogs";
import { resetErrorsFromProblem, resetFormErrors } from "./user-form";
import { DescriptorText, NewPasswordField, focusClass } from "./user-parts";

/** The form's markup (props in, markup out). */
export function ResetPasswordFormView({
  t,
  email,
  self,
  value,
  visible,
  generated,
  error,
  summary,
  busy,
  onChange,
  onToggleVisible,
  onGenerate,
  onSubmit,
  summaryRef,
}: {
  t: Translator;
  email: string;
  self: boolean;
  value: string;
  visible: boolean;
  generated: boolean;
  error?: MessageDescriptor;
  summary: MessageDescriptor[];
  busy: boolean;
  onChange: (value: string) => void;
  onToggleVisible: () => void;
  onGenerate: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  summaryRef?: Ref<HTMLDivElement>;
}) {
  return (
    <form method="post" onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
      <p className="max-w-prose text-sm text-muted-foreground">
        {t(self ? "user.reset.hintSelf" : "user.reset.hint")}
      </p>
      {summary.length === 0 ? null : (
        <div ref={summaryRef} tabIndex={-1} className={focusClass}>
          <Alert variant="danger">
            <ul className="flex flex-col gap-1">
              {summary.map((descriptor, index) => (
                <li key={`${descriptor.key}-${String(index)}`}>
                  <DescriptorText t={t} descriptor={descriptor} />
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}
      <NewPasswordField
        t={t}
        id="user-new-password"
        name="newPassword"
        label={t("user.reset.newPassword")}
        value={value}
        email={email}
        visible={visible}
        generated={generated}
        {...(error === undefined ? {} : { error })}
        disabled={busy}
        onChange={onChange}
        onToggleVisible={onToggleVisible}
        onGenerate={onGenerate}
      />
      <div>
        <Button type="submit" variant="danger" disabled={busy} aria-busy={busy || undefined}>
          {t("user.reset.submit")}
        </Button>
      </div>
    </form>
  );
}

/**
 * The password reset of one user (`POST /admin/users/{id}/reset-password`). This component alone holds the typed new
 * password: it is never lifted to the page, the URL, storage or a log, and it is cleared after every answer. The page
 * sends (`send`: single flight, `runWrite`, never retried) and reloads the user; this form only learns the outcome.
 */
export function ResetPasswordSection({
  t,
  email,
  self,
  busy,
  send,
  onDirtyChange,
}: {
  t: Translator;
  /** The target user's email: the new password must not equal it. */
  email: string;
  self: boolean;
  busy: boolean;
  /** Sends the reset once; `null` when another write of the page is running (nothing was sent). */
  send: (newPassword: string) => Promise<WriteOutcome<undefined> | null>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState<MessageDescriptor | undefined>(undefined);
  const [summary, setSummary] = useState<MessageDescriptor[]>([]);
  const [confirming, setConfirming] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const focusAfterCommit = useFocusAfterCommit();

  const dirty = value !== "";
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  function clear() {
    setValue("");
    setVisible(false);
    setGenerated(false);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const local = resetFormErrors(value, email);
    setSummary([]);
    if (local.newPassword !== undefined) {
      setError(local.newPassword);
      focusAfterCommit("user-new-password");
      return;
    }
    setError(undefined);
    setConfirming(true);
  }

  async function confirm() {
    const outcome = await send(value);
    if (outcome === null || outcome.kind === "aborted") return;
    setConfirming(false);
    // Whatever the answer, the typed password leaves the form.
    clear();
    if (outcome.kind === "problem") {
      const mapped = resetErrorsFromProblem(outcome.status, outcome.problem);
      setError(mapped.fields.newPassword);
      setSummary(mapped.other);
      if (mapped.other.length > 0) focusAfterCommit(summaryRef);
    } else {
      setError(undefined);
      setSummary([]);
    }
  }

  return (
    <>
      <ResetPasswordFormView
        t={t}
        email={email}
        self={self}
        value={value}
        visible={visible}
        generated={generated}
        {...(error === undefined ? {} : { error })}
        summary={summary}
        busy={busy}
        onChange={(next) => {
          setValue(next);
          setGenerated(false);
        }}
        onToggleVisible={() => setVisible((current) => !current)}
        onGenerate={() => {
          setValue(generatePassword());
          setVisible(true);
          setGenerated(true);
        }}
        onSubmit={onSubmit}
        summaryRef={summaryRef}
      />
      <ResetPasswordDialog
        t={t}
        open={confirming}
        busy={busy}
        email={email}
        self={self}
        selfTicked={false}
        refusal={null}
        onSelfTick={() => undefined}
        onConfirm={() => void confirm()}
        onClose={() => {
          if (!busy) setConfirming(false);
        }}
      />
    </>
  );
}
