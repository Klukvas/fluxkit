import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import { adminSecurityHeaders } from "./security-headers.ts";
import { ADMIN_BASE_PATH } from "./src/router/base-path.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const DEFAULT_API_URL = "http://127.0.0.1:3000";

/**
 * Where `vite dev` and `vite preview` send `/admin/*` and `/media/*`: `ADMIN_DEV_API_URL` from the shell or the
 * repository's root `.env` (the shell wins), default `http://127.0.0.1:3000`. Development only: `vite build` never reads it and never calls the
 * API. A malformed value stops the dev server (no silent fallback).
 */
export function devApiUrl(value: string | undefined): string {
  if (value === undefined || value === "") return DEFAULT_API_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "ADMIN_DEV_API_URL must be an http(s) origin, for example http://127.0.0.1:3000.",
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error(
      "ADMIN_DEV_API_URL must be an http(s) origin, for example http://127.0.0.1:3000.",
    );
  }
  return url.origin;
}

function apiProxy(target: string): Record<string, ProxyOptions> {
  // The API's own prefix rule `^/admin(?:/|$)` (plus a bare query string); `/admin-ui` (the SPA) does not match.
  // The Host header stays the browser's, so the host-only admin cookie belongs to the dev server's host.
  // `/media` is the read route of uploaded images (ADR 0028). An upload's URL is `MEDIA_PUBLIC_BASE_URL/<key>`: when the API
  // is started with that variable set to this server's origin plus `/media`, the preview loads through this proxy (and
  // passes the `img-src 'self'` of `vite preview`). With the default (the API's own origin) the image comes from the API
  // directly and `vite preview`'s policy refuses it.
  return {
    "^/admin(?:/|\\?|$)": { target, changeOrigin: false },
    "^/media(?:/|\\?|$)": { target, changeOrigin: false },
  };
}

export default defineConfig(({ command, mode }) => {
  const serving = command === "serve";
  const target = serving
    ? devApiUrl(loadEnv(mode, repoRoot, "ADMIN_DEV_").ADMIN_DEV_API_URL)
    : DEFAULT_API_URL;
  return {
    base: `${ADMIN_BASE_PATH}/`,
    plugins: [react(), tailwindcss()],
    build: {
      // `build-output.spec.ts` reads the manifest: route chunks, entry budget.
      manifest: true,
    },
    server: { proxy: apiProxy(target) },
    // `vite preview` serves the build under the same headers as the edge proxy, for a local check of the CSP.
    preview: { proxy: apiProxy(target), headers: adminSecurityHeaders() },
  };
});
