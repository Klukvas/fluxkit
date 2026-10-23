// Same-origin proxy of the admin e2e suite (ADR 0027): the browser talks to ONE origin, as it does in production where the
// edge proxy of the storefront host serves the admin SPA under `/admin-ui/`:
//   - `/admin-ui` and `/admin-ui/*`: the BUILT SPA (`apps/admin/dist`), with the `index.html` fallback for SPA paths (deep
//     links, reloads) and the security and cache headers of `security-headers.ts` on every response;
//   - `/admin/*`, `/store/*` and `/media/*` (the uploaded images; the API serves GET and HEAD): the API. Like the production edge proxy it
//     SETS `X-Forwarded-For` itself (the API runs with TRUST_PROXY=1, so exactly this one hop is trusted). The answer of the
//     API goes back unchanged: the proxy adds no cookie and no header of its own, the media headers are the API's;
//   - anything else: 404 (the storefront is not part of this suite; its own suite tests it).
//
// TEST-ONLY: every test gets its own client address so that the in-memory login limit (20 attempts per 10 minutes per
// address) never couples tests together. A test marks its requests with the header `x-e2e-client: <number>`; this proxy
// turns the number into 10.a.b.c, replaces any incoming `X-Forwarded-For` with it and removes the marker. No production
// code knows about this header. Run by Playwright's `webServer` (config in `playwright.config.ts`) with
// `node --experimental-strip-types`, so this file uses erasable TypeScript syntax only and imports nothing but node:* and
// the plain `security-headers.ts`.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  createServer,
  request,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { extname, resolve, sep } from "node:path";
import { ADMIN_CACHE_CONTROL, ADMIN_SECURITY_HEADERS } from "../security-headers.ts";

const CLIENT_HEADER = "x-e2e-client";
const API_ROUTE = /^\/(store|admin|media)(\/|\?|$)/;
const SPA_ROUTE = /^\/admin-ui(\/|\?|$)/;
const SPA_PREFIX = "/admin-ui";
const distRoot = resolve(import.meta.dirname, "../dist");
const indexFile = resolve(distRoot, "index.html");

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function requiredPort(name: string): number {
  const value = process.env[name];
  const port = Number(value);
  if (value === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a port number (set by playwright.config.ts), got "${value}"`);
  }
  return port;
}

const listenPort = requiredPort("ADMIN_E2E_PORT");
const apiPort = requiredPort("ADMIN_E2E_API_PORT");
// The suite tests the BUILT SPA: without a build the proxy must not start (it would answer every page with an error).
const builtIndex = await stat(indexFile).then(
  (entry) => entry.isFile(),
  (error: unknown) => {
    throw new Error(`${indexFile} cannot be read (${String(error)}): run pnpm build first.`);
  },
);
if (!builtIndex) throw new Error(`${indexFile} is not a file: run pnpm build first.`);

/** `x-e2e-client: 1234` becomes 10.0.4.210; no marker means the real peer address. */
function forwardedAddress(marker: string | string[] | undefined, peer: string | undefined): string {
  const text = Array.isArray(marker) ? marker[0] : marker;
  if (text !== undefined) {
    if (!/^\d{1,8}$/.test(text) || Number(text) >= 1 << 24) {
      throw new Error(`${CLIENT_HEADER} must be a whole number below 16777216, got "${text}"`);
    }
    const id = Number(text);
    return `10.${(id >> 16) & 255}.${(id >> 8) & 255}.${id & 255}`;
  }
  return peer ?? "127.0.0.1";
}

function upstreamHeaders(incoming: IncomingMessage): IncomingHttpHeaders {
  const kept = Object.entries(incoming.headers).filter(([name]) => name !== CLIENT_HEADER);
  return {
    ...Object.fromEntries(kept),
    "x-forwarded-for": forwardedAddress(
      incoming.headers[CLIENT_HEADER],
      incoming.socket.remoteAddress,
    ),
  };
}

function proxyToApi(incoming: IncomingMessage, outgoing: ServerResponse, url: string): void {
  let headers: IncomingHttpHeaders;
  try {
    headers = upstreamHeaders(incoming);
  } catch (error) {
    outgoing.writeHead(400, { "content-type": "text/plain" });
    outgoing.end(error instanceof Error ? error.message : String(error));
    return;
  }
  const upstream = request(
    { host: "127.0.0.1", port: apiPort, method: incoming.method, path: url, headers },
    (answer) => {
      outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(outgoing);
    },
  );
  upstream.on("error", (error) => {
    // Loud, not hidden: a test that hits a dead upstream must fail with this text in the Playwright output.
    console.error(`admin e2e proxy: ${incoming.method} ${url} failed: ${error.message}`);
    if (!outgoing.headersSent) outgoing.writeHead(502, { "content-type": "text/plain" });
    outgoing.end(`admin e2e proxy: upstream failed: ${error.message}`);
  });
  incoming.pipe(upstream);
}

function sendText(outgoing: ServerResponse, status: number, text: string, extra = {}): void {
  outgoing.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...extra });
  outgoing.end(text);
}

/**
 * The file a SPA path names, or `undefined` when there is none: only regular files inside `dist`, never a dot segment
 * (`.vite/manifest.json` is build metadata, not something to serve) and never a path that leaves `dist`.
 */
async function staticFile(pathname: string): Promise<string | undefined> {
  const relative = pathname.slice(SPA_PREFIX.length).replace(/^\/+/, "");
  if (relative === "") return undefined;
  if (relative.split("/").some((segment) => segment.startsWith("."))) return undefined;
  const file = resolve(distRoot, relative);
  if (!file.startsWith(distRoot + sep)) return undefined;
  try {
    return (await stat(file)).isFile() ? file : undefined;
  } catch (error) {
    // No such file: the caller decides between the fallback and a 404. Any other error (permissions, I/O) is a real failure.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

async function serveSpa(incoming: IncomingMessage, outgoing: ServerResponse, url: string) {
  // Every answer under /admin-ui carries the strict headers, the 404 and 405 too.
  const security = { ...ADMIN_SECURITY_HEADERS };
  if (incoming.method !== "GET" && incoming.method !== "HEAD") {
    sendText(outgoing, 405, "Method Not Allowed", { ...security, allow: "GET, HEAD" });
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, "http://proxy.invalid").pathname);
  } catch {
    sendText(outgoing, 400, "Bad Request", security);
    return;
  }
  const file = await staticFile(pathname);
  const isAsset = pathname.startsWith(`${SPA_PREFIX}/assets/`);
  if (file === undefined && isAsset) {
    // A missing hashed asset is a 404, never the HTML: a stale chunk must fail loudly, not run index.html as JavaScript.
    sendText(outgoing, 404, "Not Found", security);
    return;
  }
  const served = file ?? indexFile;
  const type = CONTENT_TYPES[extname(served)] ?? "application/octet-stream";
  const cache = served === indexFile ? ADMIN_CACHE_CONTROL.html : ADMIN_CACHE_CONTROL.assets;
  outgoing.writeHead(200, { ...security, "content-type": type, "cache-control": cache });
  if (incoming.method === "HEAD") {
    outgoing.end();
    return;
  }
  createReadStream(served)
    .on("error", (error) => {
      console.error(`admin e2e proxy: reading ${served} failed: ${error.message}`);
      outgoing.destroy(error);
    })
    .pipe(outgoing);
}

const server = createServer((incoming, outgoing) => {
  const url = incoming.url ?? "/";
  if (API_ROUTE.test(url)) {
    proxyToApi(incoming, outgoing, url);
    return;
  }
  if (SPA_ROUTE.test(url)) {
    serveSpa(incoming, outgoing, url).catch((error: unknown) => {
      console.error(`admin e2e proxy: ${url} failed: ${String(error)}`);
      if (!outgoing.headersSent) sendText(outgoing, 500, "admin e2e proxy failed");
      else outgoing.destroy();
    });
    return;
  }
  sendText(
    outgoing,
    404,
    "Not Found (the admin e2e proxy serves /admin-ui, /admin, /store and /media)",
  );
});

server.listen(listenPort, "127.0.0.1", () => {
  console.log(
    `admin e2e proxy on 127.0.0.1:${String(listenPort)} -> /admin-ui: ${distRoot}, /admin,/store,/media: ${String(apiPort)}`,
  );
});
