import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import enCommon from "./src/messages/en/common.json";
import { applyOverrides, overrideProblems } from "./src/messages/overrides.ts";

/**
 * The admin's document title and favicon, written into `index.html` once at build (and by `vite dev`) by Vite's
 * `transformIndexHtml` hook (ADR 0047). One source each, nothing in `index.html` to edit:
 * - the name is the English `app.name` the admin renders: `src/messages/en/common.json` with a fork's
 *   `src/messages-overrides/en.json` over it (the same key the header shows). The static title is what a tab shows before
 *   the SPA starts and picks the UI language; the SPA then writes "<page> · <app.name>" in that language
 *   (`src/i18n/use-document-title.ts`). A fork renames the admin with `app.name` and `app.documentTitle` in both
 *   fork-owned `src/messages-overrides/{uk,en}.json` (no core edit; `docs/customization.md`, step 10).
 * - the favicon is a file a fork drops into `apps/admin/public/` (the first of `FAVICON_FILES`); Vite copies it to the
 *   build root, so it is served at `/admin-ui/<file>` by the edge proxy's `try_files`. Upstream ships none (no link).
 * The plugin also refuses a broken overrides file before anything is built (`messageOverrideProblems`): the SPA loads area
 * files lazily, so only the build sees every file at once.
 */

export const FAVICON_FILES = ["favicon.svg", "favicon.png", "favicon.ico"] as const;
type FaviconFile = (typeof FAVICON_FILES)[number];

const FAVICON_TYPES: Record<FaviconFile, string> = {
  "favicon.svg": "image/svg+xml",
  "favicon.png": "image/png",
  "favicon.ico": "image/x-icon",
};

export interface AdminBrand {
  name: string;
  favicon: FaviconFile | null;
}

/** The English `app.name` of the messages with a fork's overrides applied (a bad override value throws). */
export function adminName(
  common: Readonly<Record<string, string>>,
  overrides: Readonly<Record<string, unknown>>,
): string {
  const name = applyOverrides(common, overrides, "en")["app.name"];
  if (name === undefined) throw new Error("src/messages/en/common.json has no app.name.");
  return name;
}

/** The brand of this build. `publicDir` is Vite's resolved public folder (an empty string when it is turned off). */
export function adminBrand(publicDir: string): AdminBrand {
  const favicon =
    publicDir === "" ? undefined : FAVICON_FILES.find((file) => existsSync(join(publicDir, file)));
  // Read from disk, not imported: one JSON import less in the Vite config (its native loader warns on each).
  const overrides = readJson(
    fileURLToPath(new URL("./src/messages-overrides/en.json", import.meta.url)),
  );
  return { name: adminName(enCommon, overrides), favicon: favicon ?? null };
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** The message file of each feature slice for a locale (`features/<name>/messages/<locale>.json`, ADR 0049). */
function featureMessageFiles(sourceDir: string, locale: string): string[] {
  const root = join(sourceDir, "features");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, "messages", `${locale}.json`))
    .filter((file) => existsSync(file));
}

/**
 * The problems of the overrides files under `sourceDir` (`apps/admin/src`): every key must be in one of the locale's message
 * files, eager or lazy (`messages/<locale>/*.json`, and a feature slice's `features/<name>/messages/<locale>.json`), and every
 * value a non-empty string. Empty when all is well.
 */
export function messageOverrideProblems(sourceDir: string): string[] {
  return (["uk", "en"] as const).flatMap((locale) => {
    const folder = join(sourceDir, "messages", locale);
    const all: Record<string, string> = {};
    for (const file of readdirSync(folder).filter((name) => name.endsWith(".json"))) {
      Object.assign(all, readJson(join(folder, file)));
    }
    for (const file of featureMessageFiles(sourceDir, locale)) Object.assign(all, readJson(file));
    return overrideProblems(
      all,
      readJson(join(sourceDir, "messages-overrides", `${locale}.json`)),
      locale,
    );
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Pure: `html` with the name in its one `<title>` and, when there is a favicon, an icon link at the end of `<head>`. */
export function brandIndexHtml(html: string, brand: AdminBrand, base: string): string {
  const titles = html.match(/<title>[^<]*<\/title>/g) ?? [];
  if (titles.length !== 1) {
    throw new Error(
      `apps/admin/index.html must have exactly one <title> element, found ${titles.length}.`,
    );
  }
  let result = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(brand.name)}</title>`);
  if (brand.favicon !== null) {
    if (!result.includes("</head>")) throw new Error("apps/admin/index.html has no </head>.");
    const href = `${base.endsWith("/") ? base : `${base}/`}${brand.favicon}`;
    const link = `<link rel="icon" href="${escapeHtml(href)}" type="${FAVICON_TYPES[brand.favicon]}" />`;
    result = result.replace("</head>", `  ${link}\n  </head>`);
  }
  return result;
}

/**
 * The Vite plugin: checks the overrides files and reads the brand once the config is resolved (public folder, base path);
 * a broken overrides file stops `vite build` and `vite dev` with every problem named.
 */
export function adminBrandHtml(): Plugin {
  let brand: AdminBrand = { name: enCommon["app.name"], favicon: null };
  let base = "/";
  return {
    name: "fluxkit-admin-brand-html",
    configResolved(config) {
      const problems = messageOverrideProblems(join(config.root, "src"));
      if (problems.length > 0) throw new Error(problems.join("\n"));
      brand = adminBrand(config.publicDir);
      base = config.base;
    },
    transformIndexHtml(html) {
      return brandIndexHtml(html, brand, base);
    },
  };
}
