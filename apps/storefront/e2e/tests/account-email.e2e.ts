import type { Page } from "@playwright/test";
import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import { waitForHydration } from "../support/flows.ts";
import { inLocale, linksTo, mailCount, newestLink } from "../support/mailbox.ts";

const OLD_PASSWORD = "the old e2e password 123";
const NEW_PASSWORD = "the brand new e2e password 456";
/** A well-formed token no mail ever held: the API answers `invalid_or_expired` for it. */
const UNKNOWN_TOKEN = "Zm9yLXRlc3RzLW9ubHktbm90LWEtcmVhbC10b2tlbi0wMDAw";

/** The visible text of the page's `main`, for comparing two answers word for word. */
async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").innerText()).replace(/\s+/g, " ").trim();
}

test("forgot password, reset link, new password, sign in: the old password stops working and the link works once", async ({
  page,
  shopper,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "reset");
  await shopper.register(email, OLD_PASSWORD);
  await shopper.logout();

  // From the sign-in page: the link is there because the shop sends email.
  await page.goto("/en/account/login");
  await waitForHydration(page);
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page).toHaveURL(/\/en\/account\/forgot-password$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Forgot your password?" }),
  ).toBeVisible();
  await waitForHydration(page);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send the link" }).click();

  // The neutral answer takes the focus; it names no address and no account.
  const sent = page.getByRole("heading", { level: 1, name: "Check your email" });
  await expect(sent).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "If an account exists" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(email);

  // The mail the fake provider captured: open its link.
  const link = await newestLink(email, "reset-password");
  expect(link.locale).toBe("en");
  await page.goto(link.url);
  await expect(page.getByRole("heading", { level: 1, name: "Set a new password" })).toBeVisible();
  // The token is out of the address bar at once, and out of the history entry too.
  await expect(page).toHaveURL(/\/en\/account\/reset-password$/);
  expect(page.url()).not.toContain("#");
  expect(await page.evaluate(() => window.location.hash)).toBe("");

  // A mismatch is caught in the form (no request), the API's policy is shown on the field.
  const newPassword = page.getByLabel("New password", { exact: true });
  const repeat = page.getByLabel("Repeat the new password", { exact: true });
  await newPassword.fill(NEW_PASSWORD);
  await repeat.fill(`${NEW_PASSWORD}x`);
  await page.getByRole("button", { name: "Save the new password" }).click();
  await expect(page.getByText("The passwords do not match.").first()).toBeVisible();
  await expect(repeat).toBeFocused();
  await expect(repeat).toHaveAttribute("aria-invalid", "true");
  await newPassword.fill("short");
  await repeat.fill("short");
  await page.getByRole("button", { name: "Save the new password" }).click();
  await expect(page.getByText("The value is too short.").first()).toBeVisible();
  await expect(newPassword).toBeFocused();

  // The right one: neutral confirmation, no automatic sign-in, a link to the sign-in page.
  await newPassword.fill(NEW_PASSWORD);
  await repeat.fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Save the new password" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Password changed" })).toBeFocused();
  await expect(page.getByRole("link", { name: /^Account:/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Go to sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await waitForHydration(page);

  // The old password no longer works; the new one does.
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(OLD_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("The email or password is not correct.")).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/account$/);
  await expect(page.getByRole("link", { name: "Account: Api" })).toBeVisible();

  // The link is single use. The page cannot know that before the API says so: the form shows, the submit turns it into the
  // one "does not work" state (no sign-in link was followed, so the shopper is still signed in with the new password).
  await page.goto(link.url);
  await expect(page.getByRole("heading", { level: 1, name: "Set a new password" })).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill(`${NEW_PASSWORD}2`);
  await page.getByLabel("Repeat the new password", { exact: true }).fill(`${NEW_PASSWORD}2`);
  await page.getByRole("button", { name: "Save the new password" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "This link does not work" }),
  ).toBeFocused();
  await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute(
    "href",
    "/en/account/forgot-password",
  );
  await expect(page).toHaveURL(/\/en\/account\/reset-password$/);
});

test("the forgot-password answer is the same for an address with an account and one without, and only the first gets a mail", async ({
  page,
  shopper,
}, testInfo) => {
  const known = uniqueEmail(testInfo, "known");
  const unknown = uniqueEmail(testInfo, "unknown");
  await shopper.register(known, OLD_PASSWORD);
  await shopper.logout();
  const answers: string[] = [];
  for (const address of [known, unknown]) {
    await page.goto("/en/account/forgot-password");
    await waitForHydration(page);
    await page.getByLabel("Email", { exact: true }).fill(address);
    await page.getByRole("button", { name: "Send the link" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeFocused();
    answers.push(await mainText(page));
  }
  expect(answers[1]).toBe(answers[0]);
  expect(answers[0]).not.toContain("@");
  // The mail of the known address arrives; the unknown one never gets any.
  await newestLink(known, "reset-password");
  expect(mailCount(unknown)).toBe(0);
});

test("a reset link that is missing, malformed or unknown shows the one 'does not work' state, and the fragment is scrubbed anyway", async ({
  page,
}) => {
  await page.goto("/en/account/reset-password");
  await expect(
    page.getByRole("heading", { level: 1, name: "This link does not work" }),
  ).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);

  await page.goto("/en/account/reset-password#t=not%20a%20token");
  await expect(
    page.getByRole("heading", { level: 1, name: "This link does not work" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/en\/account\/reset-password$/);

  // Well formed but unknown: the form is shown, and the API's answer turns it into the same state.
  await page.goto(`/uk/account/reset-password#t=${UNKNOWN_TOKEN}`);
  await expect(page.getByRole("heading", { level: 1, name: "Новий пароль" })).toBeVisible();
  await expect(page).toHaveURL(/\/uk\/account\/reset-password$/);
  await page.getByLabel("Новий пароль", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Повторіть новий пароль", { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Зберегти новий пароль" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Посилання не працює" })).toBeFocused();
  await expect(page.getByRole("link", { name: "Запросити нове посилання" })).toBeVisible();
});

test("email verification: the notice, send again, the newest link confirms, the older one is replaced, a used link stays harmless", async ({
  page,
  shopper,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "verify");
  // Registering mails the first link and signs the browser in (the page shares the cookie jar).
  await shopper.register(email, OLD_PASSWORD);
  const first = await newestLink(email, "verify-email");

  await page.goto("/en/account");
  await expect(page.getByText("Confirm your email address")).toBeVisible();
  await page.getByRole("button", { name: "Send the link again" }).click();
  await expect(page.getByText("A new link was sent. Older links no longer work.")).toBeVisible();
  const second = await newestLink(email, "verify-email", 2);
  expect(second.token).not.toBe(first.token);

  // The older link was replaced: signed in, the page offers a new one.
  await page.goto(inLocale(first, "en"));
  await expect(
    page.getByRole("heading", { level: 1, name: "This link does not work" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/en\/account\/verify-email$/);
  await expect(page.getByRole("button", { name: "Send the link again" })).toBeVisible();

  // The newest one confirms, once, on load; the fragment is gone.
  const confirms: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/store/account/verify-email")) confirms.push(request.method());
  });
  await page.goto(inLocale(second, "en"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Email address confirmed" }),
  ).toBeFocused();
  await expect(page).toHaveURL(/\/en\/account\/verify-email$/);
  expect(confirms).toEqual(["POST"]);

  // The notice is gone from the account page and the address is marked confirmed.
  await page.getByRole("link", { name: "Go to my account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "My account" })).toBeVisible();
  await expect(page.getByText("Confirm your email address")).toHaveCount(0);
  await expect(page.getByText("Email address confirmed")).toBeVisible();

  // A used link of a verified customer is not an error.
  await page.goto(inLocale(second, "en"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Email address confirmed" }),
  ).toBeVisible();
  // Even the replaced link is harmless now that the address is confirmed (the API answers 204 for a confirmed customer).
  await page.goto(inLocale(first, "en"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Email address confirmed" }),
  ).toBeVisible();
  expect(linksTo(email, "verify-email")).toHaveLength(2);
});

test("a verification link opened by a guest or with an unknown token explains itself and offers to sign in", async ({
  page,
}) => {
  await page.goto(`/en/account/verify-email#t=${UNKNOWN_TOKEN}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "This link does not work" }),
  ).toBeVisible();
  await expect(page.getByText("Sign in to request a new link.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true }).last()).toHaveAttribute(
    "href",
    /^\/en\/account\/login/,
  );
  await expect(page).toHaveURL(/\/en\/account\/verify-email$/);
});

test("the three pages send no Referer, and a link's token reaches no URL, header, console line or request but the confirm call", async ({
  page,
  shopper,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "hygiene");
  await shopper.register(email, OLD_PASSWORD);
  await shopper.logout();
  await page.request.post("/store/account/password-reset", {
    headers: { "X-Fluxkit-CSRF": "1" },
    data: { email, locale: "en" },
  });
  const link = await newestLink(email, "reset-password");

  for (const route of ["forgot-password", "reset-password", "verify-email"]) {
    const response = await page.goto(`/en/account/${route}`);
    expect(response?.headers()["referrer-policy"], route).toBe("no-referrer");
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  }

  const urls: string[] = [];
  const bodies: { url: string; body: string | null }[] = [];
  const consoleLines: string[] = [];
  page.on("request", (request) => {
    urls.push(request.url());
    bodies.push({ url: request.url(), body: request.postData() });
  });
  page.on("console", (message) => consoleLines.push(message.text()));
  page.on("pageerror", (error) => consoleLines.push(error.message));
  const html = await (await page.request.get(link.url)).text();
  expect(html).not.toContain(link.token);

  await page.goto(link.url);
  await expect(page.getByRole("heading", { level: 1, name: "Set a new password" })).toBeVisible();
  await expect(page).toHaveURL(/\/en\/account\/reset-password$/);
  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Repeat the new password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Save the new password" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Password changed" })).toBeVisible();

  // Page requests (documents, scripts, API calls) carry the token only where the confirm call's body does.
  for (const url of urls.filter(
    (candidate) => !candidate.endsWith(link.url.split("#")[0] as string),
  )) {
    expect(url).not.toContain(link.token);
  }
  const carriers = bodies.filter((entry) => entry.body?.includes(link.token) === true);
  expect(carriers.map((entry) => new URL(entry.url).pathname)).toEqual([
    "/store/account/password-reset/confirm",
  ]);
  for (const line of consoleLines) {
    expect(line).not.toContain(link.token);
    expect(line).not.toContain(NEW_PASSWORD);
  }
  expect(await page.title()).not.toContain(link.token);
  expect(JSON.stringify(await page.context().cookies())).not.toContain(link.token);
  expect(
    await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }])),
  ).not.toContain(link.token);
});
