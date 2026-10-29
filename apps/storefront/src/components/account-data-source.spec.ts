import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards over the "Your data" wiring that static markup cannot see (privacy plan step 10). They read the sources as text, so
 * each rule is pinned to the shape of the code that keeps it.
 */
const folder = import.meta.dirname;
function read(name: string): string {
  return readFileSync(join(folder, name), "utf8").replace(
    /\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g,
    "$1",
  );
}
const container = read("account-data.tsx");
const views = read("account-data-views.tsx");
const deleted = read("account-deleted.tsx");
const lib = readFileSync(join(folder, "..", "lib", "personal-data.ts"), "utf8");
const deletion = readFileSync(join(folder, "..", "lib", "delete-account.ts"), "utf8").replace(
  /\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g,
  "$1",
);
const download = readFileSync(join(folder, "..", "lib", "file-download.ts"), "utf8");

describe("your data page source guards", () => {
  it("sends the deletion once, only after the typed word matched, with the explicit confirmation", () => {
    // The flow is `lib/delete-account.ts` (behaviour in `lib/delete-account.spec.ts`); the page only wires it.
    expect(container.match(/runAccountDeletion\(/g)).toHaveLength(1);
    expect(container).not.toMatch(/deleteAccount\(/);
    expect(deletion.match(/client\.deleteAccount\(/g)).toHaveLength(1);
    const check = deletion.indexOf("confirmationMatches(values.confirmWord");
    const call = deletion.indexOf("client.deleteAccount(");
    expect(check).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(check);
    // A failed check returns a field failure before anything is sent.
    expect(deletion.slice(check, call)).toMatch(/return clientFailure\(/);
    expect(deletion).toMatch(/deleteBody\(values\.password\)/);
    expect(lib).toMatch(/return \{ password, confirm: true \};/);
  });

  it("fetches the export once per click, keeps a second click out, and builds the file in the browser", () => {
    expect(container.match(/client\.getDataExport\(/g)).toHaveLength(1);
    expect(container).toMatch(/if \(running\.current\) return;/);
    expect(container).toMatch(
      /downloadBlob\(\s*exportBlob\(result\.data\),\s*exportFileName\(result\.data\)/,
    );
    expect(lib).toMatch(/export const EXPORT_CONTENT_TYPE = "application\/json";/);
    expect(lib).toMatch(/new Blob\(\[[^\]]*\], \{ type: EXPORT_CONTENT_TYPE \}\)/);
  });

  it("uses no third party, no storage and no log: the file comes from the typed client's response", () => {
    for (const [name, code] of [
      ["account-data.tsx", container],
      ["account-data-views.tsx", views],
      ["account-deleted.tsx", deleted],
      ["file-download.ts", download],
      ["delete-account.ts", deletion],
    ] as const) {
      expect(code, name).not.toMatch(
        /localStorage|sessionStorage|document\.cookie|indexedDB|console\./,
      );
      expect(code, name).not.toMatch(/https?:\/\//);
      expect(code, name).not.toMatch(
        /\bfetch\(|XMLHttpRequest|sendBeacon|<script|dangerouslySetInnerHTML/,
      );
    }
    // Only the object URL of the blob is used: no data: URL, no server address.
    expect(download).toMatch(/URL\.createObjectURL/);
    expect(download).not.toMatch(/data:/);
  });

  it("moves the focus to the news after an action: the export status, the blocked list, the error summary", () => {
    expect(container).toMatch(/statusRef\.current\?\.focus\(\)/);
    expect(container).toMatch(/blockedRef\.current\?\.focus\(\)/);
    // The error summary is focused by useForm (focusAfterFailure); the views give it a ref and tabIndex.
    expect(views).toMatch(/summaryRef=\{summaryRef\}/);
    expect(views).toMatch(/tabIndex=\{-1\}/);
  });

  it("never reads the password or the typed word into a URL, a message or the deletion's confirmation page", () => {
    expect(container).not.toMatch(/router\.(replace|push)\([^)]*(password|confirmWord)/);
    expect(deleted).not.toMatch(/password|searchParams|location/);
    // The flow tells the page to empty the fields; the page wires those effects to the form.
    expect(container).toMatch(/form\.setValues\(\{ password: "", confirmWord: "" \}\)/);
    expect(container).toMatch(/clearPassword: \(\) => \{\s*form\.setValue\("password", ""\);/);
  });

  it("ends a deletion on the confirmation page and refreshes the session and cart there", () => {
    expect(container).toMatch(/router\.replace\(localizedHref\(locale, "\/account\/deleted"\)\)/);
    expect(deleted).toMatch(/store\.refresh\(\)/);
    expect(deleted).toMatch(/cart\.store\.refresh\(\)/);
  });
});
