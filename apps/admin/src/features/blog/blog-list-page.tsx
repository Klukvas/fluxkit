import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { useResource } from "../../lib/use-resource";
import { ConfigGate, useContentLocales } from "../../areas/catalog-dictionaries/config-gate";
import { primaryLinkClass } from "../../areas/catalog-dictionaries/dictionary-frame";
import { blogApi } from "./blog-api";
import { BlogFrame, BlogListView, BlogStateFilter } from "./blog-list-view";
import {
  BLOG_PATHS,
  blogListHref,
  pageOfOffset,
  readBlogListQuery,
  writeBlogListQuery,
  type BlogListQuery,
} from "./blog-paths";
import { useBlogPermissions } from "./blog-permissions";
import { BLOG_LIST_LIMIT } from "./blog-rules";

function BlogResults({ query, createLink }: { query: BlogListQuery; createLink: ReactNode }) {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const resource = useResource(
    (signal) =>
      blogApi.listBlogPosts({
        ...(query.status === undefined ? {} : { status: query.status }),
        page: query.page,
        limit: BLOG_LIST_LIMIT,
        signal,
      }),
    [writeBlogListQuery(query)],
  );
  return (
    <BlogListView
      t={t}
      uiLocale={locale}
      content={content}
      query={query}
      state={resource}
      onRetry={resource.reload}
      createLink={createLink}
      hrefForOffset={(offset) => blogListHref({ ...query, page: pageOfOffset(offset) })}
    />
  );
}

/** `/features/blog`: every post, the most recently updated first; the state filter and the page are in the URL. */
export function BlogListPage() {
  const { t } = useI18n();
  const { canWrite } = useBlogPermissions();
  const [params, setParams] = useSearchParams();
  const query = readBlogListQuery(params);
  const createLink = canWrite ? (
    <Link to={BLOG_PATHS.create} className={primaryLinkClass}>
      {t("features.blog.new")}
    </Link>
  ) : null;
  return (
    <BlogFrame title={t("features.blog.page.list.title")} actions={createLink}>
      <p className="max-w-prose text-muted-foreground">{t("features.blog.list.intro")}</p>
      <BlogStateFilter
        t={t}
        query={query}
        onChange={(status) =>
          setParams(writeBlogListQuery({ ...(status === undefined ? {} : { status }), page: 1 }))
        }
      />
      <ConfigGate>
        <BlogResults query={query} createLink={createLink} />
      </ConfigGate>
    </BlogFrame>
  );
}
