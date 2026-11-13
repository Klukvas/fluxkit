import { parseDocumentBlocks } from "./blocks.js";
import { MarkdownFailure, ParseBudget } from "./budget.js";
import { MARKDOWN_LIMITS } from "./limits.js";
import { lineOfOffset, sourceLines } from "./source.js";
import type {
  MarkdownDocument,
  MarkdownError,
  MarkdownParseOptions,
  MarkdownParseResult,
} from "./types.js";

function refuse(error: MarkdownError): MarkdownParseResult {
  return { ok: false, error };
}

/** UTF-8 length without `TextEncoder` (core stays free of runtime globals); a lone surrogate counts as U+FFFD. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/**
 * Parses a body written in "Fluxkit Markdown" (ADR 0050) into its AST, or refuses it with the first error and its line.
 * Never produces HTML. Pure and linear in the length of the source; every limit of `MARKDOWN_LIMITS` is enforced, the size
 * of the result included, so the API can parse a stored body again on every read.
 */
export function parseMarkdown(source: string, options: MarkdownParseOptions): MarkdownParseResult {
  if (source.length > MARKDOWN_LIMITS.maxLength) {
    return refuse({ code: "too_long", line: 1 });
  }
  const nul = source.indexOf("\u0000");
  if (nul !== -1) {
    return refuse({ code: "control_character", line: lineOfOffset(source, nul) });
  }
  try {
    const state = { budget: new ParseBudget(), locales: options.locales };
    const document: MarkdownDocument = {
      type: "document",
      children: parseDocumentBlocks(sourceLines(source), state),
    };
    if (utf8Length(JSON.stringify(document)) > MARKDOWN_LIMITS.maxSerializedBytes) {
      return refuse({ code: "too_large", line: 1 });
    }
    return { ok: true, document };
  } catch (error) {
    if (error instanceof MarkdownFailure) {
      return refuse(error.markdownError);
    }
    throw error;
  }
}
