import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PAYMENT_LIMITS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";

/*
 * STATIC guard of the production edge proxy configuration for the payment webhook (payments plan step 11). It reads the
 * repository's nginx template and Caddyfile and checks, as text, what a provider's server-to-server POST needs to reach
 * `POST /webhooks/payments/<provider>` with its exact bytes and its signature header. It does NOT run nginx or Caddy (neither
 * is installed where the suite runs, and CI has no step that starts the edge with a payment provider enabled:
 * `scripts/deploy-smoke.sh` checks the 404 and the 413 of the route with the real nginx image, nothing more). A passing
 * test here proves the configuration says the right things, not that a running proxy does them.
 */

const root = fileURLToPath(new URL("../../../../../infra/proxy/", import.meta.url));
const nginxTemplate = readFileSync(`${root}nginx/templates/fluxkit.conf.template`, "utf8");
const proxyToApiOwn = readFileSync(`${root}nginx/snippets/proxy-to-api.conf`, "utf8");
const caddyfile = readFileSync(`${root}caddy/Caddyfile`, "utf8");

/** The snippets of `infra/proxy/nginx/snippets/`, copied to `/etc/nginx/fluxkit/` by the edge image (Dockerfile). */
const SNIPPET_DIRECTORY = "/etc/nginx/fluxkit/";

/** The text with every `include /etc/nginx/fluxkit/<file>;` replaced by that snippet's text, as nginx reads it. */
function withSnippets(text: string): string {
  return text.replace(
    /^(\s*)include\s+\/etc\/nginx\/fluxkit\/([\w.-]+);[^\n]*$/gm,
    (_line, indent: string, file: string) =>
      withSnippets(readFileSync(`${root}nginx/snippets/${file}`, "utf8"))
        .split("\n")
        .map((line) => `${indent}${line}`)
        .join("\n"),
  );
}
const proxyToApi = withSnippets(proxyToApiOwn);

const WEBHOOK_PATHS = [
  "/webhooks/payments/monobank",
  "/webhooks/payments/fake",
  "/webhooks/payments/monobank/",
  "/webhooks/payments",
];
/** What must NOT be taken for the webhook route (and so goes to the storefront). */
const NOT_WEBHOOK_PATHS = ["/webhooks", "/webhooks/", "/webhooksx/payments", "/webhooks/paymentsx"];

/** The text without comments (`#` to the end of the line; the configs have no `#` inside a quoted value). */
function withoutComments(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n");
}

/** The body between the braces that open at `openIndex` (the `{`), and the index after the closing brace. */
function blockAt(text: string, openIndex: number): { body: string; end: number } {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return { body: text.slice(openIndex + 1, index), end: index + 1 };
    }
  }
  throw new Error("Unbalanced braces in the proxy configuration.");
}

interface NginxLocation {
  modifier: "" | "=" | "^~" | "~" | "~*";
  pattern: string;
  body: string;
}

/** The top-level `location` blocks of one block, in file order (nested blocks stay inside their location). */
function locationsOf(block: string): NginxLocation[] {
  const found: NginxLocation[] = [];
  const opener = /location\s+(=|\^~|~\*|~)?\s*(\S+)\s*\{/g;
  let match = opener.exec(block);
  while (match !== null) {
    const { body, end } = blockAt(block, match.index + match[0].length - 1);
    found.push({
      modifier: (match[1] ?? "") as NginxLocation["modifier"],
      pattern: match[2] as string,
      body,
    });
    opener.lastIndex = end;
    match = opener.exec(block);
  }
  return found;
}

/** The https server of the template (the one with the locations that matter). */
function httpsServer(): string {
  const text = withoutComments(nginxTemplate);
  const listen = text.indexOf("listen 8443 ssl;");
  expect(listen, "the template has an https server on 8443").toBeGreaterThan(-1);
  const open = text.lastIndexOf("server {", listen);
  return blockAt(text, text.indexOf("{", open)).body;
}

/** nginx's choice of a location for a path: exact, then the longest prefix (a `^~` one ends the search), then the first regex. */
function chosenLocation(locations: NginxLocation[], path: string): NginxLocation | undefined {
  const exact = locations.find((entry) => entry.modifier === "=" && entry.pattern === path);
  if (exact !== undefined) return exact;
  const prefixes = locations
    .filter(
      (entry) =>
        (entry.modifier === "" || entry.modifier === "^~") && path.startsWith(entry.pattern),
    )
    .sort((left, right) => right.pattern.length - left.pattern.length);
  if (prefixes[0]?.modifier === "^~") return prefixes[0];
  const regex = locations.find(
    (entry) =>
      (entry.modifier === "~" && new RegExp(entry.pattern).test(path)) ||
      (entry.modifier === "~*" && new RegExp(entry.pattern, "i").test(path)),
  );
  return regex ?? prefixes[0];
}

/** nginx sizes: `64k` is 64 * 1024. */
function nginxBytes(value: string): number {
  const match = /^(\d+)([kKmM]?)$/.exec(value);
  if (match === null) throw new Error(`Not an nginx size: ${value}`);
  const unit = (match[2] ?? "").toLowerCase();
  return Number(match[1]) * (unit === "k" ? 1024 : unit === "m" ? 1024 * 1024 : 1);
}

/** go-humanize sizes as Caddy reads them: `KB` is 1000 bytes, `KiB` is 1024 (so `64KB` would be 64000). */
function caddyBytes(value: string): number {
  const match = /^(\d+)\s*(B|KB|KiB|MB|MiB)?$/i.exec(value);
  if (match === null) throw new Error(`Not a Caddy size: ${value}`);
  const factors: Record<string, number> = { b: 1, kb: 1000, kib: 1024, mb: 1e6, mib: 1024 * 1024 };
  return Number(match[1]) * (factors[(match[2] ?? "B").toLowerCase()] as number);
}

function directives(body: string, name: string): string[] {
  return [...body.matchAll(new RegExp(`^\\s*${name}\\s+([^;]*);`, "gm"))].map((match) =>
    (match[1] as string).trim(),
  );
}

describe("nginx edge: the payment webhook location", () => {
  const server = httpsServer();
  const locations = locationsOf(server);
  const webhook = (path: string) => chosenLocation(locations, path);
  const webhookLocation = webhook("/webhooks/payments/monobank");
  if (webhookLocation === undefined) throw new Error("No location serves the webhook path.");

  it.each(WEBHOOK_PATHS)("routes %s to the API snippet (and nothing earlier takes it)", (path) => {
    const chosen = webhook(path);
    expect(chosen).toBe(webhookLocation);
    expect(chosen?.body).toContain("include /etc/nginx/fluxkit/proxy-to-api.conf;");
  });

  it.each(NOT_WEBHOOK_PATHS)("does not take %s for the webhook route", (path) => {
    expect(webhook(path)).not.toBe(webhookLocation);
  });

  it("caps the body at the API's own limit, so the edge and the API refuse the same size", () => {
    const sizes = directives(webhookLocation.body, "client_max_body_size");
    expect(sizes).toHaveLength(1);
    expect(nginxBytes(sizes[0] as string)).toBe(PAYMENT_LIMITS.webhookBodyMaxBytes);
  });

  it("leaves the request body alone: buffered whole (the default), no rewrite, no replacement, no filter", () => {
    const own = withoutComments(webhookLocation.body);
    // `proxy_request_buffering off` is the /admin upload choice; the webhook bodies are small and signed over their bytes.
    expect(own).not.toMatch(/proxy_request_buffering\s+off/);
    for (const forbidden of [
      "rewrite",
      "proxy_pass ",
      "proxy_set_body",
      "proxy_pass_request_body",
      "proxy_pass_request_headers",
      "proxy_set_header",
      "proxy_ignore_headers",
      "sub_filter",
      "gzip",
      "add_header",
      "return",
      "auth_basic",
      "limit_except",
    ]) {
      expect(own, `the webhook location must not use ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("proxies to the API upstream with no URI part (the path is forwarded as it came) and HTTP/1.1", () => {
    const passes = directives(withoutComments(proxyToApi), "proxy_pass");
    expect(passes).toEqual(["http://fluxkit_api"]);
    expect(passes[0]).toMatch(/^http:\/\/[^/]+$/); // no trailing slash or path after the upstream name
    expect(directives(withoutComments(proxyToApi), "proxy_http_version")).toEqual(["1.1"]);
  });

  it("keeps Content-Type, the length and the provider's signature headers: nothing in the snippet sets or hides them", () => {
    const snippet = withoutComments(proxyToApi);
    const setHeaders = directives(snippet, "proxy_set_header").map((entry) =>
      (entry.split(/\s+/)[0] as string).toLowerCase(),
    );
    expect(setHeaders.sort()).toEqual([
      "connection",
      "host",
      "x-forwarded-for",
      "x-forwarded-proto",
    ]);
    const hidden = directives(snippet, "proxy_hide_header").map((entry) => entry.toLowerCase());
    // Response headers only; none of them is a header the API's answer needs for a provider's POST.
    expect(hidden.sort()).toEqual(["strict-transport-security", "x-powered-by"]);
    for (const forbidden of [
      "proxy_pass_request_body",
      "proxy_pass_request_headers",
      "proxy_set_body",
      "proxy_ignore_headers",
      "proxy_request_buffering",
      "rewrite",
    ]) {
      expect(snippet, `the snippet must not use ${forbidden}`).not.toContain(forbidden);
    }
    // `X-Sign` (Monobank) and `x-fake-signature` (the test provider) have no underscore, so nginx would pass them by default;
    // switching that default off anywhere would drop other provider headers.
    expect(withoutComments(nginxTemplate)).not.toMatch(
      /ignore_invalid_headers\s+off|underscores_in_headers/,
    );
  });

  it("is not subject to the /admin-ui security headers or any CSP: the only add_header of the server is HSTS", () => {
    const serverOwn = withoutComments(
      // The server block without its locations.
      locations.reduce((rest, entry) => rest.replace(entry.body, ""), server),
    );
    const names = directives(serverOwn, "add_header").map((entry) =>
      (entry.split(/\s+/)[0] as string).toLowerCase(),
    );
    expect(names).toEqual(["strict-transport-security"]);
    expect(withoutComments(webhookLocation.body)).not.toContain("admin-ui-headers");
    // Only the two /admin-ui locations include the header set.
    const includers = locations.filter((entry) => entry.body.includes("admin-ui-headers.conf"));
    expect(includers.map((entry) => entry.pattern)).toEqual([
      "^/admin-ui/assets/",
      "^/admin-ui(/|$)",
    ]);
    expect(withoutComments(nginxTemplate)).not.toMatch(/Content-Security-Policy/i);
  });

  it("does not redirect a POST on the https server; port 80 only redirects (the webhook URL is https in production)", () => {
    expect(withoutComments(webhookLocation.body)).not.toMatch(/return\s+30\d/);
    const text = withoutComments(nginxTemplate);
    const port80 = text.indexOf("listen 8080;");
    const open = text.lastIndexOf("server {", port80);
    const plain = locationsOf(blockAt(text, text.indexOf("{", open)).body);
    // ACME http-01 and a 301 to https for the rest: a provider must be given an https webhook URL (the API's loadEnv requires
    // an https STOREFRONT_PUBLIC_URL with a payment provider in production), because a POST does not survive a redirect.
    expect(plain.map((entry) => entry.pattern)).toEqual(["/.well-known/acme-challenge/", "/"]);
  });
});

describe("Caddy edge: the payment webhook handle", () => {
  const text = withoutComments(caddyfile);
  const handleStart = text.indexOf("handle @webhooks");
  const handleBlock = blockAt(text, text.indexOf("{", handleStart)).body;

  it("matches the route exactly like nginx (the base path and everything under it) and comes before the storefront catch-all", () => {
    expect(text).toMatch(/@webhooks\s+path\s+\/webhooks\/payments\s+\/webhooks\/payments\/\*/);
    const catchAll = text.search(/^\s*handle\s*\{/m);
    expect(handleStart).toBeGreaterThan(-1);
    expect(handleStart).toBeLessThan(catchAll);
  });

  it("caps the body at the API's own limit (go-humanize: KiB, not KB, or the edge would refuse 65 000 byte bodies the API accepts)", () => {
    const sizes = [...handleBlock.matchAll(/max_size\s+(\S+)/g)].map((match) => match[1] as string);
    expect(sizes).toHaveLength(1);
    expect(caddyBytes(sizes[0] as string)).toBe(PAYMENT_LIMITS.webhookBodyMaxBytes);
  });

  it("forwards to the API unchanged: no header_up, rewrite, encode or body transformation, and no CSP on this handle", () => {
    expect(handleBlock).toContain("import to_api");
    const toApiStart = text.indexOf("(to_api)");
    const toApi = blockAt(text, text.indexOf("{", toApiStart)).body;
    for (const forbidden of ["header_up", "rewrite", "uri ", "encode", "trusted_proxies"]) {
      expect(toApi, `to_api must not use ${forbidden}`).not.toContain(forbidden);
      expect(handleBlock, `the webhook handle must not use ${forbidden}`).not.toContain(forbidden);
    }
    expect(handleBlock).not.toMatch(/import\s+admin_security|Content-Security-Policy/);
    expect(toApi).toMatch(/reverse_proxy\s+\{\$FLUXKIT_API_UPSTREAM:api:3000\}/);
    // Only the admin SPA handles import the security headers.
    const importers = [...text.matchAll(/handle\s+(@\w+)\s*\{/g)]
      .filter((match) =>
        blockAt(text, match.index + match[0].length - 1).body.includes("import admin_security"),
      )
      .map((match) => match[1]);
    expect(importers).toEqual(["@adminAssets", "@adminPages"]);
  });
});

describe("edge: one X-Forwarded-For rule for the API and the storefront (search UI review F2, ADR 0038)", () => {
  // The results page forwards the header the edge set on the PAGE request (STOREFRONT_FORWARD_CLIENT_ADDRESS), so the
  // storefront location must treat it exactly like the API locations: a CDN switch (append and TRUST_PROXY=2) that
  // reached one path only would put the shoppers of a CDN node into one search window on the other.
  const forwardedHeaders = readFileSync(`${root}nginx/snippets/forwarded-headers.conf`, "utf8");
  const forwardedRule = directives(withoutComments(forwardedHeaders), "proxy_set_header").filter(
    (entry) => /^x-forwarded-for\s/i.test(entry),
  );
  const server = httpsServer();
  const proxied = locationsOf(server).filter((entry) =>
    /^\s*proxy_pass\s/m.test(withoutComments(withSnippets(entry.body))),
  );
  const proxiedPatterns = ["^/(store|media)(/|$)", "^/admin(/|$)", "^/webhooks/payments(/|$)", "/"];

  it("sets the header in one snippet only, replacing what the client sent (the shipped TRUST_PROXY=1)", () => {
    expect(forwardedRule).toEqual(["X-Forwarded-For $remote_addr"]);
    const production = readFileSync(`${root}../production.env.example`, "utf8");
    expect(production).toMatch(/^TRUST_PROXY=1$/m);
  });

  it("finds the proxied locations it guards: the API ones and the storefront", () => {
    expect(proxied.map((entry) => entry.pattern)).toEqual(proxiedPatterns);
  });

  it.each(proxiedPatterns)(
    "gives the location %s the shared rule and no Host, X-Forwarded-For or X-Forwarded-Proto of its own",
    (pattern) => {
      const location = proxied.find((entry) => entry.pattern === pattern);
      if (location === undefined) throw new Error(`No location ${pattern}.`);
      const expanded = directives(withoutComments(withSnippets(location.body)), "proxy_set_header");
      expect(expanded.filter((entry) => /^x-forwarded-for\s/i.test(entry))).toEqual(forwardedRule);
      expect(withoutComments(location.body)).not.toMatch(
        /proxy_set_header\s+(X-Forwarded-For|Host|X-Forwarded-Proto)\s/i,
      );
    },
  );

  it("sets the forwarding headers nowhere else: not in the template, not in the API snippet", () => {
    expect(withoutComments(nginxTemplate)).not.toMatch(/proxy_set_header\s+X-Forwarded-For/i);
    expect(withoutComments(proxyToApiOwn)).not.toMatch(/proxy_set_header\s+X-Forwarded-For/i);
    expect(withoutComments(proxyToApiOwn)).toContain(
      `include ${SNIPPET_DIRECTORY}forwarded-headers.conf;`,
    );
  });

  it("Caddy: no handle rewrites the header and no proxy is trusted, so the API and the storefront get the same chain", () => {
    const text = withoutComments(caddyfile);
    expect(text).not.toMatch(/header_up\s+[-+]?X-Forwarded-For/i);
    expect(text).not.toContain("trusted_proxies");
    expect([...text.matchAll(/reverse_proxy\s/g)]).toHaveLength(2);
  });
});
