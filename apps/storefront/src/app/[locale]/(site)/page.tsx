import { Container, createTranslator, isLocale } from "@fluxkit/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HomeSections } from "../../../components/home-sections";
import { homeSections } from "../../../layout/home";
import { getHomeData } from "../../../lib/catalog-pages.server";
import { imageHosts } from "../../../lib/image-hosts.server";
import { homeMetadata } from "../../../lib/page-metadata";
import { publicOrigin } from "../../../lib/public-url.server";
import { messagesByLocale } from "../../../messages";

interface HomeProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: HomeProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return homeMetadata({ origin: await publicOrigin(), locale });
}

export default async function HomePage({ params }: HomeProps) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const t = createTranslator(messagesByLocale[locale], locale);
  const data = await getHomeData(locale);
  return (
    <Container>
      <HomeSections
        sections={homeSections}
        locale={locale}
        t={t}
        data={data}
        imageHosts={imageHosts()}
      />
    </Container>
  );
}
