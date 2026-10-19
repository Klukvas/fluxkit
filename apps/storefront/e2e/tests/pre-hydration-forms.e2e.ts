import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import { waitForHydration } from "../support/flows.ts";

const SECRET = "S3cret-Passw0rd!";

/** Every URL a page or request touched must be free of the secret and of the email (query string, path, fragment). */
function leaks(urls: readonly string[], email: string): string[] {
  return urls.filter(
    (url) =>
      /password=|S3cret|firstName=|phone=/i.test(url) ||
      url.includes(encodeURIComponent(email)) ||
      url.includes(email),
  );
}

test.describe("before hydration, nothing personal reaches a URL (review H1)", () => {
  test.describe("JavaScript off: the browser submits natively", () => {
    test.use({ javaScriptEnabled: false });

    test("the sign-in form posts, the address stays clean and the page comes back", async ({
      page,
    }, testInfo) => {
      const email = uniqueEmail(testInfo, "nojs-login");
      const urls: string[] = [];
      const statuses: number[] = [];
      page.on("request", (request) => urls.push(request.url()));
      page.on("framenavigated", (frame) => urls.push(frame.url()));
      page.on("response", (response) => {
        if (response.request().resourceType() === "document") statuses.push(response.status());
      });
      await page.goto("/en/account/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(SECRET);
      await page.getByLabel("Password", { exact: true }).press("Enter");
      await page.waitForLoadState("load");
      await expect.poll(() => statuses.length).toBeGreaterThanOrEqual(2);

      expect(leaks(urls, email)).toEqual([]);
      expect(page.url()).toMatch(/\/en\/account\/login$/);
      expect(
        statuses.every((status) => status < 500),
        `statuses ${statuses.join(",")}`,
      ).toBe(true);
      // The response never echoes what was sent.
      const html = await page.content();
      expect(html).not.toContain(SECRET);
      expect(html).not.toContain(email);
    });

    test("the register form posts too (email, password, name and phone stay out of the URL)", async ({
      page,
    }, testInfo) => {
      const email = uniqueEmail(testInfo, "nojs-register");
      const urls: string[] = [];
      page.on("request", (request) => urls.push(request.url()));
      page.on("framenavigated", (frame) => urls.push(frame.url()));
      await page.goto("/en/account/register");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(SECRET);
      await page.getByLabel("First name", { exact: true }).fill("Olena");
      await page.getByLabel("Last name", { exact: true }).fill("Petrenko");
      await page.getByLabel(/^Phone/).fill("+380501112233");
      await page.getByLabel(/^Phone/).press("Enter");
      await page.waitForLoadState("load");

      expect(leaks(urls, email)).toEqual([]);
      expect(page.url()).toMatch(/\/en\/account\/register$/);
      const html = await page.content();
      expect(html).not.toContain(SECRET);
      expect(html).not.toContain(email);
    });
  });

  test("scripts delayed: a submit before hydration puts nothing in a URL or a Referer", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, "late-js");
    const urls: string[] = [];
    const referers: string[] = [];
    page.on("request", (request) => {
      urls.push(request.url());
      const referer = request.headers()["referer"];
      if (referer !== undefined) referers.push(referer);
    });
    page.on("framenavigated", (frame) => urls.push(frame.url()));
    // Hold every script of the page back, so the form is on screen but not yet alive.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/_next/static/**/*.js", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/en/account/login", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(SECRET);
    await page.getByLabel("Password", { exact: true }).press("Enter");
    await page.waitForLoadState("domcontentloaded");
    release();
    await page.waitForLoadState("load");
    await waitForHydration(page);
    // Requests the hydrated page makes (cart, session) must not carry a dirty Referer either.
    await expect.poll(() => referers.length).toBeGreaterThan(0);

    expect(leaks(urls, email)).toEqual([]);
    expect(leaks(referers, email)).toEqual([]);
    expect(page.url()).toMatch(/\/en\/account\/login$/);
  });
});
