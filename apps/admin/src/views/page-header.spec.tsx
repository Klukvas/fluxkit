import { Button, createTranslator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import { renderInRouter, messagesForArea } from "../test-helpers";
import { PageHeader } from "./status-views";

describe("PageHeader", () => {
  for (const locale of ["uk", "en"] as const) {
    it(`renders a single translated heading and optional context/actions in ${locale}`, async () => {
      const t = createTranslator(await messagesForArea(locale, []), locale);
      const html = renderInRouter(
        <PageHeader
          title={t("page.home.title")}
          description={t("page.home.welcome")}
          actions={<Button>{t("action.reload")}</Button>}
        />,
      );
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html).toContain(`>${t("page.home.title")}</h1>`);
      expect(html).toContain(t("page.home.welcome"));
      expect(html).toContain(t("action.reload"));
      expect(html.indexOf("</h1>")).toBeLessThan(html.indexOf("<button"));
      expect(html).toContain('class="flex flex-wrap items-start justify-between gap-3"');
      expect(html).toContain('class="min-w-0 grow basis-64 space-y-2 wrap-break-word"');
      expect(html).toContain('class="flex flex-wrap items-center gap-2"');
    });
  }
  it("omits empty optional slots", () => {
    const html = renderInRouter(<PageHeader title="Title" description={null} actions={null} />);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toContain("max-w-prose");
    expect(html).not.toContain("items-center gap-2");
  });
});
