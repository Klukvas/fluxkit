import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { AreaMessages } from "../../i18n/area-messages";
import { useI18n } from "../../i18n/i18n-context";
import { usePageTitle } from "../../i18n/page-title";
import { adminClient } from "../../lib/api";
import { useFocusAfterCommit } from "../../lib/use-focus-after-commit";
import { useResource } from "../../lib/use-resource";
import { canRun } from "../../permissions";
import { PATHS } from "../../router/paths";
import { useScreenAccess } from "../../router/screen-access";
import { useSession } from "../../session/session-context";
import { PageHeading } from "../../views/status-views";
import { ArticleView, helpLinkClass } from "./article-view";
import { loadChecklistFacts, withManual } from "./checklist-model";
import { useChecklistPreferences } from "./checklist-storage";
import {
  ChecklistView,
  HiddenNoticeView,
  type ChecklistPlace,
  type ChecklistViewProps,
} from "./checklist-view";
import { HELP_LIBRARY } from "./content";
import { HelpIndexView } from "./help-index-view";
import { HELP_MESSAGE_FILES } from "./help-message-files";
import {
  findArticle,
  neighbours,
  sectionElementId,
  sectionFromHash,
  sectionsOf,
} from "./help-model";
import { MAX_QUERY_LENGTH, buildSearchIndex, searchArticles } from "./help-search";

/**
 * The getting-started checklist with its data: the facts are read when it mounts (one read per fact, never repeated by
 * itself; "Check again" reads them again), the admin's ticks and the hidden flag come from this browser.
 */
export function ChecklistPanel({ place }: { place: ChecklistPlace }) {
  const session = useSession();
  const adminUserId = session.state.me?.user.id ?? null;
  // The shell renders pages only with a session; without a known user there is no storage key, so no checklist at all
  // (never a key shared by everybody).
  if (adminUserId === null) return null;
  return <ChecklistForUser key={adminUserId} place={place} adminUserId={adminUserId} />;
}

function ChecklistForUser({ place, adminUserId }: { place: ChecklistPlace; adminUserId: string }) {
  const { t } = useI18n();
  const { preferences, storageFailed, update } = useChecklistPreferences(adminUserId);
  const [justHidden, setJustHidden] = useState(false);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const focusAfterCommit = useFocusAfterCommit();

  // Hidden on the start page: nothing is read; right after hiding, a focused line says where the checklist went.
  if (place === "home" && preferences.dismissed) {
    return justHidden ? <HiddenNoticeView t={t} headingRef={noticeRef} /> : null;
  }
  return (
    <ChecklistWithFacts
      place={place}
      preferences={preferences}
      storageFailed={storageFailed}
      onToggleManual={(step, done) => update(withManual(preferences, step, done))}
      onToggleShownOnHome={(shown) => {
        update({ ...preferences, dismissed: !shown });
        if (place === "home" && !shown) {
          setJustHidden(true);
          focusAfterCommit(noticeRef);
        }
      }}
    />
  );
}

function ChecklistWithFacts({
  place,
  ...props
}: Pick<
  ChecklistViewProps,
  "place" | "preferences" | "storageFailed" | "onToggleManual" | "onToggleShownOnHome"
>) {
  const { t } = useI18n();
  const session = useSession();
  const { canOpen } = useScreenAccess();
  const me = session.state.me;
  const permissions = me?.permissions ?? null;
  const facts = useResource(
    async (signal) => ({
      ok: true as const,
      status: 200,
      data: await loadChecklistFacts(
        adminClient,
        (operation) => canRun(permissions, operation),
        signal,
      ),
    }),
    [me?.user.id, (permissions ?? []).join(",")],
  );
  return (
    <ChecklistView
      t={t}
      place={place}
      facts={facts}
      canOpen={canOpen}
      onRetry={facts.reload}
      {...props}
    />
  );
}

/** The start page's card: loads the help messages first (the start page itself is in the entry chunk, the help is not). */
export function HomeChecklist() {
  return (
    <AreaMessages files={HELP_MESSAGE_FILES}>
      <ChecklistPanel place="home" />
    </AreaMessages>
  );
}

/** `/help`: search (the query is kept in `?q=`), the checklist and the topics. */
export function HelpIndexPage() {
  const { t, locale } = useI18n();
  const [params, setParams] = useSearchParams();
  // The box keeps its own state (no caret jump while the URL catches up); the URL only remembers it for back and reload.
  const urlQuery = (params.get("q") ?? "").slice(0, MAX_QUERY_LENGTH);
  const [query, setQuery] = useState(urlQuery);
  // The URL changed without the box (the Help link of the navigation drops `?q`, Back and Forward): the box follows it.
  // What the box itself wrote is remembered, so typing never resets the box.
  const written = useRef(urlQuery);
  useEffect(() => {
    if (urlQuery === written.current) return;
    written.current = urlQuery;
    setQuery(urlQuery);
  }, [urlQuery]);
  const index = useMemo(() => buildSearchIndex(HELP_LIBRARY), []);
  const results = useMemo(() => searchArticles(index, query), [index, query]);
  return (
    <HelpIndexView
      t={t}
      locale={locale}
      library={HELP_LIBRARY}
      query={query}
      results={results}
      onQuery={(next) => {
        setQuery(next);
        written.current = next.trim() === "" ? "" : next;
        setParams(next.trim() === "" ? {} : { q: next }, { replace: true });
      }}
      checklist={<ChecklistPanel place="help" />}
    />
  );
}

/** `/help/:articleId` (sections as `#<id>`): the article; an unknown id says so and links the list. */
export function HelpArticlePage() {
  const { t, locale } = useI18n();
  const { articleId = "" } = useParams();
  const location = useLocation();
  const access = useScreenAccess();
  const focusAfterCommit = useFocusAfterCommit();
  const article = findArticle(HELP_LIBRARY, articleId);
  // The document title names the article, or says it does not exist (not the generic "Help article").
  usePageTitle(article === null ? t("help.article.notFoundTitle") : article.title[locale]);

  // A section anchor moves the focus (and so the scroll) to its heading. It is requested from an effect, so it lands in
  // the NEXT commit: after the route focus, which runs in the parent's effect of the navigation's commit and would
  // otherwise put the focus back on the `h1` (`router/route-focus.tsx`).
  useEffect(() => {
    if (article === null) return;
    const section = sectionFromHash(location.hash);
    if (section === null || !sectionsOf(article).some((entry) => entry.id === section)) return;
    focusAfterCommit(sectionElementId(section));
  }, [article, location.hash, location.key, focusAfterCommit]);

  if (article === null) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeading>{t("help.article.notFoundTitle")}</PageHeading>
        <p className="text-muted-foreground">{t("help.article.notFoundBody")}</p>
        <p>
          <Link to={PATHS.help} className={helpLinkClass}>
            {t("help.article.allArticles")}
          </Link>
        </p>
      </div>
    );
  }
  const { previous, next } = neighbours(HELP_LIBRARY, article.id);
  const topic = HELP_LIBRARY.topics.find((entry) => entry.id === article.topic) ?? null;
  return (
    <ArticleView
      t={t}
      locale={locale}
      article={article}
      topic={topic}
      previous={previous}
      next={next}
      access={access}
    />
  );
}
