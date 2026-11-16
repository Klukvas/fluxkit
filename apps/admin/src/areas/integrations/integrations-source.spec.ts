import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards over the Integrations area's handling of typed secrets that static markup cannot see (plan
 * `2026-11-16-admin-integrations`, section 8 "Secret lifecycle"). They read the sources as text, so each rule is pinned to
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
const sourceOf = (name: string) => sources.find((source) => source.name === name)?.code ?? "";

describe("integrations area source guards", () => {
  it("finds its sources", () => {
    expect(sources.length).toBeGreaterThanOrEqual(9);
  });

  it("keeps a typed secret out of every store, address, log and unsaved-changes snapshot", () => {
    for (const { name, code } of sources) {
      expect(code, name).not.toMatch(
        /localStorage|sessionStorage|indexedDB|document\.cookie|console\.|useSearchParams|useUnsavedChangesGuard|history\.(push|replace)State/,
      );
    }
  });

  it("holds the typed values in the dialog's hook only: the page and the list never see them", () => {
    expect(sourceOf("secret-dialog.tsx")).toMatch(/useSecretValues\(/);
    for (const name of ["integrations-page.tsx", "integrations-list-view.tsx", "index.tsx"]) {
      expect(sourceOf(name), name).not.toMatch(/useSecretValues|currentPassword|\.value\b/);
    }
    // The dialog itself has no state for them besides the hook.
    expect(sourceOf("secret-dialog.tsx")).not.toMatch(/useState<SecretValuesState>/);
  });

  it("renders the dialog only while it is open, so closing it unmounts the inputs and drops their state", () => {
    expect(sourceOf("integrations-page.tsx")).toMatch(
      /\{target === null \|\| resource\.data === null \? null : \(\s*<SecretDialog/,
    );
  });

  it("takes the values out of the state before the one request that sends them", () => {
    const dialog = sourceOf("secret-dialog.tsx");
    const take = dialog.indexOf("secrets.take()");
    const write = dialog.indexOf("runWrite(() => send(taken))");
    expect(take).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(take);
    expect(
      dialog.match(/adminClient\.(putIntegrationSecret|retireIntegrationSecret)\(/g),
    ).toHaveLength(2);
    expect(dialog.match(/runWrite\(/g)).toHaveLength(1);
  });

  it("wipes on close, and closes when the session ends or changes hands", () => {
    const dialog = sourceOf("secret-dialog.tsx");
    expect(dialog).toMatch(/secrets\.wipe\(\);\s*onClose\(\);/);
    expect(dialog).toMatch(/useSecretValues\(BLANK, secretHolder\(session\.state\), onClose\)/);
  });

  it("never puts a typed value into a message, a notice or an element attribute other than the input's value", () => {
    const view = sourceOf("secret-dialog-view.tsx");
    expect(view.match(/values\.(value|currentPassword)/g)).toEqual([
      "values.value",
      "values.currentPassword",
    ]);
    expect(view).toMatch(/value=\{values\.value\}/);
    expect(view).toMatch(/value=\{values\.currentPassword\}/);
    expect(view).not.toMatch(/defaultValue|placeholder=/);
  });

  it("takes external addresses from the typed guide table only", () => {
    for (const { name, code } of sources) {
      if (name === "provider-guides.ts") continue;
      expect(code, name).not.toMatch(/https?:\/\//);
    }
    expect(sourceOf("integrations-list-view.tsx")).toMatch(
      /href=\{link\.href\}\s*target="_blank"\s*rel="noopener noreferrer"/,
    );
  });
});
