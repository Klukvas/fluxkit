import { MARKDOWN_LIMITS } from "./limits.js";
import type { MarkdownError, MarkdownErrorCode, MarkdownLinkRefusal } from "./types.js";

/** Ends a parse at the first refusal; `parseMarkdown` turns it into its result and lets every other error through. */
export class MarkdownFailure extends Error {
  readonly markdownError: MarkdownError;

  constructor(code: MarkdownErrorCode, line: number, reason?: MarkdownLinkRefusal) {
    super(`markdown ${code} at line ${line}`);
    this.name = "MarkdownFailure";
    this.markdownError = reason === undefined ? { code, line } : { code, line, reason };
  }
}

/**
 * Where the parser reports its work: one unit per character visited or loop step taken. A plain integer sum, so the
 * adversarial spec can assert linear work deterministically (wall-clock time depends on the runner).
 */
export interface WorkCounter {
  count(steps: number): void;
}

/** Counts what one parse has produced so far and refuses the first block, node or link over its limit. */
export class ParseBudget implements WorkCounter {
  private blocks = 0;
  private nodes = 0;
  private links = 0;
  private work = 0;

  count(steps: number): void {
    this.work += steps;
  }

  /** The work units counted so far (read by the internal `runMarkdownParse`, never by the public API). */
  get steps(): number {
    return this.work;
  }

  /** A block node (list items included); also counts as a node. */
  block(line: number): void {
    this.blocks += 1;
    if (this.blocks > MARKDOWN_LIMITS.maxBlocks) {
      throw new MarkdownFailure("too_many_blocks", line);
    }
    this.addNodes(1, line);
  }

  addNodes(count: number, line: number): void {
    this.nodes += count;
    if (this.nodes > MARKDOWN_LIMITS.maxNodes) {
      throw new MarkdownFailure("too_many_nodes", line);
    }
  }

  link(line: number): void {
    this.links += 1;
    if (this.links > MARKDOWN_LIMITS.maxLinks) {
      throw new MarkdownFailure("too_many_links", line);
    }
  }
}
