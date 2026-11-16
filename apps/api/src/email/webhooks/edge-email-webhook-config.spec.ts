import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EMAIL_WEBHOOK_BODY_MAX_BYTES } from "./email-webhook-raw-body.js";

const root = fileURLToPath(new URL("../../../../../infra/proxy/", import.meta.url));
const nginx = readFileSync(`${root}nginx/templates/fluxkit.conf.template`, "utf8");
const caddy = readFileSync(`${root}caddy/Caddyfile`, "utf8");

describe("production email webhook forwarding", () => {
  it("keeps payment and other routes outside the email retry mapping", () => {
    const payment = /location ~ \^\/webhooks\/payments[^}]+\}/.exec(nginx)?.[0];
    expect(payment).toBeDefined();
    expect(payment).not.toMatch(/proxy_intercept_errors|error_page/);
    expect(nginx.match(/proxy_intercept_errors on;/g)).toHaveLength(1);
    expect(nginx.match(/error_page 502 503 504/g)).toHaveLength(1);
    const paymentHandle = caddy.slice(
      caddy.indexOf("handle @webhooks"),
      caddy.indexOf("# Email provider"),
    );
    expect(paymentHandle).not.toMatch(/Retry-After|handle_errors|respond|error /);
  });
  it("routes the exact email prefix through nginx before the storefront, preserving bytes", () => {
    const entry = /location ~ (\S*email\S*) \{([^}]+)\}/.exec(nginx);
    if (entry?.[1] === undefined || entry[2] === undefined)
      throw new Error("Missing email location");
    const match = new RegExp(entry[1]);
    for (const path of ["/webhooks/email", "/webhooks/email/resend", "/webhooks/email/brevo"])
      expect(match.test(path)).toBe(true);
    for (const path of ["/webhooks", "/webhooks/emailx", "/webhooks/payments/monobank"])
      expect(match.test(path)).toBe(false);
    expect(entry[2]).toContain("client_max_body_size 64k;");
    expect(entry[2]).toContain("proxy_intercept_errors on;");
    expect(entry[2]).toContain("error_page 502 503 504 =429 /_email-webhook-retry;");
    expect(nginx).toMatch(
      /location = \/_email-webhook-retry \{\s*internal;\s*add_header Retry-After "5" always;/,
    );
    expect(nginx).toMatch(/location = \/_email-webhook-retry \{[^}]*return 429;/);
    expect(64 * 1024).toBe(EMAIL_WEBHOOK_BODY_MAX_BYTES);
    expect(entry[2]).toContain("include /etc/nginx/fluxkit/proxy-to-api.conf;");
    expect(entry[2]).not.toMatch(/rewrite|proxy_set_body|proxy_set_header|return/);
    expect(entry.index).toBeLessThan(nginx.indexOf("location / {", entry.index));
  });

  it("routes the email prefix through Caddy with the same 64-KiB cap and raw API forwarding", () => {
    const start = caddy.indexOf("@emailWebhooks path");
    const block = caddy.slice(start, caddy.indexOf("# The admin SPA", start));
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain("@emailWebhooks path /webhooks/email /webhooks/email/*");
    expect(block).toContain("handle @emailWebhooks");
    expect(block).toContain("max_size 64KiB");
    expect(block).toContain("import to_api");
    expect(block).toContain("handle_errors 502 503 504");
    expect(block).toMatch(/@emailRetry path \/webhooks\/email \/webhooks\/email\/\*/);
    expect(block).toMatch(/handle @emailRetry \{\s*header Retry-After "5"\s*respond 429/);
    expect(caddy).toContain("@emailUnavailable status 502 503 504");
    expect(caddy).toMatch(
      /handle_response @emailUnavailable \{\s*@emailRetry path \/webhooks\/email \/webhooks\/email\/\*\s*route \{\s*error @emailRetry 502\s*copy_response/,
    );
    expect(block).not.toMatch(/header_up|rewrite|uri |encode|admin_security/);
    expect(start).toBeLessThan(caddy.indexOf("# Everything else:"));
  });
});
