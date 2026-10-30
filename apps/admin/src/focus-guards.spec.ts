import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The source without comments, so prose that explains the rule does not trip it. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * Files that may still move the focus from an animation frame callback. Empty on purpose: a focus deferred to the next
 * frame lands after whatever the admin (or a test) did in the meantime, e.g. after the next field was focused, so the
 * typed text went into the wrong field (CI run of PR 191). Use `useFocusAfterCommit` (`src/lib/use-focus-after-commit.ts`).
 */
const ALLOWED: readonly string[] = [];

/** Whether a source schedules an animation frame and moves the focus (in the same file, so a callback cannot hide it). */
export function framesMoveFocus(text: string): boolean {
  const source = code(text);
  return /\brequestAnimationFrame\b/.test(source) && /\.focus\(/.test(source);
}

describe("focus guards", () => {
  it("recognises a frame that moves the focus, and ignores comments and frames without a focus", () => {
    expect(framesMoveFocus("requestAnimationFrame(() => ref.current?.focus());")).toBe(true);
    expect(
      framesMoveFocus("const f = requestAnimationFrame(tick);\nel.focus({ preventScroll: true });"),
    ).toBe(true);
    expect(framesMoveFocus("// requestAnimationFrame(() => a.focus())\nconst a = 1;")).toBe(false);
    expect(framesMoveFocus("/* requestAnimationFrame */ el.focus();")).toBe(false);
    expect(framesMoveFocus("requestAnimationFrame(draw);")).toBe(false);
  });

  it("moves the focus in no admin source from an animation frame (state + useFocusAfterCommit instead)", () => {
    const root = import.meta.dirname;
    const offenders = sourceFiles(root)
      .map((path) => ({ path: relative(root, path), text: readFileSync(path, "utf8") }))
      .filter((file) => !ALLOWED.includes(file.path) && framesMoveFocus(file.text))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("keeps the allow-list empty", () => {
    expect(ALLOWED).toEqual([]);
  });
});
