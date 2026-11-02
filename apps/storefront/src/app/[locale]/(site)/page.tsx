import { Container, createTranslator, isLocale } from "@fluxkit/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HomeSections } from "../../../components/home-sections";
import { homeSections } from "../../../config/home";
import { getHomeSection } from "../../../lib/catalog-pages.server";
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

/** The sections of `config/home.ts`; each data section streams in on its own (`components/home-sections.tsx`). */
export default async function HomePage({ params }: HomeProps) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const t = createTranslator(messagesByLocale[locale], locale);
  return (
    <Container>
      <HomeSections
        sections={homeSections}
        context={{ locale, t, imageHosts: imageHosts() }}
        load={(section) => getHomeSection(locale, section)}
      />
    </Container>
  );
}
