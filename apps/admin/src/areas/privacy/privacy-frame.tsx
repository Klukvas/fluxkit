import { Alert, LiveRegion, type Translator } from "@fluxkit/ui";
import type { ReactNode, Ref } from "react";
import { Link } from "react-router";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { PATHS, type RouteId } from "../../router/paths";
import { PageHeading } from "../../views/status-views";

export const linkClass = "font-medium text-foreground underline underline-offset-4";
export const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The two lists of the Privacy area, in the order of the sub-navigation (both need privacy.manage). */
export const PRIVACY_SCREENS = [
  { id: "privacy", labelKey: "personal.nav.requests" },
  { id: "privacyLookup", labelKey: "personal.nav.lookup" },
] as const satisfies readonly { id: RouteId; labelKey: string }[];

export type PrivacyScreenId = (typeof PRIVACY_SCREENS)[number]["id"] | "privacyRequestDetail";

/** Sub-navigation of the area, the current screen marked with `aria-current` (a request's detail belongs to "requests"). */
export function PrivacyNav({ t, current }: { t: Translator; current: PrivacyScreenId }) {
  const active = current === "privacyRequestDetail" ? "privacy" : current;
  return (
    <nav aria-label={t("personal.nav.label")}>
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {PRIVACY_SCREENS.map((screen) => (
          <li key={screen.id}>
            <Link
              to={PATHS[screen.id]}
              aria-current={screen.id === active ? "page" : undefined}
              className={
                screen.id === active
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
export function PrivacyFrame({
  t,
  current,
  title,
  children,
}: {
  t: Translator;
  current: PrivacyScreenId;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PrivacyNav t={t} current={current} />
      <PageHeading>{title}</PageHeading>
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

/** A refusal inside a dialog or form, focusable so the focus can move to it. */
export function ErrorBox({
  t,
  descriptor,
  innerRef,
  children,
}: {
  t: Translator;
  descriptor: MessageDescriptor | null;
  innerRef?: Ref<HTMLDivElement>;
  children?: ReactNode;
}) {
  if (descriptor === null) return null;
  return (
    <div ref={innerRef} tabIndex={-1} className={focusClass}>
      <Alert variant="danger">
        <p>
          <DescriptorText t={t} descriptor={descriptor} />
        </p>
        {children}
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
