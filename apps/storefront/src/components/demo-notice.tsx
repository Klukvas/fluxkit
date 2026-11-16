import { Container, type Locale, type Translator } from "@fluxkit/ui";
import { demoNoticeUrls } from "../config/demo-notice";
import { focusRing } from "./styles";

/** Persistent, server-rendered notice on public demo deployments, including without JavaScript. */
export function DemoNotice({ locale, t }: { locale: Locale; t: Translator }) {
  return (
    <div className="border-b border-border bg-muted text-foreground">
      <Container className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-2 text-center text-sm">
        <p>{t("demo.strip")}</p>
        <a
          href={demoNoticeUrls[locale]}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex min-h-6 items-center font-semibold underline underline-offset-4 ${focusRing}`}
        >
          {t("demo.stripLink")}
        </a>
      </Container>
    </div>
  );
}
