import { locales } from "@fluxkit/ui";
import { Link, useParams, useSearchParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { useResource } from "../../lib/use-resource";
import { PATHS } from "../../router/paths";
import { ResourceFallback } from "../../views/status-views";
import { EmailFrame, linkClass } from "./email-frame";
import { previewLocale } from "./email-view";
import { isTemplateKey } from "./message-list-query";
import { PreviewBody, PreviewLocaleSwitch, TemplatesView } from "./templates-view";

/** `/email/templates`: the registered templates. */
export function EmailTemplatesPage() {
  const { t } = useI18n();
  const resource = useResource((signal) => adminClient.listEmailTemplates({ signal }), []);
  return (
    <EmailFrame t={t} current="emailTemplates" title={t("page.emailTemplates.title")}>
      <p className="max-w-prose text-muted-foreground">{t("mail.templates.intro")}</p>
      <TemplatesView t={t} state={resource} onRetry={resource.reload} />
    </EmailFrame>
  );
}

function Preview({ templateKey, locale }: { templateKey: string; locale: string }) {
  const { t } = useI18n();
  const resource = useResource(
    (signal) => adminClient.previewEmailTemplate(templateKey, { locale, signal }),
    [templateKey, locale],
  );
  return (
    <EmailFrame
      t={t}
      current="emailTemplates"
      title={t("mail.preview.title", { key: templateKey })}
    >
      <p>
        <Link to={PATHS.emailTemplates} className={linkClass}>
          {t("mail.preview.back")}
        </Link>
      </p>
      <PreviewLocaleSwitch t={t} templateKey={templateKey} locales={locales} current={locale} />
      {resource.status === "ready" ? (
        <PreviewBody t={t} preview={resource.data} />
      ) : (
        <ResourceFallback t={t} state={resource} onRetry={resource.reload} />
      )}
    </EmailFrame>
  );
}

/** `/email/templates/:key?locale=`: the template rendered with its own sample data, in a sandboxed frame. */
export function EmailTemplatePreviewPage() {
  const { t, locale: uiLocale } = useI18n();
  const { key } = useParams();
  const [params] = useSearchParams();
  if (key === undefined) throw new Error("The template route has no key parameter.");
  if (!isTemplateKey(key)) {
    return (
      <EmailFrame t={t} current="emailTemplates" title={t("page.emailTemplatePreview.title")}>
        <ResourceFallback t={t} state={{ status: "notFound" }} onRetry={() => undefined} />
      </EmailFrame>
    );
  }
  const locale = previewLocale(params.get("locale"), uiLocale);
  return <Preview key={`${key}:${locale}`} templateKey={key} locale={locale} />;
}
