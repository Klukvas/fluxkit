import type { Translator } from "@fluxkit/ui";
import { isValidElement, type ReactElement, type ReactNode } from "react";

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

type Props = Record<string, unknown>;

/**
 * Elements of a React tree for which `match` is true, found WITHOUT rendering: the tree a view function returns. Lets a
 * test call the handler a control was given (`onClick`, `onSubmit`) when no DOM is available. Function components listed in
 * `expand` are called with their props (only hook-free ones); every other component is left as an element.
 */
export function findElements(
  root: ReactNode,
  match: (element: ReactElement<Props>) => boolean,
  expand: readonly unknown[] = [],
): ReactElement<Props>[] {
  const found: ReactElement<Props>[] = [];
  function visit(node: ReactNode): void {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isValidElement<Props>(node)) return;
    if (match(node)) found.push(node);
    if (typeof node.type === "function" && expand.includes(node.type)) {
      visit((node.type as (props: Props) => ReactNode)(node.props));
      return;
    }
    for (const value of Object.values(node.props)) {
      if (Array.isArray(value) || isValidElement(value)) visit(value as ReactNode);
    }
  }
  visit(root);
  return found;
}

/** The text content of a React node (strings and numbers, depth first). */
export function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<Props>(node)) return textOf(node.props.children as ReactNode);
  return "";
}
