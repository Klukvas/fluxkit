import type { AdminEmailPreview, AdminEmailTemplate } from "@fluxkit/api-client";
import {
  Alert,
  DataTable,
  DescriptionList,
  EmptyState,
  type DataTableColumn,
  type Translator,
} from "@fluxkit/ui";
import { Link } from "react-router";
import { ResourceFallback, type ResourceFallbackState } from "../../views/status-views";
import { linkClass } from "./email-frame";
import { categoryLabelKey, templateHref } from "./email-view";
import { SandboxedMailFrame } from "./preview-frame";

export type TemplateListState =
  | { status: "loading" }
  | { status: "ready"; data: { items: AdminEmailTemplate[] } }
  | Exclude<ResourceFallbackState, { status: "ready" | "loading" }>;

/** The registered templates: key (a link to its preview), version, category and the languages it has texts in. */
export function TemplatesView({
  t,
  state,
  onRetry,
}: {
  t: Translator;
  state: TemplateListState;
  onRetry: () => void;
}) {
  const columns: DataTableColumn<AdminEmailTemplate>[] = [
    {
      id: "key",
      header: t("mail.templates.columnKey"),
      cell: (row) => (
        <Link to={templateHref(row.key)} className={`${linkClass} break-all font-mono`}>
          {row.key}
        </Link>
      ),
    },
    {
      id: "version",
      header: t("mail.templates.columnVersion"),
      align: "end",
      cell: (row) => row.version,
    },
    {
      id: "category",
      header: t("mail.templates.columnCategory"),
      cell: (row) => t(categoryLabelKey(row.category)),
    },
    {
      id: "locales",
      header: t("mail.templates.columnLocales"),
      cell: (row) => (
        <span className="flex flex-wrap gap-x-3">
          {row.locales.map((locale) => (
            <Link key={locale} to={templateHref(row.key, locale)} className={linkClass}>
              {locale}
            </Link>
          ))}
        </span>
      ),
    },
  ];
  const caption = t("mail.templates.caption");
  if (state.status === "loading") {
    return (
      <DataTable
        caption={caption}
        captionHidden
        columns={columns}
        rows={[]}
        rowKey={(row) => row.key}
        emptyMessage={null}
        loading
        loadingLabel={t("status.loading")}
      />
    );
  }
  if (state.status !== "ready") return <ResourceFallback t={t} state={state} onRetry={onRetry} />;
  if (state.data.items.length === 0) {
    return (
      <EmptyState
        title={t("mail.templates.emptyTitle")}
        description={t("mail.templates.emptyBody")}
      />
    );
  }
  return (
    <DataTable
      caption={caption}
      captionHidden
      columns={columns}
      rows={state.data.items}
      rowKey={(row) => row.key}
      emptyMessage={null}
    />
  );
}

/** The locale switch of the preview: a link per language, the shown one marked with `aria-current`. */
export function PreviewLocaleSwitch({
  t,
  templateKey,
  locales,
  current,
}: {
  t: Translator;
  templateKey: string;
  locales: readonly string[];
  current: string;
}) {
  return (
    <nav aria-label={t("mail.preview.localeLabel")}>
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {locales.map((locale) => (
          <li key={locale}>
            <Link
              to={templateHref(templateKey, locale)}
              aria-current={locale === current ? "true" : undefined}
              className={
                locale === current
                  ? "font-semibold text-foreground underline underline-offset-4"
                  : "text-muted-foreground underline underline-offset-4"
              }
            >
              {t(`mail.locale.${locale}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The rendered sample mail: subject, the HTML in the sandboxed frame, and the plain-text part. */
export function PreviewBody({ t, preview }: { t: Translator; preview: AdminEmailPreview }) {
  const facts = [
    {
      id: "subject",
      term: t("mail.preview.subject"),
      description: <span className="break-words">{preview.subject}</span>,
    },
    {
      id: "version",
      term: t("mail.preview.version"),
      description: preview.version,
    },
    {
      id: "category",
      term: t("mail.preview.category"),
      description: t(categoryLabelKey(preview.category)),
    },
  ];
  return (
    <div className="flex flex-col gap-6">
      <Alert variant="info">{t("mail.preview.sampleNote")}</Alert>
      <DescriptionList items={facts} />
      <section aria-labelledby="email-preview-html" className="flex flex-col gap-2">
        <h2 id="email-preview-html" className="text-lg font-semibold text-foreground">
          {t("mail.preview.htmlTitle")}
        </h2>
        <SandboxedMailFrame title={t("mail.preview.frameTitle")} html={preview.html} />
      </section>
      <section aria-labelledby="email-preview-text" className="flex flex-col gap-2">
        <h2 id="email-preview-text" className="text-lg font-semibold text-foreground">
          {t("mail.preview.textTitle")}
        </h2>
        <pre className="max-w-3xl overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-4 text-foreground">
          {preview.text}
        </pre>
      </section>
    </div>
  );
}
