import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source guards of the image upload (plan 2026-10-23-media-upload, section 6; ADR 0028): the rules that are about how the
 * code is built, not what it computes. The queue's behaviour is tested in `upload-queue.spec.ts` and
 * `upload-controller.spec.ts`; these keep it from being bypassed.
 */

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });
}

const root = import.meta.dirname;
const all = sourceFiles(root)
  .filter((path) => !/(^|\/)test-helpers\.ts$/.test(path))
  .map((path) => ({ path: relative(root, path), text: readFileSync(path, "utf8") }));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, "$1");
const file = (path: string) => {
  const found = all.find((entry) => entry.path === path);
  if (found === undefined) throw new Error(`${path} does not exist`);
  return { path, text: found.text, code: code(found.text) };
};

const QUEUE_FILES = [
  "areas/catalog-dictionaries/upload-queue.ts",
  "areas/catalog-dictionaries/upload-controller.ts",
  "areas/catalog-dictionaries/use-upload-queue.ts",
  "areas/catalog-dictionaries/upload-panel.tsx",
  "areas/catalog-dictionaries/brand-logo-upload.ts",
  "lib/upload-media.ts",
];

describe("upload source guards", () => {
  it("finds the files it guards", () => {
    for (const path of QUEUE_FILES) expect(file(path).text.length, path).toBeGreaterThan(200);
  });

  it("sends an image only from lib/upload-media.ts, once, through runWrite (exactly one request per file, never repeated)", () => {
    const callers = all.filter((entry) => /\buploadMedia\(/.test(code(entry.text)));
    expect(callers.map((entry) => entry.path)).toEqual(["lib/upload-media.ts"]);
    const media = file("lib/upload-media.ts").code;
    expect(media.match(/\buploadMedia\(/g)).toHaveLength(1);
    expect(media).toMatch(/runWrite\(\(\) => adminClient\.uploadMedia\(file, \{ signal \}\)\)/);
  });

  it("the runner makes one awaited request per file inside a sequential for-of loop", () => {
    const runner = file("areas/catalog-dictionaries/upload-queue.ts").code;
    expect(runner.match(/deps\.upload\(/g)).toHaveLength(1);
    expect(runner).toMatch(
      /for \(const entry of deps\.queue\) \{[\s\S]*await deps\.upload\(entry\.file, deps\.signal\)/,
    );
    const controller = file("areas/catalog-dictionaries/upload-controller.ts").code;
    expect(controller.match(/runUploadQueue\(/g)).toHaveLength(1);
    expect(controller).toMatch(/flight\.run\(/);
  });

  it("has no retry, timer loop, parallel send or polling in the upload code", () => {
    for (const path of QUEUE_FILES) {
      const text = file(path).code;
      expect(text, path).not.toMatch(
        /\bsetTimeout\b|\bsetInterval\b|requestAnimationFrame|\bwhile\s*\(|\bretry(?!-?After)|\bretries\b|\battempt/i,
      );
      expect(text, path).not.toMatch(
        /Promise\.(all|allSettled|race|any)\b|\.map\(\s*async|\.forEach\(\s*async/,
      );
    }
  });

  it("never renders HTML from data, makes object URLs or reads files by itself", () => {
    for (const path of QUEUE_FILES) {
      expect(file(path).code, path).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML|createObjectURL|FileReader|XMLHttpRequest|\bfetch\(/,
      );
    }
  });

  it("builds the file input's accept attribute from the server's types, with no type of its own anywhere", () => {
    const panel = file("areas/catalog-dictionaries/upload-panel.tsx").code;
    expect(panel).toMatch(/accept=\{acceptAttribute\(limits\.contentTypes\)\}/);
    for (const entry of all) {
      expect(code(entry.text), entry.path).not.toMatch(/["'`]image\/(jpeg|png|webp)/);
    }
  });

  it("clears the file input after each selection, after copying the list", () => {
    const panel = file("areas/catalog-dictionaries/upload-panel.tsx").code;
    expect(panel).toMatch(
      /const files = Array\.from\(input\.files \?\? \[\]\);\s*input\.value = "";\s*controls\.selectFiles\(files\);/,
    );
  });

  it("locks the file input while a queue runs without disabling it (the focus stays; step 9 review L-1)", () => {
    const panel = file("areas/catalog-dictionaries/upload-panel.tsx").code;
    const input = /<input\b[\s\S]*?\/>/.exec(panel)?.[0] ?? "";
    expect(input).not.toMatch(/(?<![-\w])disabled=/);
    expect(input).toContain("aria-disabled={running ? true : undefined}");
    expect(input).toContain("onClick={(event) => keepFileDialogClosed(running, event)}");
  });

  it("gives the file input no name, so a form submit never carries a file", () => {
    const panel = file("areas/catalog-dictionaries/upload-panel.tsx").code;
    const input = /<input\b[\s\S]*?\/>/.exec(panel)?.[0] ?? "";
    expect(input).toContain('type="file"');
    expect(input).not.toMatch(/\bname=/);
  });

  it("renders the upload button only behind write permission and the server's switch", () => {
    const tab = file("areas/products/tabs/media-tab.tsx").code;
    expect(tab).toMatch(/const canUpload = canWrite && uploadsEnabled;/);
    expect(tab).toMatch(/\{canUpload \? \(\s*<section[\s\S]*?<UploadPanel/);
    expect(tab.match(/<UploadPanel/g)).toHaveLength(1);
    const brand = file("areas/catalog-dictionaries/brand-form-view.tsx").code;
    expect(brand).toMatch(/const canUpload = canWrite && uploadsEnabled;/);
    expect(brand).toMatch(/\{canUpload \? \(\s*<>\s*<UploadPanel/);
    expect(brand.match(/<UploadPanel/g)).toHaveLength(1);
  });

  it("refuses a save while files upload, in the handler and on the button", () => {
    const tab = file("areas/products/tabs/media-tab.tsx").code;
    expect(tab).toMatch(/if \(form\.state\.busy \|\| !canWrite \|\| queue\.running\) return;/);
    expect(tab).toMatch(/locked=\{uploading\}/);
    expect(tab).toMatch(/unsavedMedia\(initial, rows, content\.locales, queue\.running\)/);
    const pages = file("areas/catalog-dictionaries/brands-page.tsx").code;
    expect(pages.match(/logo\.controls\.running/g)?.length).toBe(4);
    expect(pages).toMatch(/if \(form\.state\.busy \|\| logo\.controls\.running\) return;/);
    expect(pages).toMatch(
      /if \(form\.state\.busy \|\| !canWrite \|\| logo\.controls\.running\) return;/,
    );
    const brand = file("areas/catalog-dictionaries/brand-form-view.tsx").code;
    expect(brand).toMatch(/locked=\{upload\.running\}/);
  });

  it("limits the logo upload to one file in one slot", () => {
    const logo = file("areas/catalog-dictionaries/brand-logo-upload.ts").code;
    expect(logo).toMatch(/maxRows: 1,\s*maxFiles: 1,/);
  });

  it("gives every upload the 60 s limit and nothing else", () => {
    const timeout = file("lib/request-timeout.ts").code;
    expect(timeout).toMatch(/BROWSER_UPLOAD_TIMEOUT_MS = 60_000/);
    expect(timeout).toMatch(/method === "POST" && url\.split\("\?"\)\[0\] === UPLOAD_PATH/);
  });
});
