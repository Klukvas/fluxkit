import { inlinePlainText } from "./inline-text.js";
import type { MarkdownBlock, MarkdownDocument } from "./types.js";

function blockTexts(block: MarkdownBlock): string[] {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return [inlinePlainText(block.children)];
    case "codeBlock":
      return [block.value];
    case "blockquote":
      return block.children.flatMap(blockTexts);
    case "list":
      return block.items.flatMap((item) => item.children.flatMap(blockTexts));
    case "thematicBreak":
      return [];
  }
}

/**
 * The words of a document as plain text, blocks separated by a blank line (blog plan section 8: the description fallback
 * and the word count). Never markup: what the parser kept as text comes back literally.
 */
export function markdownPlainText(document: MarkdownDocument): string {
  return document.children
    .flatMap(blockTexts)
    .filter((text) => text !== "")
    .join("\n\n");
}
