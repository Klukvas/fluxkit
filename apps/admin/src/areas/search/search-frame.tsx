import { Alert, LiveRegion, locales, type Translator } from "@fluxkit/ui";
import type { ReactNode, Ref } from "react";
import { Link } from "react-router";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { PATHS, type RouteId } from "../../router/paths";
import { PageHeading } from "../../views/status-views";

export const linkClass = "font-medium text-foreground underline underline-offset-4";
export const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The two screens of the Search area, in the order of the sub-navigation (both are read with catalog.read). */
export const SEARCH_SCREENS = [
  { id: "search", labelKey: "search.nav.status" },
  { id: "searchSynonyms", labelKey: "search.nav.synonyms" },
] as const satisfies readonly { id: RouteId; labelKey: string }[];

export type SearchScreenId = (typeof SEARCH_SCREENS)[number]["id"];

/** Sub-navigation of the area, the current screen marked with `aria-current`. */
export function SearchNav({ t, current }: { t: Translator; current: SearchScreenId }) {
  return (
    <nav aria-label={t("search.nav.label")}>
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {SEARCH_SCREENS.map((screen) => (
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
export function SearchFrame({
  t,
  current,
  title,
  actions,
  children,
}: {
  t: Translator;
  current: SearchScreenId;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <SearchNav t={t} current={current} />
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

/** The language of an index or a synonym group: its name when the UI knows the language, else the code. */
export function localeLabel(t: Translator, locale: string): string {
  return (locales as readonly string[]).includes(locale)
    ? t(`search.localeName.${locale}`)
    : locale;
}

/** The environment variable NAMES that switch search on (never a value or a key). */
export const OFF_STEP_KEYS = ["search.off.step1", "search.off.step2", "search.off.step3"] as const;

/** Shown by both screens when the search routes answer 404: `SEARCH_ENABLED=false` mounts none of them. */
export function SearchOffView({ t }: { t: Translator }) {
  return (
    <section aria-labelledby="search-off" className="flex max-w-2xl flex-col gap-3">
      <Alert variant="info" title={t("search.off.title")}>
        <p>{t("search.off.body")}</p>
      </Alert>
      <h2 id="search-off" className="text-lg font-semibold text-foreground">
        {t("search.off.stepsTitle")}
      </h2>
      <ol className="flex list-decimal flex-col gap-1 ps-6">
        {OFF_STEP_KEYS.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ol>
      <p className="text-muted-foreground">{t("search.off.secretNote")}</p>
    </section>
  );
}
