import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });
}

const root = import.meta.dirname;
// Test fixtures hold API-shaped sample data (they may name options); real source must not.
const sources = sourceFiles(root)
  .filter((path) => !/test-(fixtures|helpers)\.tsx?$/.test(path))
  .map((path) => ({ path: relative(root, path), text: readFileSync(path, "utf8") }));

describe("source guards (AGENTS.md sections 2.3 and 11)", () => {
  it("finds the sources it guards", () => {
    expect(sources.length).toBeGreaterThan(30);
  });

  it('gives every <form> method="post", so a submit before hydration never puts a password or personal data into a URL', () => {
    // Until React hydrates, the browser submits natively; a form without a method uses GET and the values land in the address
    // bar, the history, access logs and the Referer of later requests. Allow-list: none (every form holds personal data or a quantity).
    const uiRoot = join(root, "..", "..", "..", "packages", "ui", "src");
    const uiSources = sourceFiles(uiRoot).map((path) => ({
      path: relative(join(root, "..", "..", ".."), path),
      text: readFileSync(path, "utf8"),
    }));
    const forms = [...sources, ...uiSources].flatMap((file) =>
      [...file.text.matchAll(/<form\b(?:[^>]|=>)*>/g)].map((match) => ({
        path: file.path,
        tag: match[0],
      })),
    );
    expect(forms.length).toBeGreaterThanOrEqual(6);
    for (const form of forms) {
      expect(form.tag, `${form.path}: a form without method="post"`).toMatch(/\bmethod="post"/);
      expect(form.tag, `${form.path}: a form must not name an action`).not.toMatch(/\baction=/);
    }
  });

  it("mounts RouteFocus in the shell, so the focus follows a client-side navigation (review L9)", () => {
    const shell = sources.find((file) => file.path === join("components", "site-shell.tsx"));
    expect(shell?.text).toMatch(/<RouteFocus\s*\/>/);
  });

  it("sets raw HTML only in the JSON-LD component, which escapes it", () => {
    const users = sources.filter((file) => file.text.includes("dangerouslySetInnerHTML"));
    expect(users.map((file) => file.path)).toEqual(["components/json-ld.tsx"]);
    expect(users[0]?.text).toContain("serializeJsonLd");
  });

  it("never hardcodes a niche-specific option or attribute name (they are data from the API)", () => {
    const niche = /["'`](size|sizes|color|colour|colors|material|weight|flavor|pack)["'`]/i;
    // `sizes="..."` of next/image is an attribute name, written without quotes around the word itself.
    for (const file of sources) {
      expect(niche.test(file.text), `${file.path} names a niche-specific field`).toBe(false);
    }
  });

  it("does no floating point money math (amounts are integers and strings)", () => {
    const floatMoney = /\/\s*100\b|\*\s*100\b|toFixed\(|parseFloat\(|Math\.round\([^)]*amount/;
    for (const file of sources) {
      expect(floatMoney.test(file.text), `${file.path} looks like float money math`).toBe(false);
    }
  });

  it("loads images only through StoreImage, so the host allow-list cannot be bypassed", () => {
    for (const file of sources) {
      if (file.path === join("components", "store-image.tsx")) continue;
      expect(file.text, file.path).not.toMatch(/from ["']next\/image["']/);
      expect(file.text, file.path).not.toMatch(/<img[\s>]/);
    }
  });

  // The cart, the session and the account forms (plan: "no secrets in logs, URLs or localStorage"). The checkout attempt of
  // step 7 may use sessionStorage for its idempotency key; that file is outside this pattern.
  const personal = sources.filter((file) =>
    /(^|\/)(cart|account|session|login|register|profile|form|use-form|failure)[^/]*\.tsx?$/.test(
      file.path,
    ),
  );

  it("finds the cart and account sources it guards", () => {
    expect(personal.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        join("lib", "cart-store.ts"),
        join("lib", "account-store.ts"),
        join("components", "login-form.tsx"),
        join("components", "use-form.ts"),
      ]),
    );
  });

  it("keeps the cart, the session and the account forms out of browser storage and cookies", () => {
    for (const file of personal) {
      expect(file.text, file.path).not.toMatch(
        /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/,
      );
    }
  });

  it("never logs a password or a form value", () => {
    for (const file of personal) {
      for (const call of file.text.matchAll(/console\.\w+\([^;]*\)/gs)) {
        expect(call[0], `${file.path} logs ${call[0]}`).not.toMatch(/password|values|body/i);
      }
    }
  });

  it("navigates only to paths built by the safe builders (no raw next, no raw URL)", () => {
    const calls = sources.flatMap((file) =>
      [...file.text.matchAll(/router\.(?:push|replace)\(([^;]*)\);/gs)].map((match) => ({
        path: file.path,
        argument: match[1] as string,
      })),
    );
    expect(calls.length).toBeGreaterThan(3);
    for (const call of calls) {
      // `result.href` is the checkout outcome's link, built only by `guestOrderHref`, `accountOrderHref` or the cart path
      // (`lib/checkout-attempt.ts`, tested there).
      expect(call.argument, `${call.path}: router.replace(${call.argument})`).toMatch(
        /^(safeNextPath\(|localizedHref\(|loginHref\(|signInHref$|result\.href$)/,
      );
    }
    for (const file of sources) {
      expect(file.text, file.path).not.toMatch(/window\.location\s*(=|\.(href|assign|replace))/);
    }
  });

  it("renders the cart notices of a sign-in in exactly one place, so they are shown once", () => {
    const shell = sources.filter((file) => /<SessionNotices\b/.test(file.text));
    expect(shell.map((file) => file.path)).toEqual([join("components", "site-shell.tsx")]);
    expect(shell[0]?.text.match(/<SessionNotices\b/g)).toHaveLength(1);
    const words = sources.filter(
      (file) =>
        file.path !== join("lib", "cart-model.ts") && /cartNoticeMessageKey\(/.test(file.text),
    );
    expect(words.map((file) => file.path)).toEqual([join("components", "session-notices.tsx")]);
  });

  // Step 7: the checkout attempt and the guest order token (plan, "Guest order token", "Checkout idempotency").
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

  it("uses browser storage only for the checkout attempt (sessionStorage, a key and a hash), never localStorage or cookies", () => {
    const storage = sources.filter((file) => /\bsessionStorage\b/.test(code(file.text)));
    expect(storage.map((file) => file.path)).toEqual([join("components", "checkout-page.tsx")]);
    expect(code(storage[0]?.text ?? "")).toMatch(
      /sessionAttemptStorage\(\(\) => window\.sessionStorage\)/,
    );
    for (const file of sources) {
      expect(code(file.text), file.path).not.toMatch(
        /\b(localStorage|indexedDB)\b|document\.cookie/,
      );
    }
  });

  it("never sets the document title from the browser (the order page's title is fixed metadata)", () => {
    for (const file of sources) expect(code(file.text), file.path).not.toMatch(/document\.title/);
  });

  it("reads the fragment only in the guest order page and the locale switcher, inside effects", () => {
    const readers = sources.filter((file) => /location\.hash/.test(code(file.text)));
    expect(readers.map((file) => file.path).sort()).toEqual(
      [
        join("components", "guest-order-page.tsx"),
        join("components", "locale-switcher.tsx"),
      ].sort(),
    );
    const page = sources.find((file) => file.path === join("components", "guest-order-page.tsx"));
    expect(code(page?.text ?? "")).toMatch(
      /useEffect\(\(\) => \{\s*const token = tokenFromFragment\(window\.location\.hash\);/,
    );
  });

  it("sends the guest token only through the lookup and cancel bodies of one module", () => {
    const callers = sources.filter((file) => /\.(lookupOrder|cancelOrder)\(/.test(code(file.text)));
    expect(callers.map((file) => file.path)).toEqual([join("lib", "order-store.ts")]);
    const routes = sources.filter((file) => file.path.includes(join("order", "[number]")));
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      // The server shell never reads anything that could carry the token.
      expect(code(route.text), route.path).not.toMatch(
        /searchParams|headers\(|cookies\(|accessToken|token/i,
      );
    }
  });

  it("never logs a token, a link, a body or form values in the checkout and order code", () => {
    const files = sources.filter((file) =>
      /(^|\/)(checkout|order|guest-order|account-orders|locale-switcher)[^/]*\.tsx?$/.test(
        file.path,
      ),
    );
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const file of files) {
      for (const call of code(file.text).matchAll(/console\.\w+\([^;]*\)/gs)) {
        expect(call[0], `${file.path} logs ${call[0]}`).not.toMatch(
          /token|hash|href|link|body|values|email|phone/i,
        );
      }
    }
  });
});
