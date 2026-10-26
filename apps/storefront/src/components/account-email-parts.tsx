"use client";

import { Alert, Container, Spinner, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { failureText, type Failure } from "../lib/failure";
import { linkButton } from "./styles";

/**
 * The frame of the three emailed-link pages (forgot password, reset password, verify email): one `h1` that can take the
 * focus, and a narrow column. Every state of a page has its own heading text, so moving the focus to the heading after an
 * outcome makes a screen reader say what happened.
 */
export function EmailPageFrame({
  title,
  headingRef,
  busy = false,
  children,
}: {
  title: string;
  headingRef?: Ref<HTMLHeadingElement>;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <Container className="py-8">
      <div className="flex max-w-md flex-col gap-4" aria-busy={busy}>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-3xl font-bold text-foreground focus:outline-none"
        >
          {title}
        </h1>
        {children}
      </div>
    </Container>
  );
}

/**
 * Focuses the heading when `active` turns true (an outcome the person waited for: sent, saved, confirmed, refused), never
 * on the first render of the page: after a client-side navigation `RouteFocus` has done that already.
 */
export function useHeadingFocus(active: boolean): Ref<HTMLHeadingElement> {
  const ref = useRef<HTMLHeadingElement>(null);
  const previous = useRef(active);
  useEffect(() => {
    if (active && !previous.current) ref.current?.focus();
    previous.current = active;
  }, [active]);
  return ref;
}

/** The state of a page while its link is read (the fragment is unknown to the server): a heading and a spinner. */
export function CheckingView({ t, title }: { t: Translator; title: string }) {
  return (
    <EmailPageFrame title={title} busy>
      <Spinner label={t("account.emailPage.checking")} />
    </EmailPageFrame>
  );
}

/** Shown when the shop has no email provider (`emailDelivery` false, or the API answered 404): nothing is sent, nothing to try. */
export function EmailUnavailableView({
  t,
  signInHref,
  headingRef,
}: {
  t: Translator;
  signInHref: string;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <EmailPageFrame title={t("account.emailPage.unavailable.title")} headingRef={headingRef}>
      <p className="text-foreground">{t("account.emailPage.unavailable.description")}</p>
      <Link href={signInHref} className={`${linkButton} self-start`}>
        {t("account.emailPage.signIn")}
      </Link>
    </EmailPageFrame>
  );
}

/** A failure that belongs to no field (429, network, server error) as one alert. */
export function FailureAlert({
  t,
  failure,
  title,
}: {
  t: Translator;
  failure: Failure;
  title?: string;
}) {
  return (
    <Alert variant="danger" {...(title === undefined ? {} : { title })}>
      <p>{failureText(t, failure)}</p>
    </Alert>
  );
}
