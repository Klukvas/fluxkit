import { createTranslator, isLocale } from "@fluxkit/ui";
import { notFound } from "next/navigation";
import { HomeSections } from "../../../components/home-sections";
import { Container } from "@fluxkit/ui";
import { homeSections } from "../../../layout/home";
import { messagesByLocale } from "../../../messages";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const t = createTranslator(messagesByLocale[locale], locale);
  return (
    <Container>
      <HomeSections sections={homeSections} locale={locale} t={t} />
    </Container>
  );
}
