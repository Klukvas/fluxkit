import type { Locale, Messages, Translator } from "@fluxkit/ui";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { loadMessageFile, messagesWith, type LazyFile } from "./messages";

/**
 * Test-only helpers (imported by spec files, never by the app). A translator that returns `§key` (`§key:count` for
 * plurals), so a test can tell translated text from hardcoded text: after removing the sentinels no word may be left.
 */
export function sentinelTranslator(): Translator {
  const t = ((key: string) => `§${key}`) as Translator;
  t.plural = (key: string, count: number) => `§${key}:${count}`;
  return t;
}

/** Visible text of server markup with the sentinels, tags, entities, digits and dashes removed. */
export function leftoverText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/§[A-Za-z0-9_.:-]+/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/[\d\s\u00a0\u2014\u2013-]+/g, " ")
    .trim();
}

/** Attribute values that carry words for people (not ids, hrefs or classes). */
export function textAttributes(html: string): string[] {
  return [
    ...html.matchAll(/\s(?:aria-label|alt|title|placeholder|aria-description)="([^"]*)"/g),
  ].map((match) => match[1] as string);
}

/** Static markup of an element inside a memory router mounted at the SPA's base path (links need a router). */
export function renderInRouter(element: ReactElement, path = "/"): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { basename: "/admin-ui", initialEntries: [`/admin-ui${path}`] },
      element,
    ),
  );
}

/**
 * The messages a screen of an area sees in the app: the eager files plus the area's lazy files, loaded through the real
 * loaders (`messages/index.ts`). A screen test that renders with them proves the area's `MESSAGE_FILES` are enough.
 */
export async function messagesForArea(
  locale: Locale,
  files: readonly LazyFile[],
): Promise<Messages> {
  const loaded: Partial<Record<LazyFile, Messages>> = {};
  for (const file of files) loaded[file] = await loadMessageFile(file, locale);
  return messagesWith(locale, loaded);
}
