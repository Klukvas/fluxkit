import type { MarkdownInline } from "./types.js";

/**
 * The working list of the inline parser: a doubly linked list of pieces, so wrapping a range into emphasis or a link moves
 * each piece once (an array splice would shift every later piece and make adversarial input quadratic).
 */

export type Piece =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "node"; readonly node: MarkdownInline; readonly depth: number };

export interface Slot {
  piece: Piece;
  prev: Slot | null;
  next: Slot | null;
  readonly line: number;
}

export interface Finished {
  readonly nodes: MarkdownInline[];
  /** The deepest emphasis, strong or link nesting among the nodes (0 for text only). */
  readonly depth: number;
}

export class SlotList {
  head: Slot | null = null;
  tail: Slot | null = null;

  append(piece: Piece, line: number): Slot {
    const slot: Slot = { piece, prev: this.tail, next: null, line };
    if (this.tail === null) this.head = slot;
    else this.tail.next = slot;
    this.tail = slot;
    return slot;
  }

  insertAfter(anchor: Slot, piece: Piece, line: number): Slot {
    const slot: Slot = { piece, prev: anchor, next: anchor.next, line };
    if (anchor.next === null) this.tail = slot;
    else anchor.next.prev = slot;
    anchor.next = slot;
    return slot;
  }

  remove(slot: Slot): void {
    if (slot.prev === null) this.head = slot.next;
    else slot.prev.next = slot.next;
    if (slot.next === null) this.tail = slot.prev;
    else slot.next.prev = slot.prev;
  }

  /**
   * Removes the slots from `first` up to (not including) `end` (null: to the tail) and returns their nodes, adjacent texts
   * merged and empty texts dropped.
   */
  take(first: Slot | null, end: Slot | null): Finished {
    const nodes: MarkdownInline[] = [];
    let depth = 0;
    let text = "";
    let slot = first;
    while (slot !== null && slot !== end) {
      const { piece } = slot;
      if (piece.kind === "text") {
        text += piece.value;
      } else {
        if (text !== "") nodes.push({ type: "text", value: text });
        text = "";
        nodes.push(piece.node);
        depth = Math.max(depth, piece.depth);
      }
      const next: Slot | null = slot.next;
      this.remove(slot);
      slot = next;
    }
    if (text !== "") nodes.push({ type: "text", value: text });
    return { nodes, depth };
  }
}
