import type { Locale } from "@fluxkit/ui";
import type { PATHS, RouteId } from "../../router/paths";

/**
 * The knowledge base as typed data (plan `docs/plans/2026-11-02-admin-knowledge-base.md`, decision 1). The articles live in
 * `content/` (one file per topic) so that a client fork replaces that folder and nothing else; this file holds only the
 * shapes and the lookups the screens use. Every text is a map of ALL UI languages, so a missing translation is a type
 * error. Blocks are a closed set rendered by React (`article-view.tsx`): there is no markup language and no raw HTML.
 */

/** One text in every UI language. */
export type HelpText = Readonly<Record<Locale, string>>;

/** A route the help may link to: one without path parameters (an article cannot know an id) and not the sign-in page. */
export type ScreenRouteId = Exclude<
  { [Id in RouteId]: (typeof PATHS)[Id] extends `${string}:${string}` ? never : Id }[RouteId],
  "login"
>;

export type HelpBlock =
  /** Starts a section; `id` is its anchor (`/help/<article>#<id>`), lower-case words joined by `-`. */
  | { kind: "heading"; id: string; text: HelpText }
  | { kind: "paragraph"; text: HelpText }
  /** Numbered steps, in order. */
  | { kind: "steps"; items: readonly HelpText[] }
  /** A tip or a fact worth knowing. */
  | { kind: "note"; text: HelpText }
  /** Something that cannot be undone, costs money or depends on a setting the admin cannot see. */
  | { kind: "warning"; text: HelpText }
  /** "Open this screen": a link to a real admin screen, named by its page title (a link only for a role that may open it). */
  | { kind: "screen"; route: ScreenRouteId }
  /** Terms and their meaning. */
  | { kind: "definitions"; items: readonly { term: HelpText; definition: HelpText }[] };

export interface HelpTopic {
  id: string;
  title: HelpText;
}

export interface HelpArticle {
  /** The address of the article (`/help/<id>`): lower-case words joined by `-`; never rename one other links use. */
  id: string;
  /** The id of its topic (`HELP_TOPICS`). */
  topic: string;
  title: HelpText;
  /** One or two sentences shown in the list and in search results. */
  summary: HelpText;
  /** Extra words people may search for (synonyms, everyday words), per language. */
  keywords: Readonly<Record<Locale, readonly string[]>>;
  blocks: readonly HelpBlock[];
}

export interface HelpLibrary {
  topics: readonly HelpTopic[];
  /** In reading order: grouped by topic in the order of `topics`; previous and next follow this order. */
  articles: readonly HelpArticle[];
}

export interface HelpSection {
  id: string;
  title: HelpText;
}

/** The address of an article (with a section anchor); one builder for the help and the shell's contextual link. */
export { helpArticlePath } from "../../layout/context-help";

/** The DOM id of a section heading (prefixed, so an anchor never collides with an id of the shell). */
export function sectionElementId(sectionId: string): string {
  return `help-section-${sectionId}`;
}

export function findArticle(library: HelpLibrary, id: string): HelpArticle | null {
  return library.articles.find((article) => article.id === id) ?? null;
}

export function sectionsOf(article: HelpArticle): HelpSection[] {
  return article.blocks.flatMap((block) =>
    block.kind === "heading" ? [{ id: block.id, title: block.text }] : [],
  );
}

/** The articles of each topic, in topic order; a topic without articles is left out. */
export function articlesByTopic(
  library: HelpLibrary,
): { topic: HelpTopic; articles: HelpArticle[] }[] {
  return library.topics
    .map((topic) => ({
      topic,
      articles: library.articles.filter((article) => article.topic === topic.id),
    }))
    .filter((group) => group.articles.length > 0);
}

/** The article before and after this one in reading order (`null` at either end). */
export function neighbours(
  library: HelpLibrary,
  id: string,
): { previous: HelpArticle | null; next: HelpArticle | null } {
  const index = library.articles.findIndex((article) => article.id === id);
  if (index === -1) return { previous: null, next: null };
  return {
    previous: library.articles[index - 1] ?? null,
    next: library.articles[index + 1] ?? null,
  };
}

/** Every text of a block, in every language (search and the content checks read them). */
export function blockTexts(block: HelpBlock): HelpText[] {
  switch (block.kind) {
    case "heading":
    case "paragraph":
    case "note":
    case "warning":
      return [block.text];
    case "steps":
      return [...block.items];
    case "screen":
      return [];
    case "definitions":
      return block.items.flatMap((item) => [item.term, item.definition]);
  }
}

/** The section anchor from a location hash (`#prices` -> `prices`), or `null`. */
export function sectionFromHash(hash: string): string | null {
  if (!hash.startsWith("#") || hash.length < 2) return null;
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    // A malformed escape in a hand-typed address is no section; the article still opens at the top.
    return null;
  }
}
