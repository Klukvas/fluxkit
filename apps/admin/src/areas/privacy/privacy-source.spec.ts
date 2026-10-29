import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards over the Privacy area's wiring that static markup cannot see. They read the sources as text, so each rule is pinned
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

function source(name: string): string {
  const found = sources.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`${name} is not a source of the area.`);
  return found.code;
}

describe("privacy area source guards", () => {
  it("finds its sources", () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it("sends every call exactly once, through the single flight and run-write", () => {
    const calls =
      /adminClient\.(privacyLookup|createPrivacyRequest|exportPrivacyRequest|previewPrivacyErasure|erasePrivacyRequest|rejectPrivacyRequest)\(/g;
    let seen = 0;
    for (const { name, code } of sources) {
      for (const match of code.matchAll(calls)) {
        seen += 1;
        // The call sits inside the callback of `runWrite(() =>` or `send(() =>`, on the same or the line before.
        const before = code.slice(Math.max(0, match.index - 40), match.index);
        expect(before, `${name}: ${match[0]}`).toMatch(/(runWrite|send)\(\(\) =>\s*$/);
      }
      if (/runWrite\(/.test(code) || /send\(\(\) =>/.test(code)) {
        expect(code, name).toMatch(/createSingleFlight/);
      }
    }
    expect(seen).toBe(6);
  });

  it("never retries a call: no loop, timer or second call around the calls", () => {
    for (const { name, code } of sources) {
      if (name === "export-download.ts") continue; // revokes the object URL later: not a call
      expect(code, name).not.toMatch(/setInterval|setTimeout|while \(|retry\(/);
    }
  });

  it("erases only after the typed word matched and the dialog was confirmed", () => {
    const page = source("request-detail-page.tsx");
    // The button only asks (opens the dialog); the call is in `confirmErase`, which only the dialog's submit reaches.
    const ask = page.slice(page.indexOf("function askErase("), page.indexOf("function askReject("));
    expect(ask).not.toMatch(/adminClient/);
    expect(page).toMatch(/onErase=\{askErase\}/);
    expect(page.match(/<EraseDialog/g)).toHaveLength(1);
    expect(page).toMatch(/onSubmit=\{\(\) => void confirmErase\(\)\}/);
    expect(page.match(/adminClient\.erasePrivacyRequest\(/g)).toHaveLength(1);
    // The call goes through `attemptErase` (erase-flow.ts, its direction is unit tested in erase-flow.spec.ts), which checks the
    // typed word first; the page may not call the API for an erasure any other way.
    const confirm = page.slice(page.indexOf("async function confirmErase("));
    const attemptAt = confirm.indexOf("attemptErase({");
    const callAt = confirm.indexOf("adminClient.erasePrivacyRequest(");
    expect(attemptAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(attemptAt);
    expect(page.match(/attemptErase\(/g)).toHaveLength(1);
    expect(confirm).toMatch(/expectedWord: t\("personal\.erase\.word"\)/);
    expect(confirm).toMatch(
      /attempt\.kind === "word_mismatch"\) \{\s*setTypedError\([^)]*\);\s*return;/,
    );
    expect(confirm).toMatch(/confirm: true/);
    const flow = source("erase-flow.ts");
    const checkAt = flow.indexOf("!confirmationMatches(input.typed, input.expectedWord)");
    const sendAt = flow.indexOf("input.send(");
    expect(checkAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(checkAt);
    expect(flow.slice(checkAt, sendAt)).toMatch(/return \{ kind: "word_mismatch" \}/);
  });

  it("offers the erase button only after a clean preview of the same address", () => {
    const page = source("request-detail-page.tsx");
    expect(page).toMatch(/canErase=\{previewValid && preview\.data\.blockers\.length === 0\}/);
    expect(page).toMatch(
      /const previewValid = preview !== null && preview\.email === email\.trim\(\)/,
    );
  });

  it("rejects behind a dialog too", () => {
    const page = source("request-detail-page.tsx");
    expect(page.match(/<RejectDialog/g)).toHaveLength(1);
    const ask = page.slice(page.indexOf("function askReject("), page.indexOf("function close("));
    expect(ask).not.toMatch(/adminClient/);
    expect(page.match(/adminClient\.rejectPrivacyRequest\(/g)).toHaveLength(1);
  });

  it("keeps an email address out of every URL, storage and log", () => {
    for (const { name, code } of sources) {
      expect(code, name).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
      expect(code, name).not.toMatch(/console\./);
      expect(code, name).not.toMatch(/useSearchParams.*email|searchParams\.(get|set)\(["']email/);
      expect(code, name).not.toMatch(/[?&]email=|\bnavigate\(/);
    }
    // The address is typed into component state and sent in bodies: the lookup form and the other forms post.
    for (const name of ["lookup-view.tsx", "request-detail-view.tsx"]) {
      const code = source(name);
      for (const form of code.matchAll(/<form\b[^>]*>/g)) {
        expect(form[0], name).toMatch(/method="post"/);
        expect(form[0], name).not.toMatch(/\saction=/);
      }
    }
    expect(source("requests-page.tsx")).not.toMatch(/email/i);
  });

  it("downloads the export as a JSON file built from the typed client's document", () => {
    const page = source("request-detail-page.tsx");
    expect(page).toMatch(
      /downloadBlob\(\s*exportBlob\(outcome\.data\),\s*exportFileName\(outcome\.data\)/,
    );
    const view = source("privacy-view.ts");
    expect(view).toMatch(/export const EXPORT_CONTENT_TYPE = "application\/json";/);
    expect(view).toMatch(/new Blob\(\[[^\]]*\], \{ type: EXPORT_CONTENT_TYPE \}\)/);
    // The document is never put into the page or a URL: no data: URL, no innerHTML.
    for (const { name, code } of sources) {
      expect(code, name).not.toMatch(/data:application|dangerouslySetInnerHTML|innerHTML|\beval\(/);
    }
  });

  it("asks for no credential and reads no environment or secret in the browser", () => {
    for (const { name, code } of sources) {
      expect(code, name).not.toMatch(/type="password"|import\.meta\.env|process\.env/);
    }
  });
});
