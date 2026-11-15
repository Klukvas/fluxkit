import { createTranslator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import { messagesWith } from "../../messages";
import enHome from "../../messages/en/home.json";
import ukHome from "../../messages/uk/home.json";
import { renderInRouter } from "../../test-helpers";
import { HomeView } from "./home-page";
import { WorkspaceView } from "./workspace-view";

describe("home subtitle", () => {
  it("describes only accessible work in both languages, including an empty workspace", () => {
    for (const [locale, home, subtitle] of [
      ["en", enHome, "Your work area: counters, quick actions and setup steps you have access to."],
      [
        "uk",
        ukHome,
        "Ваш робочий простір: лічильники, швидкі дії та кроки налаштування, доступні вам.",
      ],
    ] as const) {
      const t = createTranslator(messagesWith(locale, { home }), locale);
      const html = renderInRouter(
        <HomeView t={t} workspace={<WorkspaceView t={t} counters={[]} actions={[]} />} />,
      );
      expect(html).toContain(`<div class="max-w-prose text-muted-foreground">${subtitle}</div>`);
      expect(t("page.home.welcome")).toBe(subtitle);
      expect(t("page.home.welcome")).not.toMatch(/orders|customers/i);
      expect(html).toContain(t("home.noAccess"));
      expect(html).toContain('href="/admin-ui/help"');
    }
  });
});
