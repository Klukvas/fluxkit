import { createTranslator, locales } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesForArea, sentinelTranslator } from "../../test-helpers";
import { MESSAGE_FILES } from "./index";
import { EmailRouteForm } from "./email-route-form";

const noop = () => undefined;

describe("the email route form", () => {
  it("offers an even share and Resend first, and names neither as the account balance", () => {
    const html = renderToStaticMarkup(
      <EmailRouteForm
        t={sentinelTranslator()}
        mode="equal"
        revision={1}
        holder="markup"
        busy={false}
        onDone={noop}
      />,
    );
    expect(html).toContain("§intg.route.equal");
    expect(html).toContain("§intg.route.equalBody");
    expect(html).toContain("§intg.route.resend");
    expect(html).toContain("§intg.route.resendBody");
    expect(html).toContain('value="equal"');
    expect(html).toContain("checked");
    expect(html).not.toMatch(/balance|quota|квот/i);
  });

  it("renders the real messages of each language", async () => {
    for (const locale of locales) {
      const t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
      const html = renderToStaticMarkup(
        <EmailRouteForm
          t={t}
          mode="resend"
          revision={1}
          holder="markup"
          busy={false}
          onDone={noop}
        />,
      );
      expect(html).not.toContain("intg.");
      expect(html).toContain("Resend");
      expect(html).toContain("Brevo");
    }
  });
});
