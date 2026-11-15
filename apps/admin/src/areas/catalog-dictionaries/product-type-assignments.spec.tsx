import { createTranslator } from "@fluxkit/ui";
import messages from "../../messages/en/catalog-dictionaries.json";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { OptionAssignmentsSection } from "./product-type-assignments";

function render(splitsListing: boolean, canWrite: boolean): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <OptionAssignmentsSection
        t={createTranslator(messages, "en")}
        content={{ defaultLocale: "uk", locales: ["uk", "en"] }}
        uiLocale="en"
        productTypeId="t1"
        canWrite={canWrite}
        rows={[
          {
            productTypeId: "t1",
            optionId: "o1",
            optionCode: "color",
            position: 0,
            splitsListing,
            createdAt: "2026-01-01T00:00:00Z",
          },
        ]}
        onChanged={() => undefined}
      />
    </MemoryRouter>,
  );
}

describe("split option assignment table", () => {
  it("shows the saved split indicator to readers without any write control", () => {
    const html = render(true, false);
    expect(html).toContain("Separate listing cards per value");
    expect(html).toContain(">Yes</span>");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("<button");
    expect(render(false, false)).toContain(">No</span>");
  });

  it("keeps assignment editing available for writers with either saved flag", () => {
    for (const flag of [false, true]) {
      expect(render(flag, true)).toContain("Change the assignment of the option “color”");
    }
  });
});
