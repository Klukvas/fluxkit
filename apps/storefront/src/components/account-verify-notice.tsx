"use client";

import type { Customer } from "@fluxkit/api-client";
import { Alert, Button, type Translator } from "@fluxkit/ui";
import { useMemo, useState, type ReactNode } from "react";
import { createAccountEmailFlows } from "../lib/account-email-flows";
import { failureText, type Failure } from "../lib/failure";
import { useI18n } from "./i18n-provider";
import { useAccount, useStoreClient } from "./session-provider";

export type ResendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent" }
  | { status: "alreadyVerified" }
  | { status: "unavailable" }
  | { status: "failed"; failure: Failure };

/**
 * "Send the link again": a button and a live region that says what happened. The region is always in the markup (a polite
 * announcement needs an element that exists before its text does); a failure (429 with its wait, a network error) is an
 * alert beside it.
 */
export function ResendVerificationView({
  t,
  state,
  onSend,
}: {
  t: Translator;
  state: ResendState;
  onSend: () => void;
}) {
  const pending = state.status === "sending";
  const message =
    state.status === "sent"
      ? t("account.verifyNotice.sent")
      : state.status === "alreadyVerified"
        ? t("account.verifyNotice.alreadyVerified")
        : state.status === "unavailable"
          ? t("account.verifyNotice.unavailable")
          : "";
  return (
    <div className="mt-3 flex flex-col gap-2">
      <Button
        variant="secondary"
        className="self-start"
        onClick={onSend}
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? t("account.verifyNotice.sending") : t("account.verifyNotice.send")}
      </Button>
      <p role="status" aria-live="polite" className="min-h-6 text-sm text-foreground">
        {message}
      </p>
      {state.status === "failed" ? (
        <Alert variant="danger">
          <p>{failureText(t, state.failure)}</p>
        </Alert>
      ) : null}
    </div>
  );
}

/** The resend call and its state, for the account notice and for the "link did not work" state of the verify page. */
export function ResendVerification() {
  const { t } = useI18n();
  const client = useStoreClient();
  const { store: account } = useAccount();
  const flows = useMemo(() => createAccountEmailFlows(client), [client]);
  const [state, setState] = useState<ResendState>({ status: "idle" });

  async function send(): Promise<void> {
    if (state.status === "sending") return;
    setState({ status: "sending" });
    const outcome = await flows.resendVerification();
    if (outcome.status === "signedOut") {
      // The session ended: the account gate takes over (sign-in redirect) once the store knows.
      account.sessionEnded();
      setState({ status: "idle" });
      return;
    }
    if (outcome.status === "alreadyVerified") {
      // Read the customer again so the notice goes away.
      void account.refresh();
    }
    setState(outcome);
  }

  return <ResendVerificationView t={t} state={state} onSend={() => void send()} />;
}

/** The warning of the account page for an address that is not confirmed yet. */
export function VerifyEmailNoticeView({
  t,
  email,
  children,
}: {
  t: Translator;
  email: string;
  children: ReactNode;
}) {
  return (
    <Alert variant="warning" title={t("account.verifyNotice.title")}>
      <p>{t("account.verifyNotice.description", { email })}</p>
      {children}
    </Alert>
  );
}

/** Shown only with a mail provider (`emailDelivery`) and only while the address is not confirmed. */
export function VerifyEmailNotice({
  customer,
  emailDelivery,
}: {
  customer: Customer;
  emailDelivery: boolean;
}) {
  const { t } = useI18n();
  if (!emailDelivery || customer.emailVerified) return null;
  return (
    <VerifyEmailNoticeView t={t} email={customer.email}>
      <ResendVerification />
    </VerifyEmailNoticeView>
  );
}
