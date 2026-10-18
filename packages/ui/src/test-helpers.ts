import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const booleanAttributes = new Set([
  "disabled",
  "required",
  "checked",
  "readonly",
  "multiple",
  "selected",
]);

export type Tag = { name: string; attributes: Record<string, string | true>; raw: string };

export function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

/** All opening tags with the given name, with parsed attributes (boolean attributes are `true`). */
export function tags(markup: string, name: string): Tag[] {
  return [...markup.matchAll(new RegExp(`<${name}(?=[\\s>/])([^>]*)>`, "g"))].map((match) => {
    const attributes: Record<string, string | true> = {};
    for (const attribute of (match[1] as string).matchAll(/([^\s=/"]+)(?:="([^"]*)")?/g)) {
      const name = attribute[1] as string;
      // React renders boolean attributes as `disabled=""`; an empty `alt=""` must stay a string.
      attributes[name] =
        attribute[2] === undefined || (attribute[2] === "" && booleanAttributes.has(name))
          ? true
          : decode(attribute[2]);
    }
    return { name, attributes, raw: match[0] };
  });
}

export function first(markup: string, name: string): Tag {
  const [tag] = tags(markup, name);
  if (!tag) {
    throw new Error(`No <${name}> in ${markup}`);
  }
  return tag;
}

function decode(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** Text content with tags removed, entities decoded and whitespace collapsed. */
export function text(markup: string): string {
  return decode(markup.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Every class token used in the markup. */
export function classTokens(markup: string): string[] {
  return [...markup.matchAll(/class="([^"]*)"/g)].flatMap((match) =>
    (match[1] as string).split(/\s+/).filter(Boolean),
  );
}
