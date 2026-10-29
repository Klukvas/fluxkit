"use client";

import { Button, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { createAccountEmailFlows } from "../lib/account-email-flows";
import type { Failure } from "../lib/failure";
import { localizedHref } from "../lib/locale-path";
import { loginHref } from "../lib/safe-next";
import {
  CheckingView,
  EmailPageFrame,
  EmailUnavailableView,
  FailureAlert,
  useHeadingFocus,
} from "./account-email-parts";
import { ResendVerification } from "./account-verify-notice";
import { useI18n } from "./i18n-provider";
import { useAccount, useStoreClient } from "./session-provider";
import { linkButton } from "./styles";
import { useFragmentToken } from "./use-fragment-token";

export function VerifyEmailDoneView({
  t,
  accountHref,
  headingRef,
}: {
  t: Translator;
  accountHref: string;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <EmailPageFrame title={t("account.verify.done.title")} headingRef={headingRef}>
      <p role="status" className="text-foreground">
        {t("account.verify.done.description")}
      </p>
      <Link href={accountHref} className={`${linkButton} self-start`}>
        {t("account.verify.toAccount")}
      </Link>
    </EmailPageFrame>
  );
}

/**
 * A link that is missing, malformed, unknown, used, expired or replaced: one state. What to do next depends on who is
 * looking: a signed-in customer can ask for a new link here (`children`), a guest is sent to sign in first.
 */
export function VerifyEmailInvalidView({
  t,
  headingRef,
  children,
}: {
  t: Translator;
  headingRef?: Ref<HTMLHeadingElement>;
  children?: ReactNode;
}) {
  return (
    <EmailPageFrame title={t("account.verify.invalid.title")} headingRef={headingRef}>
      <p role="status" className="text-foreground">
        {t("account.verify.invalid.description")}
      </p>
      {children}
    </EmailPageFrame>
  );
}

/** The request could not be made (a network error, a wait): the token is still in memory, so the person can try again. */
export function VerifyEmailErrorView({
  t,
  failure,
  onRetry,
  headingRef,
}: {
  t: Translator;
  failure: Failure;
  onRetry: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <EmailPageFrame title={t("account.verify.error.title")} headingRef={headingRef}>
      <FailureAlert t={t} failure={failure} />
      <Button className="self-start" onClick={onRetry}>
        {t("account.verify.retry")}
      </Button>
    </EmailPageFrame>
  );
}

/**
 * A link that looks usable, before anything is sent: what the button does, and the button. Confirming needs this press
 * (email review F4): a mail scanner that opens the link, or a person who never registered here, confirms nothing.
 */
export function VerifyEmailConfirmView({
  t,
  onConfirm,
  headingRef,
}: {
  t: Translator;
  onConfirm: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <EmailPageFrame title={t("account.verify.ready.title")} headingRef={headingRef}>
      <p className="text-foreground">{t("account.verify.ready.description")}</p>
      <Button className="self-start" onClick={onConfirm}>
        {t("account.verify.confirm")}
      </Button>
    </EmailPageFrame>
  );
}

type Phase =
  | { status: "ready" }
  | { status: "confirming" }
  | { status: "verified" }
  | { status: "invalid" }
  | { status: "unavailable" }
  | { status: "error"; failure: Failure };

/**
 * `/{locale}/account/verify-email#t=<token>`. The token is read from the fragment in the browser only and removed from the
 * address bar at once (`useFragmentToken`). Nothing is sent on load: the page explains the link and the confirm call is
 * made only when the person presses the button (or "try again" after an error), with the token in the POST body. The
 * states: ready, confirming, verified, invalid or expired, not available, and a retryable error.
 */
export function VerifyEmailPage({ emailDelivery }: { emailDelivery: boolean }) {
  const { locale, t } = useI18n();
  const client = useStoreClient();
  const { state: accountState, store: account } = useAccount();
  const flows = useMemo(() => createAccountEmailFlows(client), [client]);
  const token = useFragmentToken();
  const [phase, setPhase] = useState<Phase>({ status: "ready" });
  const headingRef = useHeadingFocus(phase.status !== "confirming");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const confirm = useCallback(() => {
    if (typeof token !== "string") return;
    setPhase({ status: "confirming" });
    void flows.confirmEmail(token).then((outcome) => {
      if (!mounted.current) return;
      if (outcome.status === "verified") {
        // The customer's `emailVerified` changed: the account page must not keep the notice.
        void account.refresh();
        setPhase({ status: "verified" });
      } else if (outcome.status === "failed") {
        setPhase({ status: "error", failure: outcome.failure });
      } else {
        setPhase({ status: outcome.status });
      }
    });
  }, [token, flows, account]);

  const signInHref = localizedHref(locale, "/account/login");
  if (!emailDelivery || phase.status === "unavailable") {
    return <EmailUnavailableView t={t} signInHref={signInHref} headingRef={headingRef} />;
  }
  if (token === undefined || (token !== null && phase.status === "confirming")) {
    return <CheckingView t={t} title={t("account.verify.confirming")} />;
  }
  if (token !== null && phase.status === "ready") {
    return <VerifyEmailConfirmView t={t} onConfirm={confirm} headingRef={headingRef} />;
  }
  if (token === null || phase.status === "invalid") {
    const session = accountState.session;
    return (
      <VerifyEmailInvalidView t={t} headingRef={headingRef}>
        {session.status === "signedIn" ? (
          <>
            <p className="text-foreground">{t("account.verify.invalid.signedIn")}</p>
            <ResendVerification />
          </>
        ) : session.status === "guest" ? (
          <>
            <p className="text-foreground">{t("account.verify.invalid.guest")}</p>
            <Link
              href={loginHref(locale, localizedHref(locale, "/account"))}
              className={`${linkButton} self-start`}
            >
              {t("account.verify.signIn")}
            </Link>
          </>
        ) : null}
      </VerifyEmailInvalidView>
    );
  }
  if (phase.status === "error") {
    return (
      <VerifyEmailErrorView
        t={t}
        failure={phase.failure}
        headingRef={headingRef}
        onRetry={confirm}
      />
    );
  }
  return (
    <VerifyEmailDoneView
      t={t}
      accountHref={localizedHref(locale, "/account")}
      headingRef={headingRef}
    />
  );
}
