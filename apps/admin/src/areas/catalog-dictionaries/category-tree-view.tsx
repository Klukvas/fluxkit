import { Alert, Button, StatusBadge, type Translator } from "@fluxkit/ui";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { PATHS, buildPath } from "../../router/paths";
import type { TreeItem } from "./category-tree";
import { linkClass } from "./dictionary-frame";
import type { ContentLocales } from "./form-parts";
import { resolveLocalized } from "./locale-text";

export interface CategoryTreeViewProps {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  items: readonly TreeItem[];
  /** Without it there is no "add subcategory" link. */
  canWrite: boolean;
  onToggle: (id: string) => void;
  onLoadMore: (id: string) => void;
  onRetryChildren: (id: string) => void;
  /** Distinguishes the groups of two trees in one page (ids must be unique). */
  idPrefix?: string;
  /**
   * `browse` (default): each name links to its editor, with "add subcategory" for writers. `pick`: names are text and
   * `renderActions` adds the controls of each row (the product editor chooses categories with it).
   */
  mode?: "browse" | "pick";
  renderActions?: (item: TreeItem, name: string) => ReactNode;
  /** The accessible name of the tree (default: the category tree). */
  label?: string;
}

function TreeNodes({
  t,
  uiLocale,
  content,
  items,
  canWrite,
  onToggle,
  onLoadMore,
  onRetryChildren,
  idPrefix = "category-tree",
  mode = "browse",
  renderActions,
}: CategoryTreeViewProps) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const name =
          resolveLocalized(item.category.name, uiLocale, content.defaultLocale) ||
          item.category.slug;
        const groupId = `${idPrefix}-${item.category.id}`;
        return (
          <li key={item.category.id}>
            <div className="flex flex-wrap items-center gap-2 py-1">
              {item.canExpand ? (
                <Button
                  variant="secondary"
                  className="min-h-11 min-w-11 px-2"
                  aria-expanded={item.expanded}
                  aria-controls={item.expanded ? groupId : undefined}
                  aria-label={t("dict.category.subcategoriesOf", { name })}
                  onClick={() => onToggle(item.category.id)}
                >
                  <span aria-hidden="true">{item.expanded ? "−" : "+"}</span>
                </Button>
              ) : (
                <span className="inline-block min-w-11" aria-hidden="true" />
              )}
              {mode === "browse" ? (
                <Link
                  to={buildPath(PATHS.categoryDetail, { id: item.category.id })}
                  className={linkClass}
                >
                  {name}
                </Link>
              ) : (
                <span className="font-medium text-foreground">{name}</span>
              )}
              <span className="text-sm text-muted-foreground">{item.category.slug}</span>
              {item.category.isActive ? null : (
                <StatusBadge tone="warning" label={t("dict.category.inactive")} />
              )}
              {mode === "browse" && canWrite && item.canExpand ? (
                <Link
                  to={`${PATHS.categoryNew}?parentId=${encodeURIComponent(item.category.id)}`}
                  className="text-sm text-muted-foreground underline underline-offset-4"
                  aria-label={t("dict.category.addChildLabel", { name })}
                >
                  {t("dict.category.addChild")}
                </Link>
              ) : null}
              {renderActions?.(item, name)}
            </div>
            {item.expanded ? (
              <div id={groupId} className="ms-6 border-s border-border ps-3">
                {item.childStatus === "loading" ? (
                  <p role="status" className="py-1 text-muted-foreground">
                    {t("status.loading")}
                  </p>
                ) : item.childStatus === "error" ? (
                  <div className="flex flex-wrap items-center gap-3 py-1">
                    <p className="text-danger">{t("dict.category.childrenFailed")}</p>
                    <Button variant="secondary" onClick={() => onRetryChildren(item.category.id)}>
                      {t("action.retry")}
                    </Button>
                  </div>
                ) : item.children.length === 0 ? (
                  <p className="py-1 text-muted-foreground">{t("dict.category.noChildren")}</p>
                ) : (
                  <TreeNodes
                    t={t}
                    uiLocale={uiLocale}
                    content={content}
                    items={item.children}
                    canWrite={canWrite}
                    onToggle={onToggle}
                    onLoadMore={onLoadMore}
                    onRetryChildren={onRetryChildren}
                    idPrefix={idPrefix}
                    mode={mode}
                    renderActions={renderActions}
                  />
                )}
                {item.hasMore ? (
                  <div className="py-1">
                    <Button variant="secondary" onClick={() => onLoadMore(item.category.id)}>
                      {t("dict.category.loadMoreChildren", { name })}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The category tree as a nested list with an expand button per category (`aria-expanded`, labelled with the category's
 * name, reachable with Tab and operated with Enter or Space). Subcategories are loaded when a category is expanded; a
 * category at the maximum depth has no button. The links open the editor, "add subcategory" the create form with its parent.
 */
export function CategoryTreeView(props: CategoryTreeViewProps) {
  const { t, items, label } = props;
  return (
    <nav aria-label={label ?? t("dict.category.treeLabel")}>
      <TreeNodes {...props} items={items} />
    </nav>
  );
}

export function TruncatedNotice({ t, scanned }: { t: Translator; scanned: number }) {
  return (
    <Alert variant="warning" title={t("dict.category.truncatedTitle")}>
      <p>{t("dict.category.truncatedBody", { count: scanned })}</p>
    </Alert>
  );
}
