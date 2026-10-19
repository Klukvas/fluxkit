import { Button, Container, Skeleton, Spinner, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { linkButton } from "./styles";

/** Error state of a route. Shows the digest (a reference to the server log), never the error's own text. */
export function ErrorView({
  t,
  digest,
  homeHref,
  onRetry,
}: {
  t: Translator;
  digest: string | undefined;
  homeHref: string;
  onRetry: () => void;
}) {
  return (
    <Container className="flex flex-col items-start gap-3 py-12">
      <h1 className="text-2xl font-bold text-foreground">{t("error.title")}</h1>
      <p className="text-muted-foreground">{t("error.description")}</p>
      {digest === undefined ? null : (
        <p className="text-sm text-muted-foreground">{t("error.reference", { digest })}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-3">
        <Button onClick={onRetry}>{t("error.retry")}</Button>
        <Link href={homeHref} className={linkButton}>
          {t("error.home")}
        </Link>
      </div>
    </Container>
  );
}

export function NotFoundView({ t, homeHref }: { t: Translator; homeHref: string }) {
  return (
    <Container className="flex flex-col items-start gap-3 py-12">
      {/* A client-rendered not-found cannot export metadata, so it names itself: React hoists <title> into the head. */}
      <title>{t("seo.pageTitle", { title: t("notFound.title"), site: t("site.name") })}</title>
      <h1 className="text-2xl font-bold text-foreground">{t("notFound.title")}</h1>
      <p className="text-muted-foreground">{t("notFound.description")}</p>
      <Link href={homeHref} className={`${linkButton} mt-2`}>
        {t("notFound.home")}
      </Link>
    </Container>
  );
}

export function LoadingView({ t }: { t: Translator }) {
  return (
    <Container className="flex flex-col gap-4 py-12" aria-busy="true">
      <Spinner label={t("loading.page")} />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-24 w-full" />
    </Container>
  );
}
