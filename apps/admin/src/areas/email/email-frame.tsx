import { Alert, LiveRegion, type Translator } from "@fluxkit/ui";
import type { ReactNode, Ref } from "react";
import { Link } from "react-router";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { PATHS, type RouteId } from "../../router/paths";
import { PageHeading } from "../../views/status-views";
import { describeErrorCode } from "./email-view";

export const linkClass = "font-medium text-foreground underline underline-offset-4";
export const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The three lists of the Email area, in the order of the sub-navigation (all need email.manage). */
export const EMAIL_SCREENS = [
  { id: "email", labelKey: "mail.nav.status" },
  { id: "emailMessages", labelKey: "mail.nav.messages" },
  { id: "emailTemplates", labelKey: "mail.nav.templates" },
] as const satisfies readonly { id: RouteId; labelKey: string }[];

export type EmailScreenId = (typeof EMAIL_SCREENS)[number]["id"];

/** Sub-navigation of the area, the current screen marked with `aria-current`. */
export function EmailNav({ t, current }: { t: Translator; current: EmailScreenId }) {
  return (
    <nav aria-label={t("mail.nav.label")}>
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {EMAIL_SCREENS.map((screen) => (
          <li key={screen.id}>
            <Link
              to={PATHS[screen.id]}
              aria-current={screen.id === current ? "page" : undefined}
              className={
                screen.id === current
                  ? "font-semibold text-foreground underline underline-offset-4"
                  : "text-muted-foreground underline underline-offset-4"
              }
            >
              {t(screen.labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Every screen of the area: the sub-navigation, then the one `h1`, then the content. */
export function EmailFrame({
  t,
  current,
  title,
  actions,
  children,
}: {
  t: Translator;
  current: EmailScreenId;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <EmailNav t={t} current={current} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>{title}</PageHeading>
        {actions}
      </div>
      {children}
    </div>
  );
}

/** A message with the unknown code in small print (admins need it for support). */
export function DescriptorText({
  t,
  descriptor,
}: {
  t: Translator;
  descriptor: MessageDescriptor;
}) {
  return (
    <>
      {t(descriptor.key, descriptor.values)}
      {descriptor.code === undefined ? null : (
        <small className="ms-2 text-muted-foreground">
          {t("errors.reference", { code: descriptor.code })}
        </small>
      )}
    </>
  );
}

/** A refusal inside a dialog, focusable so the focus can move to it. */
export function DialogError({
  t,
  descriptor,
  innerRef,
}: {
  t: Translator;
  descriptor: MessageDescriptor | null;
  innerRef?: Ref<HTMLDivElement>;
}) {
  if (descriptor === null) return null;
  return (
    <div ref={innerRef} tabIndex={-1} className={focusClass}>
      <Alert variant="danger">
        <p>
          <DescriptorText t={t} descriptor={descriptor} />
        </p>
      </Alert>
    </div>
  );
}

/**
 * The status line of a screen: always in the page (a live region announces changes of a region that was already there),
 * focusable so the focus can move to it after an action.
 */
export function StatusLine({
  innerRef,
  children,
}: {
  innerRef?: Ref<HTMLDivElement>;
  children?: ReactNode;
}) {
  return (
    <div ref={innerRef} tabIndex={-1} className={focusClass}>
      <LiveRegion>{children}</LiveRegion>
    </div>
  );
}

/** A stored error code: the explanation, then the code in small print. */
export function ErrorCodeText({ t, code }: { t: Translator; code: string }) {
  const view = describeErrorCode(code);
  return (
    <span className="flex flex-col">
      <span>{t(view.key)}</span>
      <small className="break-all font-mono text-muted-foreground">{view.code}</small>
    </span>
  );
}
