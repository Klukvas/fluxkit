import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards over the Search area's wiring that static markup cannot see. They read the sources as text, so each rule is pinned
 * to the shape of the code that keeps it; a refactor that keeps the rule updates the pattern here.
 */
const folder = import.meta.dirname;
const sources = readdirSync(folder)
  .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name))
  .map((name) => ({
    name,
    code: readFileSync(join(folder, name), "utf8").replace(
      /\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g,
      "$1",
    ),
  }));
const source = (name: string) => sources.find((entry) => entry.name === name)?.code ?? "";

describe("search area source guards", () => {
  it("finds its sources", () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it("sends every write exactly once, through the single flight and run-write", () => {
    const writes =
      /adminClient\.(requestSearchRebuild|createSynonymGroup|updateSynonymGroup|deleteSynonymGroup)\(/g;
    let seen = 0;
    for (const { name, code } of sources) {
      for (const match of code.matchAll(writes)) {
        seen += 1;
        // The call is the body of `runWrite(() => ...)` or of `send("<action>", () => ...)`, on this line or the one before.
        const before = code.slice(Math.max(0, match.index - 60), match.index + match[0].length);
        expect(before, `${name}: ${match[0]}`).toMatch(/runWrite\(\(\) =>|send\("[a-z]+", \(\) =>/);
      }
      if (/runWrite\(/.test(code)) expect(code, name).toMatch(/createSingleFlight/);
    }
    // rebuild, create, update, delete
    expect(seen).toBe(4);
  });

  it("never retries a write: no loop, timer or second call around the writes", () => {
    for (const { name, code } of sources) {
      expect(code, name).not.toMatch(/setInterval|setTimeout|while \(|retry\(/);
    }
  });

  it("asks before the rebuild: the button only asks, the write is in the confirmation's handler", () => {
    const page = source("status-page.tsx");
    expect(page).toMatch(/onAsk=\{\(\) => setConfirming\(true\)\}/);
    expect(page).toMatch(/onConfirm=\{\(\) => void confirmRebuild\(\)\}/);
    expect(page.match(/adminClient\.requestSearchRebuild\(/g)).toHaveLength(1);
    const ask = page.slice(page.indexOf("onAsk="), page.indexOf("onAsk=") + 60);
    expect(ask).not.toMatch(/adminClient|confirmRebuild/);
    // the view's button calls onAsk, never onConfirm; onConfirm only belongs to the ConfirmDialog
    const view = source("search-status-view.tsx");
    expect(view).toMatch(/onClick=\{onAsk\}/);
    expect(view.match(/onConfirm=\{onConfirm\}/g)).toHaveLength(1);
    expect(view).toMatch(/<ConfirmDialog/);
  });

  it("confirms the delete in a dialog before the write", () => {
    const page = source("synonyms-page.tsx");
    expect(page).toMatch(/onDelete=\{openDelete\}/);
    expect(page).toMatch(/onConfirm=\{\(\) => void confirmDelete\(\)\}/);
    expect(page.match(/adminClient\.deleteSynonymGroup\(/g)).toHaveLength(1);
    const open = page.slice(page.indexOf("function openDelete("), page.indexOf("function close("));
    expect(open).not.toMatch(/adminClient/);
    expect(source("synonym-dialogs.tsx")).toMatch(/<ConfirmDialog/);
  });

  it("checks the terms before sending and again guards every write with the permission", () => {
    const page = source("synonyms-page.tsx");
    expect(page).toMatch(/if \(!canSubmitTerms\(parsed\)\)/);
    expect(page.indexOf("canSubmitTerms(parsed)")).toBeLessThan(
      page.indexOf("adminClient.createSynonymGroup("),
    );
    expect(page).toMatch(/if \(!canManage/);
    expect(source("status-page.tsx")).toMatch(/if \(!canManage\) return;/);
  });

  it("treats a 404 of the search routes as 'search is switched off' on both screens", () => {
    for (const name of ["status-page.tsx", "synonyms-page.tsx"]) {
      const code = source(name);
      expect(code, name).toMatch(/searchScreenState\(/);
      expect(code, name).toMatch(/<SearchOffView/);
    }
  });

  it("renders the write controls only for an admin who may change the catalog", () => {
    expect(source("synonyms-page.tsx")).toMatch(
      /canManage \?\s*\(\s*<Button onClick=\{openCreate\}/,
    );
    expect(source("search-status-view.tsx")).toMatch(/\{canManage \? \(/);
    expect(source("synonyms-view.tsx")).toMatch(/\{\.\.\.\(canManage/);
  });

  it("never asks for or shows an engine key or address, and does not read the environment", () => {
    for (const { name, code } of sources) {
      expect(code, name).not.toMatch(/type="password"/);
      expect(code, name).not.toMatch(
        /name="[^"]*(api_?key|token|secret|password|credential)[^"]*"/i,
      );
      expect(code, name).not.toMatch(/import\.meta\.env|process\.env|MEILI_MASTER_KEY\s*[=:]/);
      expect(code, name).not.toMatch(/dangerouslySetInnerHTML|innerHTML|\beval\(|new Function\(/);
    }
  });
});
