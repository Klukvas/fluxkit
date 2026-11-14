import { runMarkdownParse } from "./run-parse.js";
import type { MarkdownParseOptions, MarkdownParseResult } from "./types.js";

/**
 * Parses a body written in "Fluxkit Markdown" (ADR 0050) into its AST, or refuses it with the first error and its line.
 * Never produces HTML. Pure and linear in the length of the source; every limit of `MARKDOWN_LIMITS` is enforced, the size
 * of the result included, so the API can parse a stored body again on every read.
 */
export function parseMarkdown(source: string, options: MarkdownParseOptions): MarkdownParseResult {
  return runMarkdownParse(source, options).result;
}
