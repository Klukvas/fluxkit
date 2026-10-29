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
      // `paymentReturnHref` accepts an attempt id (a UUID) and nothing else (`lib/payment-return.ts`, tested there).
      expect(call.argument, `${call.path}: router.replace(${call.argument})`).toMatch(
        /^(safeNextPath\(|localizedHref\(|loginHref\(|paymentReturnHref\(|signInHref$|result\.href$)/,
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

  it("uses browser storage only for the checkout attempt, the payment attempt and the payment hand-off (sessionStorage), never localStorage or cookies", () => {
    const storage = sources.filter((file) => /\bsessionStorage\b/.test(code(file.text)));
    // Each of these three islands makes its storage once, through the probing helper, in the browser.
    expect(storage.map((file) => file.path).sort()).toEqual(
      [
        join("components", "checkout-page.tsx"),
        join("components", "order-payment.tsx"),
        join("components", "payment-return-page.tsx"),
      ].sort(),
    );
    for (const file of storage) {
      expect(code(file.text), file.path).toMatch(
        /sessionAttemptStorage\(\(\) => window\.sessionStorage\)/,
      );
    }
    for (const file of sources) {
      expect(code(file.text), file.path).not.toMatch(
        /\b(localStorage|indexedDB)\b|document\.cookie/,
      );
    }
  });

  it("never sets the document title from the browser (the order page's title is fixed metadata)", () => {
    for (const file of sources) expect(code(file.text), file.path).not.toMatch(/document\.title/);
  });

  it("reads the fragment only in the guest order page, the locale switcher and the fragment-token hook, inside effects", () => {
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

  // Shipping plan step 10: the browser talks to our API only, and never adds money.
  const shippingFiles = sources.filter((file) =>
    /(^|\/)(shipping-(?:model|store|text)|lookup-source|combobox-model|delivery-section|lookup-combobox)\.tsx?$/.test(
      file.path,
    ),
  );

  it("finds the delivery sources it guards", () => {
    expect(shippingFiles.map((file) => file.path).sort()).toEqual(
      [
        join("components", "delivery-section.tsx"),
        join("components", "lookup-combobox.tsx"),
        join("lib", "combobox-model.ts"),
        join("lib", "lookup-source.ts"),
        join("lib", "shipping-model.ts"),
        join("lib", "shipping-store.ts"),
        join("lib", "shipping-text.ts"),
      ].sort(),
    );
  });

  it("reaches carriers through our API and the typed client only: no fetch, no absolute URL, no other transport in the delivery code", () => {
    for (const file of shippingFiles) {
      const text = code(file.text);
      expect(text, file.path).not.toMatch(
        /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|https?:\/\//,
      );
    }
  });

  it("calls the options read from the shipping store and the carrier lookups from the pickers, nowhere else", () => {
    const callers = (name: string) =>
      sources
        .filter((file) => new RegExp(`\\.${name}\\(`).test(code(file.text)))
        .map((file) => file.path);
    expect(callers("getShippingOptions")).toEqual([join("lib", "shipping-store.ts")]);
    expect(callers("listShippingCities")).toEqual([join("components", "delivery-section.tsx")]);
    expect(callers("listShippingPickupPoints")).toEqual([
      join("components", "delivery-section.tsx"),
    ]);
  });

  it("never does arithmetic on an amount: the expected total is the server's or the cart's, copied", () => {
    const arithmetic = /\.amount\s*[-+*/%]|[-+*/%]\s*[\w.]+\.amount\b/;
    for (const file of sources) {
      expect(arithmetic.test(code(file.text)), `${file.path} computes with an amount`).toBe(false);
    }
  });

  it("chooses the expected total in the checkout store only (the form and the attempt hash just copy it)", () => {
    const setters = sources.filter((file) => /\bexpectedTotal\s*:/.test(code(file.text)));
    expect(setters.map((file) => file.path).sort()).toEqual(
      [
        join("lib", "checkout-attempt.ts"),
        join("lib", "checkout-form.ts"),
        join("lib", "checkout-store.ts"),
      ].sort(),
    );
    const store = sources.find((file) => file.path === join("lib", "checkout-store.ts"));
    expect(code(store?.text ?? "")).toMatch(
      /expectedTotal:\s*plan\.kind === "ship" \? plan\.total : current\.total/,
    );
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

  // Email plan step 10: the emailed-link pages (forgot password, reset password, verify email).
  const emailFiles = sources.filter((file) =>
    /(^|\/)(account-(?:email-parts|forgot-password|reset-password|verify-email|verify-notice|email-flows)|use-fragment-token|fragment-token|reset-password-form)\.tsx?$/.test(
      file.path,
    ),
  );
  const tokenFiles = emailFiles.filter((file) =>
    /(reset-password|verify-email|fragment-token|email-flows)/.test(file.path),
  );

  it("finds the emailed-link sources it guards", () => {
    expect(emailFiles.map((file) => file.path).sort()).toEqual(
      [
        join("components", "account-email-parts.tsx"),
        join("components", "account-forgot-password.tsx"),
        join("components", "account-reset-password.tsx"),
        join("components", "account-verify-email.tsx"),
        join("components", "account-verify-notice.tsx"),
        join("components", "use-fragment-token.ts"),
        join("lib", "account-email-flows.ts"),
        join("lib", "fragment-token.ts"),
        join("lib", "reset-password-form.ts"),
      ].sort(),
    );
  });

  it("reads and removes the link's fragment in one place: takeFragmentToken, called by the hook only, which only the two token pages use", () => {
    const callers = sources.filter((file) => /\btakeFragmentToken\(/.test(code(file.text)));
    expect(callers.map((file) => file.path).sort()).toEqual(
      [join("components", "use-fragment-token.ts"), join("lib", "fragment-token.ts")].sort(),
    );
    const hookUsers = sources.filter((file) => /\buseFragmentToken\(/.test(code(file.text)));
    expect(hookUsers.map((file) => file.path).sort()).toEqual(
      [
        join("components", "account-reset-password.tsx"),
        join("components", "account-verify-email.tsx"),
        join("components", "use-fragment-token.ts"),
      ].sort(),
    );
    // The scrub keeps the history entry's own state and never writes the fragment back.
    const lib = sources.find((file) => file.path === join("lib", "fragment-token.ts"));
    expect(code(lib?.text ?? "")).toMatch(
      /replaceState\(win\.history\.state, "", `\$\{pathname\}\$\{search\}`\)/,
    );
  });

  it("sends a link's token only through the confirm calls of one module, in the body (never in a URL)", () => {
    for (const name of [
      "confirmPasswordReset",
      "confirmEmailVerification",
      "requestPasswordReset",
      "requestEmailVerification",
    ]) {
      const callers = sources.filter((file) =>
        new RegExp(`\\bclient\\.${name}\\(`).test(code(file.text)),
      );
      expect(
        callers.map((file) => file.path),
        name,
      ).toEqual([join("lib", "account-email-flows.ts")]);
    }
    // The only template literal that holds a token is the in-memory map key of the settled confirmations.
    const templates = tokenFiles.flatMap((file) =>
      [...code(file.text).matchAll(/`[^`]*\$\{token\}[^`]*`/g)].map(
        (match) => `${file.path}: ${match[0]}`,
      ),
    );
    expect(templates).toEqual([
      `${join("lib", "account-email-flows.ts")}: \`confirmEmail:\${token}\``,
    ]);
    for (const file of tokenFiles) {
      // No navigation, link or history call may take the token.
      expect(code(file.text), file.path).not.toMatch(
        /(router\.\w+|history\.\w+|href=|localizedHref|authHref|loginHref)\([^;]*token/i,
      );
    }
  });

  it("shows 'Forgot password?' only through forgotPasswordHref(locale, emailDelivery), so no link exists without a mail provider", () => {
    const login = sources.find((file) => file.path === join("components", "login-form.tsx"));
    expect(code(login?.text ?? "")).toMatch(
      /forgotHref=\{forgotPasswordHref\(locale, emailDelivery\)\}/,
    );
    const hrefs = sources.filter((file) => /account\/forgot-password/.test(code(file.text)));
    expect(hrefs.map((file) => file.path).sort()).toEqual(
      [join("components", "account-reset-password.tsx"), join("lib", "email-links.ts")].sort(),
    );
  });

  it("uses no transport of its own, browser storage or console in the emailed-link code: the typed client only, nothing logged", () => {
    for (const file of emailFiles) {
      const text = code(file.text);
      expect(text, file.path).not.toMatch(
        /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|https?:\/\//,
      );
      expect(text, file.path).not.toMatch(
        /\b(localStorage|sessionStorage|indexedDB)\b|document\.cookie/,
      );
      expect(text, file.path).not.toMatch(/\bconsole\./);
      expect(text, file.path).not.toMatch(/document\.title|\.innerHTML/);
    }
  });

  it("puts no token, password or address into the title or the metadata of the three pages", () => {
    for (const name of ["forgot-password", "reset-password", "verify-email"]) {
      const route = sources.find((file) => file.path.includes(join("account", name, "page.tsx")));
      expect(route, name).toBeDefined();
      expect(code(route?.text ?? ""), name).not.toMatch(/token|password\b.*params|email.*params/i);
    }
  });

  // Payments plan step 9: the pay redirect, the return page and the payment section of the order pages.
  const paymentFiles = sources.filter((file) =>
    /(^|\/)(payment-\w[\w-]*|order-payment)\.tsx?$/.test(file.path),
  );

  it("finds the payment sources it guards", () => {
    expect(paymentFiles.map((file) => file.path).sort()).toEqual(
      [
        join("components", "order-payment.tsx"),
        join("components", "payment-return-page.tsx"),
        join("components", "payment-section.tsx"),
        join("lib", "payment-attempt.ts"),
        join("lib", "payment-model.ts"),
        join("lib", "payment-poll.ts"),
        join("lib", "payment-redirect.ts"),
        join("lib", "payment-return-model.ts"),
        join("lib", "payment-return.ts"),
        join("lib", "payment-store.ts"),
      ].sort(),
    );
  });

  it("reaches the payment routes through the typed client only: no fetch, no absolute URL, no other transport", () => {
    for (const file of paymentFiles) {
      expect(code(file.text), file.path).not.toMatch(
        /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|https?:\/\//,
      );
    }
  });

  it("calls the four payment routes from lib/payment-store.ts only (the guest token travels in their bodies there)", () => {
    for (const name of [
      "createOrderPayment",
      "getOrderPaymentStatus",
      "createAccountOrderPayment",
      "getAccountOrderPayment",
    ]) {
      const callers = sources
        .filter((file) => new RegExp(`\\.${name}\\(`).test(code(file.text)))
        .map((file) => file.path);
      expect(callers, name).toEqual([join("lib", "payment-store.ts")]);
    }
  });

  it("assigns the browser location in ONE place, lib/payment-redirect.ts, which checks the URL first", () => {
    const assigners = sources.filter((file) =>
      /\blocation\s*(=(?!=)|\.(href\s*=(?!=)|assign\(|replace\())/.test(code(file.text)),
    );
    expect(assigners.map((file) => file.path)).toEqual([join("lib", "payment-redirect.ts")]);
    const redirect = sources.find((file) => file.path === join("lib", "payment-redirect.ts"));
    expect(code(redirect?.text ?? "")).toMatch(
      /const url = providerRedirectUrl\(raw\);\s*if \(url === null\) return false;\s*win\.location\.assign\(url\);/,
    );
    // A provider page is reached by navigating, never by a form post (the CSP has form-action 'self').
    for (const file of paymentFiles) expect(code(file.text), file.path).not.toMatch(/<form\b/);
  });

  it("feeds goToProvider from the API's answer only: never from a query string, a fragment or storage", () => {
    const callers = sources.filter((file) => /\bgoToProvider\(/.test(code(file.text)));
    expect(callers.map((file) => file.path).sort()).toEqual(
      [join("components", "order-payment.tsx"), join("lib", "payment-redirect.ts")].sort(),
    );
    // The island passes the url the store hands it (the store got it from the API's answer or the order view).
    const island = sources.find((file) => file.path === join("components", "order-payment.tsx"));
    expect(code(island?.text ?? "")).toMatch(/navigate: \(url\) => goToProvider\(window, url\)/);
    expect(code(island?.text ?? "")).not.toMatch(
      /location\.(search|hash)|URLSearchParams|useSearchParams/,
    );
  });

  it("reads the query only in the return page, only through paymentIdFromSearch (an attempt id, nothing else)", () => {
    const readers = sources.filter((file) =>
      /location\.search|useSearchParams|URLSearchParams|searchParams/.test(code(file.text)),
    );
    const names = readers.map((file) => file.path);
    expect(names).toContain(join("components", "payment-return-page.tsx"));
    const page = sources.find(
      (file) => file.path === join("components", "payment-return-page.tsx"),
    );
    expect(code(page?.text ?? "")).toMatch(/paymentIdFromSearch\(window\.location\.search\)/);
    // That is the ONLY read of the query in the page: a status, an amount or an order number there is never looked at.
    expect(code(page?.text ?? "").match(/location\.search/g)).toHaveLength(1);
    expect(code(page?.text ?? "")).not.toMatch(/useSearchParams|URLSearchParams|searchParams/);
    // The id parser takes the `payment` member and nothing else.
    const parser = sources.find((file) => file.path === join("lib", "payment-return.ts"));
    expect(code(parser?.text ?? "").match(/getAll\(/g)).toEqual(["getAll("]);
    expect(code(parser?.text ?? "")).toMatch(/getAll\("payment"\)/);
    // No payment module other than the id parser touches the query.
    for (const file of paymentFiles) {
      if (file.path === join("lib", "payment-return.ts")) continue;
      if (file.path === join("components", "payment-return-page.tsx")) continue;
      expect(code(file.text), file.path).not.toMatch(
        /location\.search|useSearchParams|URLSearchParams|searchParams/,
      );
    }
    // The server shell of the return route reads nothing of the request.
    const route = sources.find((file) => file.path.includes(join("payment", "return", "page.tsx")));
    expect(route).toBeDefined();
    expect(code(route?.text ?? "")).not.toMatch(/searchParams|headers\(|cookies\(/);
  });

  it("never has a card data field anywhere: the shop never renders a card form (PCI redirect only)", () => {
    const card =
      /cc-(?:number|exp|csc|name)|card-?number|card_number|cardholder|\bcvv\b|\bcvc\b|\bcsc\b|\bpan\b|expir(?:y|ation)Date|security-?code/i;
    for (const file of sources) {
      expect(code(file.text), `${file.path} names a card data field`).not.toMatch(card);
    }
  });

  it("hardcodes no payment provider, host or page: the provider URL is the API's answer", () => {
    const provider = /monobank|liqpay|wayforpay|fondy|stripe|paypal|portmone|pay\.fake/i;
    for (const file of sources) {
      expect(code(file.text), `${file.path} names a payment provider`).not.toMatch(provider);
    }
  });

  it("keeps zod and the domain core out of the payment code (they must not reach the browser bundle)", () => {
    for (const file of paymentFiles) {
      expect(file.text, file.path).not.toMatch(
        /from ["'](?:zod|@fluxkit\/core|@fluxkit\/config)["']/,
      );
    }
  });

  it("never logs a payment id, token, link or answer from the payment code", () => {
    for (const file of paymentFiles) {
      expect(code(file.text), file.path).not.toMatch(/\bconsole\./);
    }
  });
});
