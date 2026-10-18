import type { Translator } from "@fluxkit/ui";

/**
 * A translator that returns `§key` (and `§key:count` for plurals), so a test can tell a translated string from a
 * hardcoded one: after removing the sentinels no word may be left in the markup.
 */
export function sentinelTranslator(): Translator {
  const t = ((key: string) => `§${key}`) as Translator;
  t.plural = (key: string, count: number) => `§${key}:${count}`;
  return t;
}

/** Visible text of server markup with the sentinels (and tags) removed. */
export function leftoverText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/§[A-Za-z0-9_.:-]+/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/[\d\s\u00a0—–-]+/g, " ")
    .trim();
}

/** Attribute values that carry words for people (not ids, hrefs or classes). */
export function textAttributes(html: string): string[] {
  return [
    ...html.matchAll(/\s(?:aria-label|alt|title|placeholder|aria-description)="([^"]*)"/g),
  ].map((match) => match[1] as string);
}
