import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type PlaywrightWorkerArgs,
  type TestInfo,
} from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { AdminApi, StoreApi, type Role } from "./api.ts";
import {
  ADMIN_E2E_ORIGIN,
  MANAGER_EMAIL,
  MANAGER_PASSWORD,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  SPA,
  VIEWER_EMAIL,
  VIEWER_PASSWORD,
  clientMarker,
} from "./env.ts";

export { expect };

export const CREDENTIALS: Readonly<Record<Role, { email: string; password: string }>> = {
  owner: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
  manager: { email: MANAGER_EMAIL, password: MANAGER_PASSWORD },
  viewer: { email: VIEWER_EMAIL, password: VIEWER_PASSWORD },
};

/**
 * A short lower-case suffix no other test, repeat or retry uses (a worker restarts after a failure, so a counter alone would
 * repeat): codes, slugs, emails and SKUs the scenarios create carry it, so a test never meets data of another test. Only
 * `[a-z0-9]` (valid in codes, slugs and SKUs).
 */
export function unique(testInfo: TestInfo): string {
  return `r${String(testInfo.retry)}e${String(testInfo.repeatEachIndex)}${randomBytes(4).toString("hex")}`;
}

/** Every message text of the SPA (both languages), to tell the SPA's own sentences from an API detail it might show. */
const SPA_MESSAGES: ReadonlySet<string> = new Set(
  ["en", "uk"].flatMap((language) => {
    const folder = resolve(import.meta.dirname, "../../src/messages", language);
    return readdirSync(folder)
      .filter((file) => file.endsWith(".json"))
      .flatMap((file) =>
        Object.values(
          JSON.parse(readFileSync(resolve(folder, file), "utf8")) as Record<string, string>,
        ),
      )
      .map((text) => text.trim());
  }),
);

/** Chromium logs every 4xx or 5xx answer of a `fetch` as a console error; the SPA meets 401, 403 and 409 answers on purpose. */
const NETWORK_STATUS_LINE = /^Failed to load resource: the server responded with a status of \d{3}/;

/**
 * What every browser context of the suite is checked for, during the whole test (plan step 11):
 * - every request goes to the proxy origin and only to `/admin-ui` (the SPA's files), `/admin/*` (the API) or, as an IMAGE
 *   load, `/media/*` (uploaded images, served by the API through the proxy): the SPA calls nothing else, no third party, no
 *   `/store`; a script, fetch or any other kind of request to `/media` is a problem;
 * - every write to `/admin/*` (POST, PUT, PATCH, DELETE) carries `X-Fluxkit-CSRF: 1`;
 * - no Content-Security-Policy violation (a `securitypolicyviolation` event or a "Refused to" console line), so no inline
 *   script ran and nothing external was loaded;
 * - no uncaught page error and no console error except Chromium's "Failed to load resource" line for an HTTP error status
 *   (and the errors one scenario names with `expectConsoleErrors`: the route chunk it breaks on purpose);
 * - the English `detail` of a problem answer never appears in the page's text (the SPA shows its own translated messages).
 * Only browser traffic is watched: `page.request` and API contexts (test setup) are not browser requests.
 */
export class Guard {
  readonly requests: { method: string; url: string; csrf: string | undefined }[] = [];
  private readonly problems: string[] = [];
  private readonly cspViolations: string[] = [];
  private readonly errors: string[] = [];
  private readonly pendingDetails: Promise<void>[] = [];
  private readonly details = new Set<string>();
  private readonly texts: string[] = [];
  /** Images of other hosts the page tried to load, and the image addresses the CSP refused (`img-src`). */
  private readonly foreignImages = new Set<string>();
  private readonly blockedImages = new Set<string>();
  private allowedCsp: RegExp | undefined;
  private allowedConsole: RegExp | undefined;
  private readonly allowedConsoleErrors: string[] = [];

  async watch(context: BrowserContext): Promise<void> {
    // Nothing of the suite may reach the internet: a request to another host is answered here, never sent.
    await context.route(
      (url) => url.origin !== ADMIN_E2E_ORIGIN,
      (route) => route.abort("blockedbyclient"),
    );
    await context.exposeBinding("__e2eText", (_source, texts: string) => {
      this.texts.push(...(JSON.parse(texts) as string[]));
    });
    await context.exposeBinding("__e2eCsp", (_source, text: string) => {
      this.recordCsp(text);
    });
    await context.addInitScript(() => {
      type Report = (text: string) => void;
      const scope = window as unknown as { __e2eText: Report; __e2eCsp: Report };
      document.addEventListener("securitypolicyviolation", (event) => {
        scope.__e2eCsp(`${event.effectiveDirective} blocked ${event.blockedURI}`);
      });
      // Every text node that is added or changed, one by one (a translated message is one text node; a detail the SPA
      // rendered would be its own node or part of one).
      new MutationObserver((records) => {
        const parts: string[] = [];
        const collect = (node: Node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            parts.push(node.textContent ?? "");
            return;
          }
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
            parts.push(text.textContent ?? "");
          }
        };
        for (const record of records) {
          if (record.type === "characterData") collect(record.target);
          for (const node of Array.from(record.addedNodes)) collect(node);
        }
        const texts = parts.map((part) => part.trim()).filter((part) => part !== "");
        if (texts.length > 0) scope.__e2eText(JSON.stringify(texts));
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    context.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol === "data:" || url.protocol === "blob:") return;
      const csrf = request.headers()["x-fluxkit-csrf"];
      this.requests.push({ method: request.method(), url: request.url(), csrf });
      if (url.origin !== ADMIN_E2E_ORIGIN) {
        // The seed's media and logos are on example.com, which the admin's CSP does not allow (`img-src 'self' data:`): the
        // SPA tries the preview, the CSP refuses it and the screen says so in text (apps/admin/README.md). Such an image is
        // accepted only if the CSP refused exactly that address (checked in verify); anything else is a problem.
        if (request.resourceType() === "image") this.foreignImages.add(request.url());
        else this.problems.push(`request to another origin: ${request.method()} ${request.url()}`);
        return;
      }
      const isSpa = url.pathname === SPA || url.pathname.startsWith(`${SPA}/`);
      const isApi = url.pathname === "/admin" || url.pathname.startsWith("/admin/");
      const isUploadedImage =
        url.pathname.startsWith("/media/") && request.resourceType() === "image";
      if (!isSpa && !isApi && !isUploadedImage) {
        this.problems.push(
          `request outside /admin-ui, /admin and image loads of /media: ${request.method()} ${url.pathname}`,
        );
      }
      if (isApi && !["GET", "HEAD"].includes(request.method()) && csrf !== "1") {
        this.problems.push(`write without X-Fluxkit-CSRF: ${request.method()} ${url.pathname}`);
      }
    });
    context.on("response", (response) => {
      const type = response.headers()["content-type"] ?? "";
      if (!type.includes("application/problem+json")) return;
      this.pendingDetails.push(
        response.json().then(
          (body: { detail?: unknown }) => {
            if (typeof body.detail === "string" && body.detail.trim() !== "") {
              this.details.add(body.detail);
            }
          },
          (error: unknown) => {
            // A problem answer that is not JSON is an API bug worth failing on.
            this.problems.push(
              `unreadable problem answer from ${response.url()}: ${String(error)}`,
            );
          },
        ),
      );
    });
    context.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (/Content Security Policy|Refused to/i.test(text)) {
        this.recordCsp(text);
        return;
      }
      if (NETWORK_STATUS_LINE.test(text)) return;
      if (this.allowedConsole?.test(text) === true) {
        this.allowedConsoleErrors.push(text);
        return;
      }
      this.errors.push(`console error: ${text}`);
    });
    context.on("weberror", (error) => {
      this.errors.push(`page error: ${error.error().message}`);
    });
  }

  /** The one scenario that provokes a CSP violation on purpose names it; any other violation still fails. */
  expectCspViolations(pattern: RegExp): void {
    this.allowedCsp = pattern;
  }

  /**
   * The one scenario that breaks a request on purpose (a route chunk that cannot be loaded) names the console errors it
   * expects; they are kept in `consoleErrors` for the test to count, and any other console error still fails.
   */
  expectConsoleErrors(pattern: RegExp): void {
    this.allowedConsole = pattern;
  }

  get consoleErrors(): readonly string[] {
    return this.allowedConsoleErrors;
  }

  get csp(): readonly string[] {
    return this.cspViolations;
  }

  private recordCsp(text: string): void {
    const image =
      /^img-src blocked (\S+)$/.exec(text) ??
      /^Refused to load the image '([^']+)' because it violates the following Content Security Policy directive: "img-src 'self' data:"/.exec(
        text,
      );
    if (image?.[1] !== undefined) {
      this.blockedImages.add(image[1]);
      return;
    }
    if (this.allowedCsp?.test(text) === true) {
      this.cspViolations.push(text);
      return;
    }
    this.problems.push(`CSP violation: ${text}`);
  }

  writes(): { method: string; url: string; csrf: string | undefined }[] {
    return this.requests.filter(
      (request) =>
        !["GET", "HEAD"].includes(request.method) &&
        new URL(request.url).pathname.startsWith("/admin/"),
    );
  }

  async verify(): Promise<void> {
    await Promise.all(this.pendingDetails);
    // A text node shows a detail when it contains it and is not one of the SPA's own messages: a few translated messages
    // happen to start with the API's English sentence ("The product cannot be published yet. Fix these and publish
    // again:"), and those are the SPA's text, not the detail.
    const shown = [...this.details].filter((detail) =>
      this.texts.some((text) => text.includes(detail.trim()) && !SPA_MESSAGES.has(text)),
    );
    const loadedImages = [...this.foreignImages].filter((url) => !this.blockedImages.has(url));
    const blockedNotRequested = [...this.blockedImages].filter(
      (url) => !url.startsWith("https://example.com/"),
    );
    expect(loadedImages, "an image of another host that the CSP did NOT refuse").toEqual([]);
    expect(blockedNotRequested, "only the seed's example.com images may be refused").toEqual([]);
    expect(this.problems, "requests, CSRF and CSP").toEqual([]);
    expect(this.errors, "console and page errors").toEqual([]);
    expect(shown, "the API's problem detail must never be shown").toEqual([]);
  }
}

interface Fixtures {
  /** The checks of `Guard` on the test's default browser context (and on every context `openAs` creates). */
  guard: Guard;
  /** A browser page signed in as `role` through the API (the sign-in screen has its own scenarios), at the start page. */
  signIn: (role: Role, page?: Page) => Promise<Page>;
  /** A second browser context (own cookies, own client address), signed in as `role`, guarded like the first. */
  openAs: (role: Role) => Promise<Page>;
  /** The owner on the API, own cookies and address: test setup and checks. */
  owner: AdminApi;
  /** A shopper on the store API, own cookies and address: orders and customers for the admin to work on. */
  shopper: StoreApi;
  /** A new API context with its own client address; disposed after the test. */
  apiContext: (role: string) => Promise<APIRequestContext>;
}

export const test = base.extend<Fixtures>({
  // `baseURL` doubles as a guard: the marker means something to the proxy only, so the suite must never be pointed at
  // another origin.
  extraHTTPHeaders: async ({ baseURL }, use, testInfo) => {
    if (baseURL !== ADMIN_E2E_ORIGIN) {
      throw new Error(
        `The admin e2e suite talks to the proxy at ${ADMIN_E2E_ORIGIN}, not to ${String(baseURL)}.`,
      );
    }
    await use({ "x-e2e-client": clientMarker(testInfo.testId, testInfo.retry) });
  },
  guard: async ({ context }, use) => {
    const guard = new Guard();
    await guard.watch(context);
    await use(guard);
    await guard.verify();
  },
  // Every test is guarded, also those that never name the fixture.
  page: async ({ page, guard }, use) => {
    expect(guard).toBeDefined();
    await use(page);
  },
  signIn: async ({ page }, use) => {
    await use(async (role, target = page) => {
      const { email, password } = CREDENTIALS[role];
      await AdminApi.signIn(target.context().request, email, password);
      await target.goto(`${SPA}/`);
      await expect(target.getByRole("button", { name: "Sign out" })).toBeVisible();
      return target;
    });
  },
  openAs: async ({ browser, guard }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    await use(async (role) => {
      const context = await browser.newContext({
        baseURL: ADMIN_E2E_ORIGIN,
        locale: "en-US",
        timezoneId: "UTC",
        extraHTTPHeaders: {
          "x-e2e-client": clientMarker(testInfo.testId, testInfo.retry, `browser-${role}`),
        },
      });
      contexts.push(context);
      await guard.watch(context);
      const page = await context.newPage();
      const { email, password } = CREDENTIALS[role];
      await AdminApi.signIn(context.request, email, password);
      await page.goto(`${SPA}/`);
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
      return page;
    });
    for (const context of contexts) await context.close();
  },
  apiContext: async ({ playwright }, use, testInfo) => {
    const contexts: APIRequestContext[] = [];
    await use(async (role) => {
      const context = await newApiContext(
        playwright,
        clientMarker(testInfo.testId, testInfo.retry, role),
      );
      contexts.push(context);
      return context;
    });
    for (const context of contexts) await context.dispose();
  },
  owner: async ({ apiContext }, use) => {
    await use(await AdminApi.signIn(await apiContext("owner-api"), OWNER_EMAIL, OWNER_PASSWORD));
  },
  shopper: async ({ apiContext }, use) => {
    await use(new StoreApi(await apiContext("shopper")));
  },
});

export function newApiContext(
  playwright: PlaywrightWorkerArgs["playwright"],
  marker: string,
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL: ADMIN_E2E_ORIGIN,
    extraHTTPHeaders: { "x-e2e-client": marker },
  });
}
