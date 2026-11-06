import { locales } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import { CONTEXT_HELP, PRODUCT_TAB_HELP, contextHelpFor } from "../../layout/context-help";
import { PATHS } from "../../router/paths";
import { ROUTES } from "../../routes";
import type { EditorTabId } from "../products/publish-problems";
import { CHECKLIST_STEPS } from "./checklist-model";
import { HELP_LIBRARY } from "./content";
import { blockTexts, sectionsOf, type HelpArticle, type HelpText } from "./help-model";

/**
 * The knowledge base content as data (plan decision 1, task item 5): complete in every UI language, no empty block, unique
 * ids, real link targets, no markup. A client fork that edits `content/` runs these unchanged.
 */

const library = HELP_LIBRARY;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Every text of an article with where it is, for messages that name the place. */
function textsOf(article: HelpArticle): { where: string; text: HelpText }[] {
  return [
    { where: "title", text: article.title },
    { where: "summary", text: article.summary },
    ...article.blocks.flatMap((block, index) =>
      blockTexts(block).map((text) => ({ where: `blocks.${String(index)} (${block.kind})`, text })),
    ),
  ];
}

describe("help content", () => {
  it("has topics and articles, every article in a known topic, grouped in topic order", () => {
    expect(library.topics.length).toBeGreaterThanOrEqual(3);
    expect(library.articles.length).toBeGreaterThanOrEqual(15);
    const topicIds = library.topics.map((topic) => topic.id);
    expect(new Set(topicIds).size).toBe(topicIds.length);
    const order = library.articles.map((article) => topicIds.indexOf(article.topic));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const topic of library.topics) {
      expect(
        library.articles.some((article) => article.topic === topic.id),
        topic.id,
      ).toBe(true);
    }
  });

  it("gives every article a unique address-safe id and unique section anchors", () => {
    const ids = library.articles.map((article) => article.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const article of library.articles) {
      expect(article.id, article.id).toMatch(SLUG);
      const sections = sectionsOf(article).map((section) => section.id);
      expect(new Set(sections).size, `${article.id} repeats a section id`).toBe(sections.length);
      for (const section of sections) expect(section, `${article.id}#${section}`).toMatch(SLUG);
    }
  });

  it("has every text in every UI language, none empty or only spaces", () => {
    for (const article of library.articles) {
      for (const { where, text } of textsOf(article)) {
        expect(Object.keys(text).sort(), `${article.id} ${where}`).toEqual([...locales].sort());
        for (const locale of locales) {
          expect(text[locale].trim(), `${article.id} ${where} ${locale}`).not.toBe("");
        }
      }
      for (const locale of locales) {
        expect(article.keywords[locale].length, `${article.id} keywords ${locale}`).toBeGreaterThan(
          0,
        );
        for (const keyword of article.keywords[locale]) expect(keyword.trim()).not.toBe("");
      }
    }
    for (const topic of library.topics) {
      for (const locale of locales) expect(topic.title[locale].trim(), topic.id).not.toBe("");
    }
  });

  it("has no empty block: steps and definitions have items, an article has a body", () => {
    for (const article of library.articles) {
      expect(article.blocks.length, article.id).toBeGreaterThan(1);
      article.blocks.forEach((block, index) => {
        if (block.kind === "steps")
          expect(block.items.length, `${article.id} ${index}`).toBeGreaterThan(0);
        if (block.kind === "definitions") {
          expect(block.items.length, `${article.id} ${index}`).toBeGreaterThan(0);
        }
      });
    }
  });

  it("writes Ukrainian in Cyrillic and English in Latin letters (a text pasted into the wrong language is caught)", () => {
    for (const article of library.articles) {
      for (const { where, text } of textsOf(article)) {
        expect(text.uk, `${article.id} ${where} uk`).toMatch(/\p{Script=Cyrillic}/u);
        expect(text.en, `${article.id} ${where} en`).not.toMatch(/\p{Script=Cyrillic}/u);
      }
    }
  });

  it("contains no markup: no HTML tag, entity or markdown link (the texts are rendered as text only)", () => {
    const markup = /<\/?[a-z][^>]*>|&[a-z#0-9]+;|\]\(|javascript:/i;
    for (const article of library.articles) {
      for (const { where, text } of textsOf(article)) {
        for (const locale of locales) {
          expect(
            markup.test(text[locale]),
            `${article.id} ${where} ${locale}: ${text[locale]}`,
          ).toBe(false);
        }
      }
    }
  });

  it("links only screens that exist in the route table, have no path parameter and are not the sign-in page", () => {
    const routeIds = new Set(ROUTES.map((route) => route.id));
    let links = 0;
    for (const article of library.articles) {
      for (const block of article.blocks) {
        if (block.kind !== "screen") continue;
        links += 1;
        expect(routeIds.has(block.route), `${article.id} -> ${block.route}`).toBe(true);
        expect(PATHS[block.route], block.route).not.toContain(":");
        expect(block.route).not.toBe("login");
      }
    }
    expect(links).toBeGreaterThanOrEqual(15);
  });
});

/** Article and section of a link target exist. */
function expectTarget(label: string, target: { article: string; section?: string }) {
  const article = library.articles.find((entry) => entry.id === target.article);
  expect(article, `${label}: article ${target.article}`).toBeDefined();
  if (target.section !== undefined && article !== undefined) {
    expect(
      sectionsOf(article).map((section) => section.id),
      `${label}: ${target.article}#${target.section}`,
    ).toContain(target.section);
  }
}

describe("the order card's help (UX round 2)", () => {
  it("opens the section on a customer who says they paid, which names the field and the review screen", () => {
    const target = contextHelpFor("orderDetail", null);
    expect(target).toEqual({ article: "orders", section: "customer-says-paid" });
    const article = library.articles.find((entry) => entry.id === "orders");
    expect(article && sectionsOf(article).map((section) => section.id)).toContain(
      "customer-says-paid",
    );
    const words = article
      ? textsOf(article)
          .map((entry) => entry.text.uk)
          .join(" ")
      : "";
    expect(words).toContain("Номер переказу або квитанції");
    expect(words).toContain("Платежі на перевірку");
  });
});

describe("links into the help", () => {
  it("points every contextual help entry at an existing article and section", () => {
    const routeIds = new Set(ROUTES.map((route) => route.id));
    for (const [routeId, target] of Object.entries(CONTEXT_HELP)) {
      expect(routeIds.has(routeId as never), routeId).toBe(true);
      expectTarget(routeId, target);
    }
    for (const [tab, target] of Object.entries(PRODUCT_TAB_HELP))
      expectTarget(`tab ${tab}`, target);
  });

  it("covers every screen of the app except sign-in and the help itself, and every product editor tab", () => {
    const uncovered = ROUTES.map((route) => route.id).filter(
      (id) => !(id in CONTEXT_HELP) && !["login", "help", "helpArticle"].includes(id),
    );
    expect(uncovered).toEqual([]);
    const tabs: Record<EditorTabId, true> = {
      general: true,
      attributes: true,
      categories: true,
      media: true,
      options: true,
      variants: true,
      prices: true,
      stock: true,
    };
    expect(Object.keys(PRODUCT_TAB_HELP).sort()).toEqual(Object.keys(tabs).sort());
  });

  it("finds the tab's article on the product editor, the route's otherwise, and nothing for unknown keys", () => {
    expect(contextHelpFor("productDetail", "prices")).toEqual({ article: "prices" });
    expect(contextHelpFor("productDetail", null)).toEqual({ article: "create-product" });
    expect(contextHelpFor("productDetail", "constructor")).toEqual({ article: "create-product" });
    expect(contextHelpFor("orders", "prices")).toEqual({ article: "orders" });
    expect(contextHelpFor("help", null)).toBeNull();
    expect(contextHelpFor("toString", null)).toBeNull();
  });

  it("points every checklist step at an existing article and section and a real screen", () => {
    const routeIds = new Set(ROUTES.map((route) => route.id));
    for (const step of CHECKLIST_STEPS) {
      expectTarget(step.id, step);
      expect(routeIds.has(step.screen), step.id).toBe(true);
    }
  });
});
