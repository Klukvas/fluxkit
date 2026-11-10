import { createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesByLocale } from "../messages";
import { leftoverText, sentinelTranslator } from "./test-helpers";
import { ViewToggle } from "./view-toggle";

const t = sentinelTranslator();
const hrefFor = (view: "grid" | "list") =>
  view === "grid" ? "/uk/catalog" : "/uk/catalog?view=list";

describe("ViewToggle (?view=grid|list)", () => {
  it("is a labelled group of two plain links (works without scripts), the current one marked aria-current", () => {
    const html = renderToStaticMarkup(<ViewToggle t={t} view="list" hrefFor={hrefFor} />);
    expect(html).toMatch(/^<div role="group" aria-label="§catalog\.view\.label"/);
    const links = [...html.matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)].map((match) => ({
      attributes: match[1] ?? "",
      text: match[2],
    }));
    expect(links.map((link) => link.text)).toEqual(["§catalog.view.grid", "§catalog.view.list"]);
    expect(links[0]?.attributes).toContain('href="/uk/catalog"');
    expect(links[0]?.attributes).not.toContain("aria-current");
    expect(links[1]?.attributes).toContain('href="/uk/catalog?view=list"');
    expect(links[1]?.attributes).toContain('aria-current="true"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("aria-pressed");
    expect(leftoverText(html)).toBe("");
  });

  it("marks the grid current by default", () => {
    const html = renderToStaticMarkup(<ViewToggle t={t} view="grid" hrefFor={hrefFor} />);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toMatch(/<a [^>]*aria-current="true"[^>]*>§catalog\.view\.grid</);
  });

  it("has its labels in both locales", () => {
    for (const locale of ["uk", "en"] as const) {
      const html = renderToStaticMarkup(
        <ViewToggle
          t={createTranslator(messagesByLocale[locale], locale)}
          view="grid"
          hrefFor={hrefFor}
        />,
      );
      expect(html).not.toContain("catalog.view");
    }
  });

  it("stays small in the first HTML (two links, no icons, no script)", () => {
    const html = renderToStaticMarkup(
      <ViewToggle t={createTranslator(messagesByLocale.uk, "uk")} view="grid" hrefFor={hrefFor} />,
    );
    expect(new TextEncoder().encode(html).length).toBeLessThan(900);
    expect(html).not.toContain("<svg");
  });
});
