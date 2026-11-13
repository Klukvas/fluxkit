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

/** A parse result with the work it took (internal: the adversarial spec asserts linear work; not exported from core). */
export interface CountedParse {
  readonly result: MarkdownParseResult;
  /** Characters visited and loop steps taken, summed over the whole parse. */
  readonly steps: number;
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

function refused(error: MarkdownError, steps: number): CountedParse {
  return { result: { ok: false, error }, steps };
}

/** `parseMarkdown` with its work counted; `parse.ts` states the rules. */
export function runMarkdownParse(source: string, options: MarkdownParseOptions): CountedParse {
  if (source.length > MARKDOWN_LIMITS.maxLength) {
    return refused({ code: "too_long", line: 1 }, 0);
  }
  const nul = source.indexOf("\u0000");
  if (nul !== -1) {
    return refused({ code: "control_character", line: lineOfOffset(source, nul) }, source.length);
  }
  const budget = new ParseBudget();
  try {
    budget.count(source.length);
    const document: MarkdownDocument = {
      type: "document",
      children: parseDocumentBlocks(sourceLines(source), { budget, locales: options.locales }),
    };
    const serialized = JSON.stringify(document);
    budget.count(serialized.length);
    if (utf8Length(serialized) > MARKDOWN_LIMITS.maxSerializedBytes) {
      return refused({ code: "too_large", line: 1 }, budget.steps);
    }
    return { result: { ok: true, document }, steps: budget.steps };
  } catch (error) {
    if (error instanceof MarkdownFailure) {
      return refused(error.markdownError, budget.steps);
    }
    throw error;
  }
}
