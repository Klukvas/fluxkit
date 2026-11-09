import { cn, type Locale, type Translator } from "@fluxkit/ui";
import { Link } from "react-router";
import { PATHS } from "../../router/paths";
import type { ScreenAccess } from "../../router/screen-access";
import { PageHeading } from "../../views/status-views";
import {
  helpArticlePath,
  sectionElementId,
  sectionsOf,
  type HelpArticle,
  type HelpBlock,
  type HelpTopic,
  type ScreenRouteId,
} from "./help-model";

/**
 * The article page as markup (props in, markup out). Every block of the closed set is rendered by React as text: there is
 * no HTML string anywhere (plan decision 1; `help-content.spec.ts` refuses markup in the texts).
 */

// Link text in the body color with an underline (`primary` is only checked as a non-text color).
export const helpLinkClass = "font-medium text-foreground underline underline-offset-4";

const calloutBase =
  "max-w-prose rounded-panel border border-s-4 border-border bg-muted p-4 text-foreground";
const calloutTone = { note: "border-primary", warning: "border-warning" } as const;

export interface BlockViewProps {
  t: Translator;
  locale: Locale;
  block: HelpBlock;
  access: ScreenAccess;
}

/** The link to a screen, named by its page title; a role that may not open the screen gets a line instead. */
export function ScreenLink({
  t,
  route,
  access,
}: {
  t: Translator;
  route: ScreenRouteId;
  access: ScreenAccess;
}) {
  const screen = t(access.titleKey(route));
  if (!access.canOpen(route)) {
    return <p className="text-muted-foreground">{t("help.screen.notAllowed", { screen })}</p>;
  }
  return (
    <p>
      <Link to={PATHS[route]} className={helpLinkClass}>
        {t("help.screen.open", { screen })}
      </Link>
    </p>
  );
}

export function BlockView({ t, locale, block, access }: BlockViewProps) {
  switch (block.kind) {
    case "heading":
      return (
        <h2
          id={sectionElementId(block.id)}
          tabIndex={-1}
          className="scroll-mt-4 pt-2 text-xl font-semibold text-foreground"
        >
          {block.text[locale]}
        </h2>
      );
    case "paragraph":
      return <p className="max-w-prose text-foreground">{block.text[locale]}</p>;
    case "steps":
      return (
        <ol className="flex max-w-prose list-decimal flex-col gap-2 ps-6 text-foreground">
          {block.items.map((item, index) => (
            <li key={index}>{item[locale]}</li>
          ))}
        </ol>
      );
    case "note":
    case "warning":
      return (
        <div className={cn(calloutBase, calloutTone[block.kind])}>
          <p>
            <strong>{t(block.kind === "note" ? "help.block.note" : "help.block.warning")}</strong>{" "}
            {block.text[locale]}
          </p>
        </div>
      );
    case "screen":
      return <ScreenLink t={t} route={block.route} access={access} />;
    case "definitions":
      return (
        <dl className="flex max-w-prose flex-col gap-3">
          {block.items.map((item, index) => (
            <div key={index}>
              <dt className="font-semibold text-foreground">{item.term[locale]}</dt>
              <dd className="text-muted-foreground">{item.definition[locale]}</dd>
            </div>
          ))}
        </dl>
      );
  }
}

export interface ArticleViewProps {
  t: Translator;
  locale: Locale;
  article: HelpArticle;
  topic: HelpTopic | null;
  previous: HelpArticle | null;
  next: HelpArticle | null;
  access: ScreenAccess;
}

export function ArticleView({
  t,
  locale,
  article,
  topic,
  previous,
  next,
  access,
}: ArticleViewProps) {
  const sections = sectionsOf(article);
  return (
    <article className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <Link to={PATHS.help} className={helpLinkClass}>
            {t("help.article.allArticles")}
          </Link>
          {topic === null ? null : (
            <span>{t("help.article.topic", { topic: topic.title[locale] })}</span>
          )}
        </p>
        <PageHeading>{article.title[locale]}</PageHeading>
        <p className="max-w-prose text-muted-foreground">{article.summary[locale]}</p>
      </div>
      {sections.length < 2 ? null : (
        <nav aria-labelledby="help-contents-title" className="flex flex-col gap-2">
          <h2 id="help-contents-title" className="text-lg font-semibold text-foreground">
            {t("help.article.contents")}
          </h2>
          <ul className="flex flex-col gap-1 ps-1">
            {sections.map((section) => (
              <li key={section.id}>
                <Link to={{ hash: section.id }} className={helpLinkClass}>
                  {section.title[locale]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {article.blocks.map((block, index) => (
        <BlockView key={index} t={t} locale={locale} block={block} access={access} />
      ))}
      {previous === null && next === null ? null : (
        <nav
          aria-label={t("help.article.pagination")}
          className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-between"
        >
          {previous === null ? (
            <span />
          ) : (
            <Link to={helpArticlePath(previous.id)} className={helpLinkClass}>
              {t("help.article.previous", { title: previous.title[locale] })}
            </Link>
          )}
          {next === null ? null : (
            <Link to={helpArticlePath(next.id)} className={helpLinkClass}>
              {t("help.article.next", { title: next.title[locale] })}
            </Link>
          )}
        </nav>
      )}
    </article>
  );
}
