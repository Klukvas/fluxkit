/**
 * A translated sentence that holds links (the notice "By ordering you accept the Terms"): the translator only returns text,
 * so the sentence is translated with each slot standing for itself (`slotValues`), then cut at the slots
 * (`splitMessage`) and the views put a link into each. The word order stays the translator's, so a language that puts the
 * privacy link first works.
 */

export type MessagePart = { kind: "text"; text: string } | { kind: "slot"; name: string };

/** Translator values that keep `{name}` as `{name}`. */
export function slotValues(slots: readonly string[]): Record<string, string> {
  return Object.fromEntries(slots.map((name) => [name, `{${name}}`]));
}

export function splitMessage(message: string, slots: readonly string[]): MessagePart[] {
  const parts: MessagePart[] = [];
  const pattern = new RegExp(`\\{(${slots.map(escapeForPattern).join("|")})\\}`, "g");
  let last = 0;
  for (const match of message.matchAll(pattern)) {
    if (match.index > last) parts.push({ kind: "text", text: message.slice(last, match.index) });
    parts.push({ kind: "slot", name: match[1] as string });
    last = match.index + match[0].length;
  }
  if (last < message.length) parts.push({ kind: "text", text: message.slice(last) });
  return parts;
}

function escapeForPattern(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
