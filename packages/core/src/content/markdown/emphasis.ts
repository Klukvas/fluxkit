import { MarkdownFailure } from "./budget.js";
import type { Slot, SlotList } from "./inline-list.js";
import { MARKDOWN_LIMITS } from "./limits.js";

/** A run of `*` or `_` that may open or close emphasis; its slot holds the characters not used yet. */
export interface Delimiter {
  readonly slot: Slot;
  readonly char: "*" | "_";
  /** Characters left. */
  length: number;
  /** Characters in the source run (the "multiple of 3" rule reads it). */
  readonly originalLength: number;
  readonly canOpen: boolean;
  readonly canClose: boolean;
  prev: Delimiter | null;
  next: Delimiter | null;
}

export interface DelimiterRun {
  readonly slot: Slot;
  readonly char: "*" | "_";
  readonly length: number;
  readonly canOpen: boolean;
  readonly canClose: boolean;
}

const MULTIPLE = 3;

/**
 * CommonMark's "process emphasis" over a delimiter stack (spec 0.31, section 6.2), including the `openers_bottom` table that
 * keeps it linear: a closer that found no opener records where the search stopped, so the next closer of the same kind
 * never scans that part again.
 */
export class EmphasisStack {
  top: Delimiter | null = null;

  constructor(private readonly slots: SlotList) {}

  push(run: DelimiterRun): void {
    const delimiter: Delimiter = { ...run, originalLength: run.length, prev: this.top, next: null };
    if (this.top !== null) this.top.next = delimiter;
    this.top = delimiter;
  }

  private remove(delimiter: Delimiter): void {
    if (delimiter.prev !== null) delimiter.prev.next = delimiter.next;
    if (delimiter.next !== null) delimiter.next.prev = delimiter.prev;
    else this.top = delimiter.prev;
  }

  private firstAbove(bottom: Delimiter | null): Delimiter | null {
    let first: Delimiter | null = null;
    for (
      let delimiter = this.top;
      delimiter !== null && delimiter !== bottom;
      delimiter = delimiter.prev
    ) {
      first = delimiter;
    }
    return first;
  }

  private static isOddMatch(opener: Delimiter, closer: Delimiter): boolean {
    return (
      (closer.canOpen || opener.canClose) &&
      (opener.originalLength + closer.originalLength) % MULTIPLE === 0 &&
      !(opener.originalLength % MULTIPLE === 0 && closer.originalLength % MULTIPLE === 0)
    );
  }

  private findOpener(closer: Delimiter, stopAt: Delimiter | null): Delimiter | null {
    for (let opener = closer.prev; opener !== null && opener !== stopAt; opener = opener.prev) {
      if (
        opener.char === closer.char &&
        opener.canOpen &&
        !EmphasisStack.isOddMatch(opener, closer)
      ) {
        return opener;
      }
    }
    return null;
  }

  /** Wraps the slots between `opener` and `closer` into emphasis (one character each) or strong (two). */
  private wrap(opener: Delimiter, closer: Delimiter): void {
    const used = opener.length >= 2 && closer.length >= 2 ? 2 : 1;
    opener.length -= used;
    closer.length -= used;
    opener.slot.piece = { kind: "text", value: opener.char.repeat(opener.length) };
    closer.slot.piece = { kind: "text", value: closer.char.repeat(closer.length) };
    const { nodes, depth } = this.slots.take(opener.slot.next, closer.slot);
    if (depth + 1 > MARKDOWN_LIMITS.maxInlineDepth) {
      throw new MarkdownFailure("too_deep", closer.slot.line);
    }
    this.slots.insertAfter(
      opener.slot,
      {
        kind: "node",
        node: { type: used === 2 ? "strong" : "emphasis", children: nodes },
        depth: depth + 1,
      },
      opener.slot.line,
    );
    // The delimiters between the two are inside the new node now: they can no longer match anything outside it.
    opener.next = closer;
    closer.prev = opener;
    if (opener.length === 0) {
      this.slots.remove(opener.slot);
      this.remove(opener);
    }
  }

  /** Matches every closer above `bottom` with its opener, then drops the delimiters above `bottom`. */
  process(bottom: Delimiter | null): void {
    const openersBottom = new Map<string, Delimiter | null>();
    let closer = this.firstAbove(bottom);
    while (closer !== null) {
      if (!closer.canClose) {
        closer = closer.next;
        continue;
      }
      const key = `${closer.char}${closer.canOpen ? 1 : 0}${closer.originalLength % MULTIPLE}`;
      const stopAt = openersBottom.has(key) ? (openersBottom.get(key) ?? null) : bottom;
      const opener = this.findOpener(closer, stopAt);
      if (opener !== null) {
        this.wrap(opener, closer);
        if (closer.length === 0) {
          const next: Delimiter | null = closer.next;
          this.slots.remove(closer.slot);
          this.remove(closer);
          closer = next;
        }
        continue;
      }
      openersBottom.set(key, closer.prev);
      const next: Delimiter | null = closer.next;
      if (!closer.canOpen) this.remove(closer);
      closer = next;
    }
    while (this.top !== null && this.top !== bottom) this.remove(this.top);
  }
}
