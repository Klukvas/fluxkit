"use client";

import { Button } from "@fluxkit/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, type ReactNode, type Ref } from "react";
import { localizedHref } from "../lib/locale-path";
import {
  focusSignInDestination,
  isSameDocumentFragment,
  signInCloseAction,
} from "../lib/sign-in-navigation";
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

// Separate string on purpose: the backdrop is not the surface behind the dialog's text (see the contrast scan).
const backdrop = "backdrop:bg-scrim";

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
      className={`fk-sign-in-modal m-auto max-w-md rounded-overlay border border-border bg-background p-6 text-foreground shadow-card ${backdrop}`}
      onClickCapture={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        const anchor = event.target instanceof Element ? event.target.closest("a") : null;
        if (
          !(anchor instanceof HTMLAnchorElement) ||
          anchor.download ||
          (anchor.target && anchor.target !== "_self") ||
          !isSameDocumentFragment(anchor.href, event.currentTarget.ownerDocument.URL)
        )
          return;
        // Field-error links must not add a history entry ahead of the dialog's dismissal target.
        event.preventDefault();
        let id: string;
        try {
          id = decodeURIComponent(new URL(anchor.href).hash.slice(1));
        } catch {
          // A malformed percent-encoded fragment has no decodable target id.
          return;
        }
        if (!id) return;
        const target = event.currentTarget.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
        if (!target) return;
        target.focus({ preventScroll: true });
        target.scrollIntoView({
          block: "nearest",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
      }}
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const coordinator = useSignInNavigation()?.coordinator ?? null;
  const { store } = useAccount();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const closing = useRef(false);
  const titleId = useId();
  useEffect(() => {
    // A committed traversal can retain this slot; allow another dismissal in that case.
    closing.current = false;
  }, [pathname, searchParams]);
  useEffect(() => {
    // Hash-only traversals do not change pathname or search params.
    const resetClosing = () => {
      closing.current = false;
    };
    window.addEventListener("popstate", resetClosing);
    return () => window.removeEventListener("popstate", resetClosing);
  }, []);
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
