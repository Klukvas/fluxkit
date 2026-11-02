import { createTranslator, type Locale, type Translator } from "@fluxkit/ui";
import { beforeAll, describe, expect, it } from "vitest";
import { ContextHelpLink } from "../../layout/shell";
import { routeById } from "../../routes";
import {
  leftoverText,
  messagesForArea,
  renderInRouter,
  sentinelTranslator,
  textAttributes,
} from "../../test-helpers";
import { ArticleView } from "./article-view";
import { NO_PREFERENCES, type ChecklistFacts } from "./checklist-model";
import { ChecklistView, type ChecklistFactsState } from "./checklist-view";
import { HELP_LIBRARY } from "./content";
import { HelpIndexView } from "./help-index-view";
import { findArticle, helpArticlePath, neighbours, type ScreenRouteId } from "./help-model";
import { MESSAGE_FILES } from "./index";

const sentinel = sentinelTranslator();
const noop = () => undefined;
const all = () => true;

const real: Partial<Record<Locale, Translator>> = {};
beforeAll(async () => {
  for (const locale of ["uk", "en"] as const) {
    real[locale] = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
  }
});

const DONE: ChecklistFacts = {
  productTypes: "done",
  categories: "done",
  firstProduct: "todo",
  prices: "todo",
  stock: "noAccess",
  shipping: "failed",
  payments: "done",
  email: "testOnly",
};

function checklist(
  t: Translator,
  facts: ChecklistFactsState,
  place: "home" | "help" = "home",
  preferences = NO_PREFERENCES,
  canOpen: (route: ScreenRouteId) => boolean = all,
) {
  return renderInRouter(
    <ChecklistView
      t={t}
      place={place}
      facts={facts}
      preferences={preferences}
      storageFailed={place === "help"}
      canOpen={canOpen}
      onRetry={noop}
      onToggleManual={noop}
      onToggleShownOnHome={noop}
    />,
  );
}

function article(id: string, t: Translator = sentinel, locale: Locale = "en", canOpen = all) {
  const found = findArticle(HELP_LIBRARY, id);
  if (found === null) throw new Error(`no article ${id}`);
  const { previous, next } = neighbours(HELP_LIBRARY, id);
  return renderInRouter(
    <ArticleView
      t={t}
      locale={locale}
      article={found}
      topic={HELP_LIBRARY.topics.find((topic) => topic.id === found.topic) ?? null}
      previous={previous}
      next={next}
      access={{ canOpen, titleKey: (route) => routeById(route).titleKey }}
    />,
    helpArticlePath(id),
  );
}

describe("the checklist card", () => {
  it("has no hardcoded word: every state, both places, with the sentinel translator", () => {
    const states: ChecklistFactsState[] = [
      { status: "loading" },
      { status: "ready", data: DONE },
      { status: "error", failure: { kind: "network" } },
    ];
    for (const facts of states) {
      for (const place of ["home", "help"] as const) {
        const html = checklist(sentinel, facts, place, { dismissed: true, manualDone: [] });
        expect(leftoverText(html), `${facts.status} ${place}`).toBe("");
        for (const text of textAttributes(html)) expect(leftoverText(text)).toBe("");
      }
    }
  });

  it("shows every step with its state as text, the progress, and the links to the article and the screen", () => {
    const html = checklist(sentinel, { status: "ready", data: DONE });
    expect(html).toContain("§help.checklist.progress");
    expect(html.match(/<li /g)).toHaveLength(9);
    for (const state of ["done", "todo", "noAccess", "failed", "testOnly"]) {
      expect(html).toContain(`§help.checklist.status.${state}`);
    }
    expect(html).toContain('href="/admin-ui/help/product-types#product-types"');
    expect(html).toContain('href="/admin-ui/catalog/product-types"');
    expect(html).toContain('href="/admin-ui/help/first-steps#legal"');
    // The legal step is a checkbox with its own label; the start page offers "hide".
    expect(html).toMatch(/<input[^>]*id="checklist-home-legal"[^>]*type="checkbox"/);
    expect(html).toContain("§help.checklist.dismiss");
    expect(html).not.toContain("§help.checklist.restore");
  });

  it("offers no screen link the role may not open, and shows no state before the facts are read", () => {
    const html = checklist(sentinel, { status: "loading" }, "home", NO_PREFERENCES, () => false);
    expect(html).not.toContain('href="/admin-ui/catalog/product-types"');
    expect(html).toContain('href="/admin-ui/help/product-types#product-types"');
    expect(html).not.toContain("§help.checklist.status.done");
    expect(html).not.toContain("§help.checklist.progress");
  });

  it("offers 'show on the start page again' under Help once hidden, and says when storage failed", () => {
    const html = checklist(sentinel, { status: "ready", data: DONE }, "help", {
      dismissed: true,
      manualDone: ["legal"],
    });
    expect(html).toContain("§help.checklist.restore");
    expect(html).toContain("§help.checklist.hiddenOnHome");
    expect(html).toContain("§help.checklist.storageFailed");
    expect(html).toMatch(/<input[^>]*id="checklist-help-legal"[^>]*checked=""/);
  });

  it("renders with the real uk and en messages in every state (every key built from data exists)", () => {
    const facts: ChecklistFacts[] = [
      DONE,
      {
        ...DONE,
        firstProduct: "done",
        prices: "done",
        stock: "done",
        shipping: "done",
        email: "done",
      },
    ];
    for (const locale of ["uk", "en"] as const) {
      const t = real[locale] as Translator;
      for (const data of facts) {
        for (const place of ["home", "help"] as const) {
          const html = checklist(t, { status: "ready", data }, place);
          expect(html).not.toContain("help.checklist.");
        }
      }
    }
  });
});

describe("the article page", () => {
  it("renders every article with one h1, its sections as focusable h2 with anchors, and no raw HTML from data", () => {
    for (const entry of HELP_LIBRARY.articles) {
      const html = article(entry.id);
      expect(html.match(/<h1\b/g), entry.id).toHaveLength(1);
      expect(html).toContain("<article");
      expect(html).not.toMatch(/<script|javascript:/i);
      for (const block of entry.blocks) {
        if (block.kind === "heading") {
          expect(html, `${entry.id}#${block.id}`).toContain(
            `id="help-section-${block.id}" tabindex="-1"`,
          );
        }
      }
    }
  });

  it("links the contents to the anchors, the screens by their title, and the previous and next articles", () => {
    const html = article("prices", real.en as Translator);
    expect(html).toContain('href="/admin-ui/help/prices#compare-at"');
    expect(html).toContain('href="/admin-ui/products"');
    expect(html).toContain("Open this screen: Products");
    expect(html).toContain('href="/admin-ui/help/search"');
    expect(html).toContain('href="/admin-ui/help/stock"');
    expect(html).toContain("Compare-at price");
  });

  it("names a screen the role may not open instead of linking it", () => {
    const html = article("audit-log", real.uk as Translator, "uk", () => false);
    expect(html).not.toContain('href="/admin-ui/audit"');
    expect(html).toContain("ваша роль не може його відкрити");
    expect(html).toContain("Журнал дій");
  });

  it("shows the Ukrainian text in uk and the English text in en", () => {
    expect(article("stock", real.uk as Translator, "uk")).toContain("Резерви");
    expect(article("stock", real.en as Translator, "en")).toContain("Reservations");
  });
});

describe("the help index", () => {
  it("lists every topic and article and has a labelled search box in a search landmark", () => {
    const html = renderInRouter(
      <HelpIndexView
        t={sentinel}
        locale="en"
        library={HELP_LIBRARY}
        query=""
        results={[]}
        onQuery={noop}
        checklist={null}
      />,
      "/help",
    );
    const form = html.match(/<form\b[^>]*>/)?.[0] ?? "";
    expect(form).toContain('role="search"');
    expect(form).toContain('method="post"');
    expect(html).toMatch(/<label for="help-search"/);
    expect(html).toContain('role="status"');
    for (const entry of HELP_LIBRARY.articles) {
      expect(html).toContain(`href="/admin-ui/help/${entry.id}"`);
    }
    expect(html.match(/<h3\b/g)).toHaveLength(HELP_LIBRARY.topics.length);
    expect(html).not.toContain("§help.search.resultsTitle");
  });

  it("shows the results and their count, or the no-match text, while searching", () => {
    const found = HELP_LIBRARY.articles.slice(0, 2);
    const html = renderInRouter(
      <HelpIndexView
        t={real.en as Translator}
        locale="en"
        library={HELP_LIBRARY}
        query="price"
        results={found}
        onQuery={noop}
        checklist={null}
      />,
      "/help",
    );
    expect(html).toContain("Search results");
    expect(html).toContain("2 articles found.");
    const none = renderInRouter(
      <HelpIndexView
        t={real.uk as Translator}
        locale="uk"
        library={HELP_LIBRARY}
        query="ракета"
        results={[]}
        onQuery={noop}
        checklist={null}
      />,
      "/help",
    );
    expect(none).toContain("Немає статей для «ракета»");
  });
});

describe("the contextual help link of the shell", () => {
  it("links the article and section with a visible label", () => {
    const html = renderInRouter(
      <ContextHelpLink t={real.en as Translator} href={helpArticlePath("prices", "compare-at")} />,
    );
    expect(html).toContain('href="/admin-ui/help/prices#compare-at"');
    expect(html).toContain("Help for this page");
    expect(html).toContain('aria-hidden="true"');
  });
});
