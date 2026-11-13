/**
 * Where code spans can close: every maximal run of backticks in a paragraph, indexed by its length. Openers are met left to
 * right, so one cursor per length only moves forward and finding every closer costs one pass over the text (scanning ahead
 * from each opener would be quadratic on a body of backtick runs that never close).
 */
export class BacktickRuns {
  private readonly startsByLength = new Map<number, number[]>();
  private readonly cursors = new Map<number, number>();

  constructor(text: string) {
    let index = 0;
    while (index < text.length) {
      if (text.charAt(index) !== "`") {
        index += 1;
        continue;
      }
      const start = index;
      while (text.charAt(index) === "`") index += 1;
      const length = index - start;
      const starts = this.startsByLength.get(length);
      if (starts === undefined) this.startsByLength.set(length, [start]);
      else starts.push(start);
    }
  }

  /** The start of the first run of exactly `length` backticks at or after `from`, or -1. */
  closerOf(length: number, from: number): number {
    const starts = this.startsByLength.get(length);
    if (starts === undefined) return -1;
    let cursor = this.cursors.get(length) ?? 0;
    while (cursor < starts.length && (starts[cursor] ?? Number.POSITIVE_INFINITY) < from)
      cursor += 1;
    this.cursors.set(length, cursor);
    return starts[cursor] ?? -1;
  }
}
