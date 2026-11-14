import type { MarkdownInline } from "./types.js";

/** The words of inline nodes: text and code values, a line end for a hard break. */
export function inlinePlainText(nodes: readonly MarkdownInline[]): string {
  let text = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
      case "inlineCode":
        text += node.value;
        break;
      case "break":
        text += "\n";
        break;
      case "emphasis":
      case "strong":
      case "link":
        text += inlinePlainText(node.children);
        break;
    }
  }
  return text;
}
