/**
 * The words of a post's body for the meta description and the JSON-LD `wordCount`: the storefront's twin of core
 * `markdownPlainText` (the storefront does not depend on core). Pure.
 */
import type { MarkdownViewBlock, MarkdownViewDocument, MarkdownViewInline } from "@fluxkit/ui";

function inlineText(nodes: readonly MarkdownViewInline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
        case "inlineCode":
          return node.value;
        case "break":
          return " ";
        case "emphasis":
        case "strong":
        case "link":
          return inlineText(node.children);
        default:
          // A node type of a newer API: `MarkdownView` skips it, so its words are not on the page either.
          return "";
      }
    })
    .join("");
}

function blockTexts(nodes: readonly MarkdownViewBlock[]): string[] {
  return nodes.flatMap((node) => {
    switch (node.type) {
      case "paragraph":
      case "heading":
        return [inlineText(node.children)];
      case "codeBlock":
        return [node.value];
      case "blockquote":
        return blockTexts(node.children);
      case "list":
        return node.items.flatMap((item) => blockTexts(item.children));
      default:
        return [];
    }
  });
}

/** The words of the document, blocks separated by a blank line, no markup. */
export function documentText(document: MarkdownViewDocument): string {
  return blockTexts(document.children)
    .map((block) => block.trim())
    .filter((block) => block !== "")
    .join("\n\n");
}

/** Words as a reader counts them: runs of letters, digits and joined punctuation between white space. */
export function wordCount(text: string): number {
  return text.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}
