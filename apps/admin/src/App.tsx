import { Button, Card, Container, createTranslator } from "@fluxkit/ui";
import { detectLocale, messagesByLocale } from "./messages";

export function App() {
  const locale = detectLocale(typeof navigator === "undefined" ? undefined : navigator.language);
  const t = createTranslator(messagesByLocale[locale]);
  document.title = t("admin.title");

  return (
    <Container className="py-8">
      <h1 className="text-2xl font-bold">{t("admin.title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("admin.welcome")}</p>
      <nav className="mt-6 flex gap-2">
        <Button variant="secondary">{t("admin.nav.products")}</Button>
        <Button variant="secondary">{t("admin.nav.orders")}</Button>
        <Button variant="secondary">{t("admin.nav.customers")}</Button>
      </nav>
      <Card className="mt-6">
        <Button>{t("admin.action.create")}</Button>
      </Card>
    </Container>
  );
}
