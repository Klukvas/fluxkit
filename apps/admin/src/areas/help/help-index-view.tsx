import { Button, Field, Input, LiveRegion, type Locale, type Translator } from "@fluxkit/ui";
import { useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { PageHeading } from "../../views/status-views";
import { articlesByTopic, helpArticlePath, type HelpArticle, type HelpLibrary } from "./help-model";
import { standaloneLinkClass } from "../../views/links";

export interface HelpIndexViewProps {
  t: Translator;
  locale: Locale;
  library: HelpLibrary;
  query: string;
  /** The articles found for `query` (empty for an empty query). */
  results: readonly HelpArticle[];
  onQuery: (query: string) => void;
  /** The getting-started checklist (its own data and state). */
  checklist: ReactNode;
}

function ArticleItem({ locale, article }: { locale: Locale; article: HelpArticle }) {
  return (
    <li className="flex flex-col gap-1">
      <Link to={helpArticlePath(article.id)} className={standaloneLinkClass}>
        {article.title[locale]}
      </Link>
      <p className="max-w-prose text-sm text-muted-foreground">{article.summary[locale]}</p>
    </li>
  );
}

/**
 * `/help`: the search box (the results are announced politely), the getting-started checklist and the articles grouped by
 * topic. Markup only.
 */
export function HelpIndexView({
  t,
  locale,
  library,
  query,
  results,
  onQuery,
  checklist,
}: HelpIndexViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const searching = query.trim() !== "";
  const count = searching ? t.plural("help.search.results", results.length) : null;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <PageHeading>{t("page.help.title")}</PageHeading>
        <p className="max-w-prose text-muted-foreground">{t("help.index.intro")}</p>
      </div>
      <form
        method="post"
        role="search"
        className="flex max-w-xl flex-col gap-2"
        onSubmit={(event) => event.preventDefault()}
      >
        <Field id="help-search" label={t("help.search.label")} hint={t("help.search.hint")}>
          {(control) => (
            <Input
              {...control}
              ref={inputRef}
              type="search"
              autoComplete="off"
              maxLength={200}
              value={query}
              onChange={(event) => onQuery(event.currentTarget.value)}
            />
          )}
        </Field>
      </form>
      <LiveRegion visuallyHidden>{count}</LiveRegion>
      {searching ? (
        <section aria-labelledby="help-results-title" className="flex flex-col gap-3">
          <h2 id="help-results-title" className="text-xl font-semibold text-foreground">
            {t("help.search.resultsTitle")}
          </h2>
          {results.length === 0 ? (
            <p className="text-muted-foreground">
              {t("help.search.none", { query: query.trim() })}
            </p>
          ) : (
            <>
              <p className="text-muted-foreground">{count}</p>
              <ul className="flex flex-col gap-3">
                {results.map((article) => (
                  <ArticleItem key={article.id} locale={locale} article={article} />
                ))}
              </ul>
            </>
          )}
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                onQuery("");
                // The results section goes away with the query: the focus returns to the box, not to the page body.
                inputRef.current?.focus();
              }}
            >
              {t("help.search.clear")}
            </Button>
          </div>
        </section>
      ) : null}
      {checklist}
      <section aria-labelledby="help-topics-title" className="flex flex-col gap-4">
        <h2 id="help-topics-title" className="text-xl font-semibold text-foreground">
          {t("help.topics.title")}
        </h2>
        {articlesByTopic(library).map(({ topic, articles }) => (
          <section
            key={topic.id}
            aria-labelledby={`help-topic-${topic.id}`}
            className="flex flex-col gap-2"
          >
            <h3 id={`help-topic-${topic.id}`} className="text-lg font-semibold text-foreground">
              {topic.title[locale]}
            </h3>
            <ul className="flex flex-col gap-3">
              {articles.map((article) => (
                <ArticleItem key={article.id} locale={locale} article={article} />
              ))}
            </ul>
          </section>
        ))}
      </section>
    </div>
  );
}
