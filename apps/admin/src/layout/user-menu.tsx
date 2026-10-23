import { Button, type Translator } from "@fluxkit/ui";
import { useState } from "react";
import { Link } from "react-router";
import { useI18n } from "../i18n/i18n-context";
import { describeFailure, type MessageDescriptor } from "../lib/problem-messages";
import { PATHS } from "../router/paths";
import { useConfirmLeave } from "../router/unsaved-changes-dialog";
import { useSession } from "../session/session-context";

export interface UserMenuViewProps {
  t: Translator;
  email: string;
  signingOut: boolean;
  failure: MessageDescriptor | null;
  onSignOut: () => void;
}

/** The signed-in admin's corner of the header: who is signed in, the own account page, sign-out. */
export function UserMenuView({ t, email, signingOut, failure, onSignOut }: UserMenuViewProps) {
  return (
    <section aria-label={t("shell.userLabel")} className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-muted-foreground">{t("shell.signedInAs", { email })}</p>
      <Link
        to={PATHS.account}
        className="text-sm font-medium text-foreground underline underline-offset-4"
      >
        {t("shell.account")}
      </Link>
      <Button
        variant="secondary"
        className="min-h-11 px-3 py-1 text-sm"
        disabled={signingOut}
        aria-busy={signingOut || undefined}
        onClick={onSignOut}
      >
        {signingOut ? t("shell.signingOut") : t("shell.signOut")}
      </Button>
      {failure === null ? null : (
        <p role="alert" className="text-sm text-danger">
          {t(failure.key, failure.values)}
        </p>
      )}
    </section>
  );
}

export function UserMenu() {
  const { t } = useI18n();
  const session = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [failure, setFailure] = useState<MessageDescriptor | null>(null);
  // Sign-out discards the page: unsaved input asks "Leave this page?" first, as a navigation would.
  const leave = useConfirmLeave();

  async function signOut() {
    setSigningOut(true);
    setFailure(null);
    const result = await session.signOut();
    setSigningOut(false);
    if (result !== null) setFailure(describeFailure(result));
  }

  return (
    <>
      <UserMenuView
        t={t}
        email={session.state.me?.user.email ?? ""}
        signingOut={signingOut}
        failure={failure}
        onSignOut={() => leave.confirm(() => void signOut())}
      />
      {leave.dialog}
    </>
  );
}
