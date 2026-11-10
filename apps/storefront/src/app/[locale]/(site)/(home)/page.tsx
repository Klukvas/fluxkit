import { createTranslator, isLocale } from "@fluxkit/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HomeSections } from "../../../../components/home-sections";
import { homeSections } from "../../../../config/home";
import { getHomeSection } from "../../../../lib/catalog-pages.server";
import { imageHosts } from "../../../../lib/image-hosts.server";
import { homeMetadata } from "../../../../lib/page-metadata";
import { publicOrigin } from "../../../../lib/public-url.server";
import { messagesByLocale } from "../../../../messages";

interface HomeProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: HomeProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(messagesByLocale[locale], locale);
  return homeMetadata({ origin: await publicOrigin(), locale, t });
}

/**
 * The sections of `config/home.ts`; each data section streams in on its own (`components/home-sections.tsx`). The sections
 * bring their own `Container` (one around all of them by default; one per section once a section is `width: "full"`).
 */
export default async function HomePage({ params }: HomeProps) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const t = createTranslator(messagesByLocale[locale], locale);
  return (
    <HomeSections
      sections={homeSections}
      context={{ locale, t, imageHosts: imageHosts() }}
      load={(section) => getHomeSection(locale, section)}
    />
  );
}
