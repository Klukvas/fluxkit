import { Button, Card, Container, createTranslator, isLocale } from "@fluxkit/ui";
import { notFound } from "next/navigation";
import { messagesByLocale } from "../../messages";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const t = createTranslator(messagesByLocale[locale]);

  return (
    <main>
      <Container className="py-10">
        <h1 className="text-3xl font-bold">{t("home.heading")}</h1>
        <p className="mt-2 text-muted-foreground">{t("home.subheading")}</p>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((id) => (
            <Card key={id}>
              <h2 className="font-semibold">{t("home.product.placeholder")}</h2>
              <p className="mt-1 text-muted-foreground">{t("home.product.price")}</p>
              <Button className="mt-4">{t("home.cta")}</Button>
            </Card>
          ))}
        </div>
      </Container>
      <footer className="border-t border-border py-6 text-center text-muted-foreground">
        {t("footer.powered")}
      </footer>
    </main>
  );
}
