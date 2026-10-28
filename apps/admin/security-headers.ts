/**
 * Response headers for `/admin-ui/*` (ADR 0027 decision 3; plan, "Security (admin side)"). The SPA cannot send headers
 * itself: the edge proxy (and the e2e proxy, and `vite preview`) sets these on every response of the static files. This
 * file is the single copy: `apps/admin/README.md` shows the values, `security-headers.spec.ts` pins them, and
 * `build-output.spec.ts` checks that the built `index.html` works under the policy (no inline script, no external URL).
 * Plain TypeScript without imports, so a Node script (a proxy, a test) can import it.
 */

const HOSTNAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

export interface AdminSecurityHeadersOptions {
  /**
   * Host names product images and brand logos are loaded from (`https://` only). The same list as the storefront's
   * `STOREFRONT_IMAGE_HOSTS`; a static SPA has no runtime configuration, so the proxy configuration carries it.
   */
  imageHosts?: readonly string[];
}

export function adminContentSecurityPolicy(options: AdminSecurityHeadersOptions = {}): string {
  const imageHosts = options.imageHosts ?? [];
  for (const host of imageHosts) {
    // A defence in depth: a host is spliced into a header, so it must be a bare DNS name.
    if (!HOSTNAME.test(host)) {
      throw new RangeError(
        "An image host must be a bare host name (no scheme, port, path or wildcard).",
      );
    }
  }
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'"]],
    ["style-src", ["'self'"]],
    // ONLY inline style ATTRIBUTES, there for the mail preview (it applies to the whole SPA, a CSP is per response): a template's HTML carries its styles in `style="..."`
    // attributes (mail clients ignore stylesheets), and a `srcdoc` iframe inherits this policy even when it is sandboxed,
    // so without this directive the preview would show unstyled mail. It allows no `<style>` element, no script and no
    // event handler (`script-src` is untouched), so it opens no script path; it lets an injected element be restyled at
    // most. Decision in docs/plans/2026-10-26-email.md, step 11 row; ADR 0027 decision 3 is otherwise unchanged.
    ["style-src-attr", ["'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", ...imageHosts.map((host) => `https://${host}`)]],
    ["connect-src", ["'self'"]],
    ["font-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'none'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

/** Every response under `/admin-ui/` (the HTML, the assets, the `index.html` fallback). HSTS is set by the TLS proxy. */
export function adminSecurityHeaders(
  options: AdminSecurityHeadersOptions = {},
): Record<string, string> {
  return {
    "Content-Security-Policy": adminContentSecurityPolicy(options),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

/** The header set without image hosts (images from the own origin only). */
export const ADMIN_SECURITY_HEADERS: Readonly<Record<string, string>> =
  Object.freeze(adminSecurityHeaders());

/** `Cache-Control` of the SPA's files: the HTML is revalidated on every load, the hashed assets are immutable. */
export const ADMIN_CACHE_CONTROL = Object.freeze({
  html: "no-cache",
  assets: "public, max-age=31536000, immutable",
});
