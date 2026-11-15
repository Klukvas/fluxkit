"use client";

import { Button } from "@fluxkit/ui";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, type ReactNode, type Ref } from "react";
import { localizedHref } from "../lib/locale-path";
import { useI18n } from "./i18n-provider";
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
  const navigation = useSignInNavigation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const closing = useRef(false);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    mounted.current = true;
    closing.current = false;
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
      observer.disconnect();
      document.documentElement.classList.remove("fk-sign-in-open");
      if (dialog.open) dialog.close();
    };
  }, [titleId]);
  const dismiss = () => {
    if (!mounted.current || closing.current) return;
    closing.current = true;
    const action = navigation === null ? "home" : navigation.coordinator.dismiss();
    if (action === "back") router.back();
    else if (action === "home") router.replace(localizedHref(locale, "/"));
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
