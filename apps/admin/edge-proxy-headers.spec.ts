import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADMIN_CACHE_CONTROL, adminSecurityHeaders } from "./security-headers";

/**
 * The edge proxy of the production example (infra/proxy/nginx, docs/deployment.md) carries a COPY of the /admin-ui
 * headers: nginx cannot import this package. These checks fail when the copy and `security-headers.ts` drift apart, and
 * run the edge's start-up script to prove the image hosts become the same `img-src` entries as here.
 */
const nginxDirectory = fileURLToPath(new URL("../../infra/proxy/nginx/", import.meta.url));
const headersTemplate = readFileSync(
  `${nginxDirectory}templates/fluxkit/admin-ui-headers.conf.template`,
  "utf8",
);
const mainTemplate = readFileSync(`${nginxDirectory}templates/fluxkit.conf.template`, "utf8");
const envScript = `${nginxDirectory}16-fluxkit-env.envsh`;

/** `add_header Name "value" [always];` lines of an nginx snippet, as the edge would send them. */
function addHeaders(conf: string): { name: string; value: string; always: boolean }[] {
  return [...conf.matchAll(/^\s*add_header\s+([A-Za-z-]+)\s+"([^"]*)"(\s+always)?;/gm)].map(
    (match) => ({
      name: match[1] as string,
      value: match[2] as string,
      always: match[3] !== undefined,
    }),
  );
}

/** Runs the edge's start-up script like the nginx entrypoint does (sourced by sh) and returns its exported values. */
function runEnvScript(env: Record<string, string>): {
  status: number | null;
  values: Record<string, string>;
} {
  const result = spawnSync(
    "sh",
    [
      "-c",
      `. "${envScript}" && printf '%s\\n%s\\n%s\\n%s' "$FLUXKIT_DOMAIN" "$FLUXKIT_API_UPSTREAM" "$FLUXKIT_STOREFRONT_UPSTREAM" "$FLUXKIT_ADMIN_IMG_SRC"`,
    ],
    { env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", ...env }, encoding: "utf8" },
  );
  const [domain = "", api = "", storefront = "", imgSrc = ""] = result.stdout.split("\n");
  return {
    status: result.status,
    values: { domain, api, storefront, imgSrc },
  };
}

function rendered(imgSrc: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const header of addHeaders(headersTemplate.replaceAll("${FLUXKIT_ADMIN_IMG_SRC}", imgSrc))) {
    headers[header.name] = header.value;
  }
  return headers;
}

describe("edge proxy copy of the /admin-ui headers", () => {
  it("sends exactly the headers of security-headers.ts plus the edge's HSTS, all with `always`", () => {
    const { "Strict-Transport-Security": hsts, ...rest } = rendered("");
    expect(rest).toEqual(adminSecurityHeaders());
    expect(hsts).toBe("max-age=31536000");
    expect(addHeaders(headersTemplate).every((header) => header.always)).toBe(true);
  });

  it("adds the image hosts to img-src the way security-headers.ts does", () => {
    const { values, status } = runEnvScript({
      FLUXKIT_DOMAIN: "shop.example.com",
      STOREFRONT_IMAGE_HOSTS: " CDN.example.org,images.example.net, cdn.example.org ",
    });
    expect(status).toBe(0);
    const headers = rendered(values["imgSrc"] ?? "");
    delete headers["Strict-Transport-Security"];
    expect(headers).toEqual(
      adminSecurityHeaders({ imageHosts: ["cdn.example.org", "images.example.net"] }),
    );
  });

  it("uses the cache headers of security-headers.ts in both /admin-ui locations", () => {
    const cacheLines = [...mainTemplate.matchAll(/add_header Cache-Control "([^"]*)"( always)?;/g)];
    expect(cacheLines.map((match) => match[1])).toEqual([
      ADMIN_CACHE_CONTROL.assets,
      ADMIN_CACHE_CONTROL.html,
    ]);
    // The immutable header must not be sent on a 404 of a missing asset (no `always`).
    expect(cacheLines[0]?.[2]).toBeUndefined();
    // Both /admin-ui locations include the header snippet (a location with add_header inherits none).
    expect(
      mainTemplate.match(/include \/etc\/nginx\/conf\.d\/fluxkit\/admin-ui-headers\.conf;/g),
    ).toHaveLength(2);
  });
});

describe("edge start-up script", () => {
  it("defaults the upstreams and builds an empty img-src addition without image hosts", () => {
    const { status, values } = runEnvScript({ FLUXKIT_DOMAIN: "shop.example.com" });
    expect(status).toBe(0);
    expect(values).toEqual({
      domain: "shop.example.com",
      api: "api:3000",
      storefront: "storefront:3001",
      imgSrc: "",
    });
  });

  it.each([
    ["no domain", {}],
    ["an upper-case domain", { FLUXKIT_DOMAIN: "Shop.example.com" }],
    ["a domain with a scheme", { FLUXKIT_DOMAIN: "https://shop.example.com" }],
    [
      "an image host with a scheme",
      { FLUXKIT_DOMAIN: "shop.example.com", STOREFRONT_IMAGE_HOSTS: "https://cdn.example.org" },
    ],
    [
      "a wildcard image host",
      { FLUXKIT_DOMAIN: "shop.example.com", STOREFRONT_IMAGE_HOSTS: "*.example.org" },
    ],
    [
      "an image host with a port",
      { FLUXKIT_DOMAIN: "shop.example.com", STOREFRONT_IMAGE_HOSTS: "cdn.example.org:443" },
    ],
    [
      "an empty image host entry",
      {
        FLUXKIT_DOMAIN: "shop.example.com",
        STOREFRONT_IMAGE_HOSTS: "a.example.org,,b.example.org",
      },
    ],
    [
      "an image host that would break the header",
      { FLUXKIT_DOMAIN: "shop.example.com", STOREFRONT_IMAGE_HOSTS: 'a.example.org"; x' },
    ],
    [
      "an upstream without a port",
      { FLUXKIT_DOMAIN: "shop.example.com", FLUXKIT_API_UPSTREAM: "api" },
    ],
  ])("refuses to start with %s", (_label, env: Record<string, string>) => {
    expect(runEnvScript(env).status).not.toBe(0);
  });
});
