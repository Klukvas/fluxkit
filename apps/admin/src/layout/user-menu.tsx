import { AdministratorsIcon, Button, ChevronIcon, cn, type Translator } from "@fluxkit/ui";
import { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useI18n } from "../i18n/i18n-context";
import { describeFailure, type MessageDescriptor } from "../lib/problem-messages";
import { useFocusAfterCommit } from "../lib/use-focus-after-commit";
import { PATHS } from "../router/paths";
import { useConfirmLeave } from "../router/unsaved-changes-dialog";
import { useSession } from "../session/session-context";

export interface UserMenuViewProps {
  t: Translator;
  email: string;
  signingOut: boolean;
  failure: MessageDescriptor | null;
  onSignOut: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  confirmationOpen?: boolean;
}

export function emailInitials(email: string): string {
  return (email.split("@")[0]?.match(/\p{L}/gu) ?? []).slice(0, 2).join("").toLocaleUpperCase();
}

const ignoreOpenChange = () => undefined;

function useDisclosureDismiss(
  open: boolean,
  confirmationOpen: boolean,
  onOpenChange: (open: boolean) => void,
) {
  const root = useRef<HTMLDivElement>(null);
  const location = useLocation();
  useEffect(() => {
    onOpenChange(false);
  }, [location.key, onOpenChange]);
  useLayoutEffect(() => {
    if (!open || confirmationOpen) return;
    const outside = (event: Event) => {
      // A modal owns focus until it restores its opener (including the router's leave confirmation).
      if (document.querySelector("dialog[open]")) return;
      if (event.target instanceof Node && !root.current?.contains(event.target))
        onOpenChange(false);
    };
    const hidden = () => {
      if (root.current?.getClientRects().length === 0) onOpenChange(false);
    };
    const observer = new ResizeObserver(hidden);
    if (root.current) observer.observe(root.current);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open, confirmationOpen, onOpenChange]);
  return root;
}

function AccountPopup({
  t,
  email,
  signingOut,
  onSignOut,
  open,
  popupId,
}: Pick<UserMenuViewProps, "t" | "email" | "signingOut" | "onSignOut"> & {
  open: boolean;
  popupId: string;
}) {
  return (
    <section
      id={popupId}
      hidden={!open}
      aria-label={t("shell.userLabel")}
      className={cn(
        "absolute end-0 z-10 mt-2 w-64 account-popup-width flex-col gap-3 rounded-overlay border border-border bg-background p-4 text-foreground shadow-overlay",
        open ? "flex" : "hidden",
      )}
    >
      <p className="text-sm break-words text-muted-foreground">
        {t("shell.signedInAs", { email })}
      </p>
      <Link
        to={PATHS.account}
        className="inline-flex min-h-11 items-center text-sm font-medium text-foreground underline underline-offset-4"
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
    </section>
  );
}

/** A disclosure of ordinary links and buttons; Tab follows the native document order. */
export function UserMenuView({
  t,
  email,
  signingOut,
  failure,
  onSignOut,
  open = false,
  onOpenChange = ignoreOpenChange,
  confirmationOpen = false,
}: UserMenuViewProps) {
  const popupId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const root = useDisclosureDismiss(open, confirmationOpen, onOpenChange);
  const focusAfterCommit = useFocusAfterCommit();
  const initials = emailInitials(email);
  return (
    <div
      ref={root}
      className="relative ms-auto min-w-0 max-w-full"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open || confirmationOpen) return;
        event.stopPropagation();
        onOpenChange(false);
        focusAfterCommit(button);
      }}
    >
      <Button
        ref={button}
        variant="secondary"
        className="min-h-11 gap-2 px-3 py-1 text-sm"
        aria-expanded={open}
        aria-controls={popupId}
        onClick={() => onOpenChange(!open)}
      >
        <span className="sr-only">{t("shell.userMenu")}</span>
        <span aria-hidden="true">{initials || <AdministratorsIcon />}</span>
        <ChevronIcon />
      </Button>
      <AccountPopup {...{ t, email, signingOut, onSignOut, open, popupId }} />
      {failure === null ? null : (
        <p role="alert" className="text-sm text-danger">
          {t(failure.key, failure.values)}
        </p>
      )}
    </div>
  );
}

export function UserMenu() {
  const { t } = useI18n();
  const session = useSession();
  const [open, setOpen] = useState(false);
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
        open={open}
        onOpenChange={setOpen}
        confirmationOpen={leave.dialog !== null}
        signingOut={signingOut}
        failure={failure}
        onSignOut={() => leave.confirm(() => void signOut())}
      />
      {leave.dialog}
    </>
  );
}
