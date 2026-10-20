import { Button, LiveRegion, type Translator } from "@fluxkit/ui";
import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { Link } from "react-router";
import { PATHS, type RouteId } from "../../router/paths";
import { PageHeading } from "../../views/status-views";
import { UnknownResultNotice } from "./form-parts";

/** The five dictionary screens, in the order of the sub-navigation (all of them need `catalog.read`). */
export const DICTIONARY_SCREENS = [
  { id: "attributes", titleKey: "page.attributes.title" },
  { id: "options", titleKey: "page.options.title" },
  { id: "productTypes", titleKey: "page.productTypes.title" },
  { id: "brands", titleKey: "page.brands.title" },
  { id: "categories", titleKey: "page.categories.title" },
] as const satisfies readonly { id: RouteId; titleKey: string }[];

export type DictionaryId = (typeof DICTIONARY_SCREENS)[number]["id"];

const linkClass = "font-medium text-foreground underline underline-offset-4";

/** Sub-navigation of the area: a link to each dictionary, the current one marked with `aria-current`. */
export function DictionaryNav({ t, current }: { t: Translator; current: DictionaryId }) {
  return (
    <nav aria-label={t("dict.nav.label")}>
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {DICTIONARY_SCREENS.map((screen) => (
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
              {t(screen.titleKey)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Every dictionary screen: the sub-navigation, then the one `h1`, then the content. */
export function DictionaryPage({
  t,
  current,
  title,
  actions,
  children,
}: {
  t: Translator;
  current: DictionaryId;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <DictionaryNav t={t} current={current} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>{title}</PageHeading>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <p>
      <Link to={to} className={linkClass}>
        {label}
      </Link>
    </p>
  );
}

export const NOTICE_KINDS = [
  "saved",
  "noChanges",
  "itemSaved",
  "itemDeleted",
  "assignmentSaved",
  "assignmentRemoved",
  "moved",
  "unknown",
] as const;

export type NoticeKind = (typeof NOTICE_KINDS)[number];

const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * The status line of a screen: always in the page (a live region announces changes of a region that was already there), and
 * focusable so the focus can move to it after a save. A lost answer is a warning that asks the admin to look at the
 * reloaded data, not a success.
 */
export function NoticeBar({
  t,
  notice,
  innerRef,
}: {
  t: Translator;
  notice: { kind: NoticeKind; n: number } | null;
  innerRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={innerRef} tabIndex={-1} className={focusClass}>
      <LiveRegion>
        {notice === null ? null : notice.kind === "unknown" ? (
          <UnknownResultNotice t={t} />
        ) : (
          <p className="rounded-md border border-success p-3 text-foreground">
            {t(`dict.notice.${notice.kind}`)}
          </p>
        )}
      </LiveRegion>
    </div>
  );
}

/** A panel that takes the focus when it appears (after a create or a delete), so the outcome is announced. */
export function FocusedPanel({ title, children }: { title: string; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div ref={ref} tabIndex={-1} className={`flex flex-col gap-3 ${focusClass}`}>
      <LiveRegion>
        <p className="rounded-md border border-success p-3 font-medium text-foreground">{title}</p>
      </LiveRegion>
      {children}
    </div>
  );
}

/** The delete section of an editor: what deleting does and the danger button. Nothing without write permission. */
export function DangerZone({
  t,
  canWrite,
  id,
  info,
  buttonLabel,
  onDelete,
}: {
  t: Translator;
  canWrite: boolean;
  id: string;
  info: string;
  buttonLabel: string;
  onDelete: () => void;
}) {
  if (!canWrite) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-lg font-semibold">
        {t("dict.form.dangerZone")}
      </h2>
      <p className="text-muted-foreground">{info}</p>
      <div>
        <Button variant="danger" onClick={onDelete}>
          {buttonLabel}
        </Button>
      </div>
    </section>
  );
}

/** What replaces an editor after its item was deleted. */
export function DeletedPanel({
  t,
  title,
  listTo,
}: {
  t: Translator;
  title: string;
  listTo: string;
}) {
  return (
    <FocusedPanel title={title}>
      <BackLink to={listTo} label={t("dict.form.backToList")} />
    </FocusedPanel>
  );
}

/** A create that got no answer: the admin looks at the list before trying again (nothing is sent twice by the screen). */
export function CreateUnknown({ t, listTo }: { t: Translator; listTo: string }) {
  return (
    <div role="alert" className="rounded-md border border-warning p-4">
      <p className="font-semibold">{t("dict.unknown.title")}</p>
      <p>{t("dict.unknown.createBody")}</p>
      <p className="mt-2">
        <Link to={listTo} className={linkClass}>
          {t("dict.unknown.checkList")}
        </Link>
      </p>
    </div>
  );
}

export { linkClass };
