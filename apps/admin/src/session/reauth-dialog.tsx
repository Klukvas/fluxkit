import { Button, Dialog } from "@fluxkit/ui";
import { SignInForm } from "../areas/auth/sign-in-form";
import { useI18n } from "../i18n/i18n-context";
import { useSession } from "./session-context";

/**
 * Shown over the current page when any request answered 401 (owner answer 6). The page stays mounted underneath, so its
 * input survives; the failed request is NOT replayed (the admin repeats the action). Escape does not close it: without a
 * session there is nothing to go back to. Signing in as the same user continues; as another user, the session model
 * drops all state and goes to the start page.
 */
export function ReauthDialog() {
  const { t } = useI18n();
  const session = useSession();
  return (
    <Dialog
      open
      onClose={() => undefined}
      dismissible={false}
      title={t("auth.reauth.title")}
      description={t("auth.reauth.description")}
      footer={
        <Button variant="secondary" onClick={() => void session.signOut()}>
          {t("auth.reauth.signOut")}
        </Button>
      }
    >
      <SignInForm idPrefix="reauth" initialEmail={session.state.me?.user.email ?? ""} />
    </Dialog>
  );
}
