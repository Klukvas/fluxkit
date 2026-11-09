import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import enCommon from "./src/messages/en/common.json";

/**
 * The admin's document title and favicon, written into `index.html` once at build (and by `vite dev`) by Vite's
 * `transformIndexHtml` hook (ADR 0047). One source each, nothing in `index.html` to edit:
 * - the name is the English `app.name` of `src/messages/en/common.json` (the same key the header shows). The static title
 *   is what a tab shows before the SPA starts and picks the UI language; the SPA then writes "<page> · <app.name>" in that
 *   language (`src/i18n/use-document-title.ts`). A fork renames the admin in `app.name` and `app.documentTitle` of both
 *   `messages/{uk,en}/common.json`.
 * - the favicon is a file a fork drops into `apps/admin/public/` (the first of `FAVICON_FILES`); Vite copies it to the
 *   build root, so it is served at `/admin-ui/<file>` by the edge proxy's `try_files`. Upstream ships none (no link).
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

/** The brand of this build. `publicDir` is Vite's resolved public folder (an empty string when it is turned off). */
export function adminBrand(publicDir: string): AdminBrand {
  const favicon =
    publicDir === "" ? undefined : FAVICON_FILES.find((file) => existsSync(join(publicDir, file)));
  return { name: enCommon["app.name"], favicon: favicon ?? null };
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

/** The Vite plugin: reads the brand once the config is resolved (public folder, base path). */
export function adminBrandHtml(): Plugin {
  let brand: AdminBrand = { name: enCommon["app.name"], favicon: null };
  let base = "/";
  return {
    name: "fluxkit-admin-brand-html",
    configResolved(config) {
      brand = adminBrand(config.publicDir);
      base = config.base;
    },
    transformIndexHtml(html) {
      return brandIndexHtml(html, brand, base);
    },
  };
}
