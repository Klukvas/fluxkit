"use client";

import { Button } from "@fluxkit/ui";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, type ReactNode, type Ref } from "react";
import { localizedHref } from "../lib/locale-path";
import { focusSignInDestination, signInCloseAction } from "../lib/sign-in-navigation";
import { useI18n } from "./i18n-provider";
import { useAccount } from "./session-provider";
import { useSignInNavigation } from "./sign-in-navigation";

/** Rebind a replaced form heading without taking focus from a field, close button or error summary. */
export function createSignInHeadingBinding(
  readHeading: () => Pick<HTMLHeadingElement, "id" | "tabIndex" | "focus"> | null,
  titleId: string,
  hasContentFocus: () => boolean,
) {
  let previousHeading: ReturnType<typeof readHeading> = null;
  return (initial = false) => {
    const heading = readHeading();
    if (heading === null || heading === previousHeading) return;
    heading.id = titleId;
    heading.tabIndex = -1;
    previousHeading = heading;
    if (initial || !hasContentFocus()) heading.focus({ preventScroll: true });
  };
}

/** Static shell: the contained form supplies the only heading. Never server-render an open dialog. */
export function SignInModalView({
  children,
  titleId,
  closeLabel,
  dialogRef,
  onDismiss,
  onNativeClose,
}: {
  children: ReactNode;
  titleId: string;
  closeLabel: string;
  dialogRef?: Ref<HTMLDialogElement>;
  onDismiss: () => void;
  onNativeClose: (dialog: HTMLDialogElement) => void;
}) {
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="fk-sign-in-modal m-auto max-w-md rounded-overlay border border-border bg-background p-6 text-foreground shadow-card backdrop:bg-scrim"
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onClose={(event) => onNativeClose(event.currentTarget)}
    >
      <div className="mb-4 flex justify-end">
        <Button type="button" variant="secondary" onClick={onDismiss}>
          {closeLabel}
        </Button>
      </div>
      {children}
    </dialog>
  );
}

export function SignInModal({ children }: { children: ReactNode }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const coordinator = useSignInNavigation()?.coordinator ?? null;
  const { store } = useAccount();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const closing = useRef(false);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    mounted.current = true;
    closing.current = false;
    coordinator?.setPostSignInHeading(false);
    let sessionStatus = store.getState().session.status;
    let signedIn = false;
    const stopSessionWatch = store.subscribe(() => {
      const nextStatus = store.getState().session.status;
      if (sessionStatus !== "signedIn" && nextStatus === "signedIn") signedIn = true;
      sessionStatus = nextStatus;
    });
    const bindHeading = createSignInHeadingBinding(
      () => dialog.querySelector("h1"),
      titleId,
      () => dialog.contains(document.activeElement),
    );
    // Label before showModal; then focus the heading instead of opening a phone keyboard.
    const heading = dialog.querySelector("h1");
    if (heading) {
      heading.id = titleId;
      heading.tabIndex = -1;
    }
    if (!dialog.open) dialog.showModal();
    bindHeading(true);
    const observer = new MutationObserver(() => bindHeading());
    observer.observe(dialog, { childList: true, subtree: true });
    document.documentElement.classList.add("fk-sign-in-open");
    return () => {
      mounted.current = false;
      stopSessionWatch();
      observer.disconnect();
      document.documentElement.classList.remove("fk-sign-in-open");
      if (dialog.open) dialog.close();
      // Strict-mode effect replay closes and reopens a connected dialog, without a real unmount.
      if (dialog.isConnected) return;
      // A successful form navigation belongs to RouteFocus; all other exits belong to this dialog.
      const focusAfterSignIn = signedIn && !closing.current;
      coordinator?.setPostSignInHeading(focusAfterSignIn);
      if (focusAfterSignIn && coordinator) return;
      requestAnimationFrame(() => {
        // Give a separately committed destination page one more frame before reading its URL and DOM.
        requestAnimationFrame(() => {
          focusSignInDestination(
            window.location.pathname + window.location.search,
            coordinator,
            document,
          );
        });
      });
    };
  }, [titleId, coordinator, store]);
  const dismiss = () => {
    if (!mounted.current || closing.current) return;
    closing.current = true;
    const browser = window as typeof window & { navigation?: { canGoBack: boolean } };
    const action = signInCloseAction(browser.navigation?.canGoBack);
    if (action === "back") router.back();
    else router.replace(localizedHref(locale, "/"));
  };
  return (
    <SignInModalView
      titleId={titleId}
      closeLabel={t("account.modal.close")}
      dialogRef={dialogRef}
      onDismiss={dismiss}
      onNativeClose={(dialog) => {
        if (!dialog.open) dismiss();
      }}
    >
      {children}
    </SignInModalView>
  );
}
