import type { ConsoleMessage, Request } from "@playwright/test";
import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import {
  fillCheckoutForm,
  orderNumberOnPage,
  tokenOf,
  waitForHydration,
} from "../support/flows.ts";

const pathOf = (url: string): string => new URL(url).pathname;

interface Seen {
  /** Where the flow was when the request started: after the order page was loaded from the address bar, or before. */
  phase: "flow" | "after-reload";
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

test("the guest order token never appears in a URL, a header, the page source, the title, storage or the console", async ({
  page,
  context,
}, testInfo) => {
  const requests: Seen[] = [];
  const responses: Seen[] = [];
  const consoleLines: string[] = [];
  // `allHeaders()` is the complete set, including what the browser adds itself (Referer, Cookie), but Playwright resolves
  // it only when Chromium reports the raw headers of a request that got its response. For a request that is still in
  // flight, or that was cancelled by the next navigation (the reload and the language switch below cancel prefetches), it
  // can stay pending until the test times out. So a request is only read with `allHeaders()` once it has FINISHED; one that
  // failed or is still in flight when recording stops is judged with `headers()` (what Playwright itself knows, without
  // Referer and Cookie) and is counted, so the loss of coverage is visible. The token is in no cookie (checked below with
  // `context.cookies()`) and a Referer never has a fragment, so those two headers cannot carry it either way.
  const inFlight = new Map<Request, Pick<Seen, "phase" | "url" | "body">>();
  const pending: Promise<void>[] = [];
  let withoutRawHeaders = 0;
  let phase: Seen["phase"] = "flow";
  const onRequest = (request: Request) => {
    inFlight.set(request, { phase, url: request.url(), body: request.postData() });
  };
  const judgeWithoutRawHeaders = async (request: Request, failed: boolean): Promise<void> => {
    const started = inFlight.get(request);
    if (started === undefined) return;
    inFlight.delete(request);
    withoutRawHeaders += 1;
    requests.push({ ...started, headers: request.headers() });
    // Settles at once for a FAILED request (null when no response came); for one in flight it would wait, so it is not asked.
    const response = failed ? await request.response() : null;
    if (response !== null) {
      responses.push({ ...started, url: response.url(), headers: response.headers(), body: null });
    }
  };
  const onRequestFinished = (request: Request) => {
    const started = inFlight.get(request);
    if (started === undefined) return;
    inFlight.delete(request);
    pending.push(
      (async () => {
        const response = await request.response();
        const headers = await request.allHeaders();
        requests.push({ ...started, headers });
        if (response === null)
          throw new Error(`a finished request has no response: ${started.url}`);
        const [responseHeaders, body] = await Promise.all([
          response.allHeaders(),
          request.isNavigationRequest() ? response.text() : null,
        ]);
        responses.push({ ...started, url: response.url(), headers: responseHeaders, body });
      })(),
    );
  };
  const onRequestFailed = (request: Request) => {
    pending.push(judgeWithoutRawHeaders(request, true));
  };
  const onConsole = (message: ConsoleMessage) => {
    consoleLines.push(`${message.text()} ${message.location().url}`);
  };
  const onPageError = (error: Error) => {
    consoleLines.push(`${error.message} ${error.stack ?? ""}`);
  };
  page.on("request", onRequest);
  page.on("requestfinished", onRequestFinished);
  page.on("requestfailed", onRequestFailed);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  // The whole guest flow, from the product page (a digital product: no address to fill).
  await page.goto("/en/p/demo-e-book");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("link", { name: "Go to the cart" }).click();
  await page.getByRole("link", { name: "Checkout" }).click();
  await fillCheckoutForm(page, { email: uniqueEmail(testInfo, "hygiene") });
  await page.getByRole("button", { name: "Place the order" }).click();
  await expect(page).toHaveURL(/\/en\/order\/[^#?]+#t=[A-Za-z0-9_-]{16,}$/);
  const token = tokenOf(page.url());
  const number = await orderNumberOnPage(page);

  // Loading the order page again from the address bar, the way a bookmark does: the server HTML is the reference.
  phase = "after-reload";
  const [navigation] = await Promise.all([
    page.waitForResponse((response) => response.request().isNavigationRequest()),
    page.reload(),
  ]);
  await expect(page.getByRole("heading", { level: 1, name: `Order ${number}` })).toBeVisible();
  const html = await navigation.text();
  expect(html).not.toContain(token);
  expect(html, "the order page is rendered for this number").toContain("noindex");
  expect(navigation.headers()["referrer-policy"]).toBe("no-referrer");
  expect(await page.title()).not.toContain(token);
  expect(await page.title()).not.toContain(number);

  // A language switch is a full navigation that carries the fragment and nothing else.
  await page.getByRole("link", { name: "Українська" }).click();
  await expect(page).toHaveURL(new RegExp(`/uk/order/${number}#t=${token}$`));
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(number) })).toBeVisible();

  // Stop recording, then wait for every pending read of headers and bodies before judging.
  page.off("request", onRequest);
  page.off("requestfinished", onRequestFinished);
  page.off("requestfailed", onRequestFailed);
  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  await Promise.all(pending);
  // Whatever never finished is judged without raw headers, after everything else has settled.
  await Promise.all([...inFlight.keys()].map((request) => judgeWithoutRawHeaders(request, false)));
  // Most of the traffic must have been read completely, or the header checks below would be hollow.
  expect(requests.length - withoutRawHeaders, "requests read with allHeaders()").toBeGreaterThan(
    10,
  );
  const lookups = requests.filter((seen) => pathOf(seen.url) === "/store/orders/lookup");
  // Positive control: the token IS sent, in the body of a POST, so the checks below look at real traffic.
  expect(lookups.length).toBeGreaterThanOrEqual(2);
  for (const lookup of lookups) expect(lookup.body).toContain(token);
  // `Referrer-Policy` belongs to a DOCUMENT: after a hard load of the order page (the bookmark case) its own requests carry
  // no Referer at all. (Straight after the checkout the page is reached by a client-side navigation, so the policy of the
  // checkout document still applies until the next hard load; a Referer never has a fragment, so the token is safe either way.)
  const afterReload = lookups.filter((seen) => seen.phase === "after-reload");
  expect(afterReload.length).toBeGreaterThanOrEqual(1);
  for (const lookup of afterReload) {
    expect(
      lookup.headers["referer"],
      "no Referer on a request of the reloaded order page",
    ).toBeUndefined();
  }
  expect(requests.length).toBeGreaterThan(10);

  for (const seen of requests) {
    expect(seen.url, "request URL").not.toContain(token);
    expect(JSON.stringify(seen.headers), `headers of ${seen.url}`).not.toContain(token);
    if (!["/store/orders/lookup", "/store/orders/cancel"].includes(pathOf(seen.url))) {
      expect(seen.body ?? "", `body of ${seen.url}`).not.toContain(token);
    }
  }
  for (const seen of responses) {
    expect(seen.url, "response URL").not.toContain(token);
    expect(JSON.stringify(seen.headers), `response headers of ${seen.url}`).not.toContain(token);
    expect(seen.body ?? "", `document ${seen.url}`).not.toContain(token);
  }
  expect(consoleLines.join("\n")).not.toContain(token);

  // Not stored anywhere the browser keeps data: cookies, localStorage, sessionStorage.
  const cookies = await context.cookies();
  expect(JSON.stringify(cookies)).not.toContain(token);
  const storage = await page.evaluate(() =>
    JSON.stringify([
      Object.entries(window.localStorage),
      Object.entries(window.sessionStorage),
      document.title,
    ]),
  );
  expect(storage).not.toContain(token);
});
