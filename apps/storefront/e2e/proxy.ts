// Same-origin reverse proxy for the e2e suite (ADR 0026): the browser talks to ONE origin; `/store/*`, `/admin/*` and `/media/*`
// (uploaded images, ADR 0028) go to the API, everything else to the storefront. It mirrors the production edge proxy, and like it SETS `X-Forwarded-For`
// itself (the API runs with TRUST_PROXY=1, so exactly this one hop is trusted). The answer of the API goes back unchanged:
// the proxy adds no cookie and no header of its own.
//
// TEST-ONLY: the suite gives every test its own client address so that the in-memory rate limits (10 checkouts per 10
// minutes per address) never couple tests together. A test marks its requests with the header `x-e2e-client: <number>`;
// this proxy turns the number into 10.a.b.c, replaces any incoming `X-Forwarded-For` with it and removes the marker. No
// production code knows about this header. Run by Playwright's `webServer` (config in `playwright.config.ts`) with
// `node --experimental-strip-types`, so this file uses erasable TypeScript syntax only and imports nothing but node:*.
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage } from "node:http";

const CLIENT_HEADER = "x-e2e-client";
const API_ROUTE = /^\/(store|admin|media)(\/|\?|$)/;

function requiredPort(name: string): number {
  const value = process.env[name];
  const port = Number(value);
  if (value === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a port number (set by playwright.config.ts), got "${value}"`);
  }
  return port;
}

const listenPort = requiredPort("E2E_PORT");
const apiPort = requiredPort("E2E_API_PORT");
const storefrontPort = requiredPort("E2E_STOREFRONT_PORT");

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

const server = createServer((incoming, outgoing) => {
  const url = incoming.url ?? "/";
  let headers: IncomingHttpHeaders;
  try {
    headers = upstreamHeaders(incoming);
  } catch (error) {
    outgoing.writeHead(400, { "content-type": "text/plain" });
    outgoing.end(error instanceof Error ? error.message : String(error));
    return;
  }
  const upstream = request(
    {
      host: "127.0.0.1",
      port: API_ROUTE.test(url) ? apiPort : storefrontPort,
      method: incoming.method,
      path: url,
      headers,
    },
    (answer) => {
      outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(outgoing);
    },
  );
  upstream.on("error", (error) => {
    // Loud, not hidden: a test that hits a dead upstream must fail with this text in the Playwright output.
    console.error(`e2e proxy: ${incoming.method} ${url} failed: ${error.message}`);
    if (!outgoing.headersSent) outgoing.writeHead(502, { "content-type": "text/plain" });
    outgoing.end(`e2e proxy: upstream failed: ${error.message}`);
  });
  incoming.pipe(upstream);
});

server.listen(listenPort, "127.0.0.1", () => {
  console.log(
    `e2e proxy on 127.0.0.1:${listenPort} -> /store,/admin,/media: ${apiPort}, rest: ${storefrontPort}`,
  );
});
