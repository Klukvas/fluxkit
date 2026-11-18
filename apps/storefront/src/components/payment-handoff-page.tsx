"use client";

import { Button, Container, textStyles, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { sessionAttemptStorage } from "../lib/checkout-attempt";
import { localizedHref } from "../lib/locale-path";
import { fetchPaymentHandoff, submitHandoffForm, type HandoffFetch } from "../lib/payment-handoff";
import {
  paymentIdFromSearch,
  readPaymentReturn,
  returnOrderHref,
  type PaymentReturn,
} from "../lib/payment-return";
import { useI18n } from "./i18n-provider";
import { useStoreClient } from "./session-provider";
import { linkButton } from "./styles";

type ViewState =
  | { kind: "loading" }
  | { kind: "submitting" }
  | { kind: "no_entry" }
  | { kind: "not_found" }
  | { kind: "unavailable" }
  | { kind: "error" };

export interface PaymentHandoffViewProps {
  t: Translator;
  state: ViewState;
  entry: PaymentReturn | null;
}

export function PaymentHandoffView({ t, state, entry }: PaymentHandoffViewProps) {
  const { locale } = useI18n();
  const title =
    state.kind === "loading" || state.kind === "submitting"
      ? t("payment.handoff.working")
      : t("payment.handoff.errorTitle");
  const body =
    state.kind === "loading" || state.kind === "submitting"
      ? t("payment.handoff.workingBody")
      : state.kind === "no_entry"
        ? t("payment.handoff.noEntry")
        : state.kind === "not_found"
          ? t("payment.handoff.notFound")
          : state.kind === "unavailable"
            ? t("payment.handoff.unavailable")
            : t("payment.handoff.error");
  const orderHref = entry === null ? null : returnOrderHref(locale, entry);
  return (
    <Container className="py-xl">
      <div role="status" aria-live="polite" className="mx-auto max-w-lg space-y-md">
        <h1 className={textStyles.pageTitle}>{title}</h1>
        <p className="mt-2">{body}</p>
        {orderHref !== null && state.kind !== "loading" && state.kind !== "submitting" ? (
          <p>
            <Link href={orderHref} className={linkButton}>
              {t("payment.return.backToOrder")}
            </Link>
          </p>
        ) : null}
        {state.kind === "error" || state.kind === "unavailable" ? (
          <p>
            <Button type="button" onClick={() => window.location.reload()}>
              {t("payment.handoff.retry")}
            </Button>
          </p>
        ) : null}
        {orderHref === null && state.kind !== "loading" && state.kind !== "submitting" ? (
          <p>
            <Link href={localizedHref(locale, "/")} className={linkButton}>
              {t("nav.home")}
            </Link>
          </p>
        ) : null}
      </div>
    </Container>
  );
}

function toView(fetch: HandoffFetch): ViewState {
  switch (fetch.kind) {
    case "ok":
      return { kind: "submitting" };
    case "not_found":
      return { kind: "not_found" };
    case "unavailable":
      return { kind: "unavailable" };
    case "error":
      return { kind: "error" };
  }
}

/**
 * Same-origin bridge for form-POST payment providers (ADR 0059). Reads the payment hand-off from this tab, fetches
 * signed fields from the API, and auto-submits a POST form to the allow-listed provider host.
 */
export function PaymentHandoffPage() {
  const { t } = useI18n();
  const client = useStoreClient();
  const storage = useSyncExternalStore(
    () => () => undefined,
    () => sessionAttemptStorage(() => window.sessionStorage),
    () => null,
  );
  const [entry, setEntry] = useState<PaymentReturn | null>(null);
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    const paymentId = paymentIdFromSearch(window.location.search);
    const saved = readPaymentReturn(storage);
    setEntry(saved);
    if (paymentId === null || saved === null) {
      setState({ kind: "no_entry" });
      return;
    }
    let cancelled = false;
    void (async () => {
      const answer = await fetchPaymentHandoff(client, saved, paymentId);
      if (cancelled) return;
      if (answer.kind === "ok") {
        setState({ kind: "submitting" });
        if (!submitHandoffForm(document, answer.handoff)) {
          setState({ kind: "error" });
        }
        return;
      }
      setState(toView(answer));
    })();
    return () => {
      cancelled = true;
    };
  }, [client, storage]);

  return <PaymentHandoffView t={t} state={state} entry={entry} />;
}
