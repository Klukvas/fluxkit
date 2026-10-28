import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards over the Email area's wiring that static markup cannot see. They read the sources as text, so each rule is pinned to
 * the shape of the code that keeps it; a refactor that keeps the rule updates the pattern here.
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

describe("email area source guards", () => {
  it("finds its sources", () => {
    expect(sources.length).toBeGreaterThan(12);
  });

  it("renders mail HTML in ONE place: a single iframe, in preview-frame.tsx, with the empty sandbox constant", () => {
    const frames = sources.filter((source) => /<iframe\b/.test(source.code));
    expect(frames.map((source) => source.name)).toEqual(["preview-frame.tsx"]);
    const frame = frames[0]?.code ?? "";
    expect(frame).toMatch(/export const PREVIEW_SANDBOX = "";/);
    expect(frame).toMatch(/sandbox=\{PREVIEW_SANDBOX\}/);
    expect(frame).toMatch(/srcDoc=\{html\}/);
    expect(frame).not.toMatch(/allow-/);
    expect(frame).not.toMatch(/\ssrc=/);
  });

  it("never sets raw HTML or evaluates anything", () => {
    for (const { name, code } of sources) {
      expect(code, name).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/,
      );
    }
  });

  it("sends every write exactly once, through the single flight and run-write", () => {
    const writes = /adminClient\.(sendTestEmail|resendEmailMessage|cancelEmailMessage)\(/g;
    let seen = 0;
    for (const { name, code } of sources) {
      for (const match of code.matchAll(writes)) {
        seen += 1;
        const line = code.slice(
          code.lastIndexOf("\n", match.index) + 1,
          code.indexOf("\n", match.index),
        );
        expect(line, `${name}: ${match[0]}`).toMatch(/runWrite\(\(\) =>|send\(\(\) =>/);
      }
      if (/runWrite\(/.test(code) || /send\(\(\) =>/.test(code)) {
        expect(code, name).toMatch(/createSingleFlight/);
      }
    }
    expect(seen).toBe(3);
  });

  it("never retries a write: no loop, timer or second call around the writes", () => {
    for (const { name, code } of sources) {
      expect(code, name).not.toMatch(/setInterval|setTimeout|while \(|retry\(/);
    }
  });

  it("confirms resend and cancel in a dialog before the write", () => {
    const page = sources.find((source) => source.name === "message-detail-page.tsx")?.code ?? "";
    // The buttons only ask; the write is in `confirm`, which the dialogs call.
    expect(page).toMatch(/onAction=\{ask\}/);
    expect(page.match(/<ConfirmDialog/g)).toHaveLength(2);
    expect(page.match(/onConfirm=\{\(\) => void confirm\(\)\}/g)).toHaveLength(2);
    const ask = page.slice(page.indexOf("function ask("), page.indexOf("function close("));
    expect(ask).not.toMatch(/adminClient/);
    expect(page.match(/adminClient\.resendEmailMessage\(/g)).toHaveLength(1);
    expect(page.match(/adminClient\.cancelEmailMessage\(/g)).toHaveLength(1);
    expect(page.indexOf("async function confirm()")).toBeLessThan(
      page.indexOf("adminClient.resendEmailMessage("),
    );
  });

  it("never asks for or shows a credential: no password field, no input named like a key, token or secret", () => {
    for (const { name, code } of sources) {
      expect(code, name).not.toMatch(/type="password"/);
      expect(code, name).not.toMatch(
        /name="[^"]*(api_?key|token|secret|password|credential)[^"]*"/i,
      );
    }
  });

  it("does not read a mailbox, a key or the environment in the browser", () => {
    for (const { name, code } of sources) {
      expect(code, name).not.toMatch(/import\.meta\.env|process\.env|RESEND_API_KEY\s*[=:]/);
    }
  });
});
