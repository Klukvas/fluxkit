import type { APIRequestContext, Locator, Page, Response } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { AdminApi, CSRF } from "../support/api.ts";
import { ADMIN_E2E_ORIGIN, OWNER_PASSWORD, SPA, clientMarker } from "../support/env.ts";
import { expect, test, unique } from "../support/fixtures.ts";

/**
 * The Integrations area (ADR 0058, slice 1). Every scenario signs in as an owner of its own: the API allows five password
 * re-entries per admin in 15 minutes (failed ones included), so a scenario that shared the suite's owner would spend the
 * budget of the others and of its own retry. No scenario asks for a password more than four times. Creating that own
 * owner spends ONE re-entry of the suite's owner (ADR 0058 covers the owner operations too), so the three scenarios
 * here use three of their five; a full retry of all three would exhaust it. The integrations themselves are shared
 * (one fake email provider), so every scenario first removes a key an earlier one left stored.
 */

const PROVIDER = "Test provider (fake)";
const INACTIVE_NOTICE = "Saved keys stay off until activated";

interface SecretView {
  field: string;
  state: "not_set" | "set" | "env";
  versionId: string | null;
  generation: number | null;
}
interface IntegrationView {
  id: string;
  kind: string;
  providerCode: string;
  enabled: boolean;
  secrets: SecretView[];
}
interface IntegrationList {
  revision: number;
  storage: string;
  items: IntegrationView[];
}

interface OwnOwner {
  email: string;
  password: string;
}

/** A valid key of the fake email provider (`^fake_[A-Za-z0-9]{8,64}$`), made for this test only. */
const fakeKey = () => `fake_${randomBytes(12).toString("hex")}`;

async function createOwner(owner: AdminApi, suffix: string): Promise<OwnOwner> {
  const account = {
    email: `e2e-integrations-${suffix}@example.com`,
    password: `e2e-${randomBytes(12).toString("hex")}-Pw`,
  };
  // Creating an owner asks the suite's owner for their own password (ADR 0058).
  await owner.createUser(account.email, "owner", account.password, OWNER_PASSWORD);
  return account;
}

async function signInAs(page: Page, account: OwnOwner): Promise<void> {
  await AdminApi.signIn(page.context().request, account.email, account.password);
  await page.goto(`${SPA}/`);
  await expect(page.getByRole("button", { name: "Account menu", exact: true })).toBeVisible();
}

async function fakeEmail(
  api: AdminApi,
): Promise<{ revision: number; integration: IntegrationView }> {
  const list = await api.get<IntegrationList>("/admin/integrations");
  const integration = list.items.find(
    (item) => item.kind === "email" && item.providerCode === "fake",
  );
  if (integration === undefined) throw new Error("The fake email provider is not listed.");
  return { revision: list.revision, integration };
}

const secretOf = (integration: IntegrationView, field: string) =>
  integration.secrets.find((secret) => secret.field === field);

/** The fake provider's API key back to "Not set" (one password re-entry, only when a key is stored). */
async function removeStoredApiKey(api: AdminApi, account: OwnOwner): Promise<void> {
  const { revision, integration } = await fakeEmail(api);
  const versionId = secretOf(integration, "api_key")?.versionId ?? null;
  if (versionId === null) return;
  await api.post(
    `/admin/integrations/${integration.id}/retire-secret`,
    { expectedRevision: revision, versionId, currentPassword: account.password },
    200,
  );
}

/** The provider's card and the row of one of its credentials. */
function card(page: Page): Locator {
  return page.getByRole("main").getByRole("region", { name: PROVIDER, exact: true });
}
/** A key row: a list item outside the version list, which names the saved fields too. */
function row(page: Page, field: string): Locator {
  return card(page)
    .locator('li:not(ul[aria-label="Saved key versions"] li)')
    .filter({ hasText: field });
}

/** Every value an input of the page holds right now. */
function inputValues(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("input, textarea")].map(
      (element) => (element as HTMLInputElement).value,
    ),
  );
}

/**
 * The route choice stays on the screen: two radios and an empty password. A secret dialog's own inputs come after
 * these, and a closed dialog must leave exactly these.
 */
const ROUTE_INPUTS = ["equal", "resend", ""];

test("the owner stores, replaces nothing by accident and removes a provider key; the value never comes back", async ({
  page,
  owner,
  apiContext,
}, testInfo) => {
  const account = await createOwner(owner, unique(testInfo));
  const api = await AdminApi.signIn(await apiContext("own-owner"), account.email, account.password);
  await removeStoredApiKey(api, account);
  const key = fakeKey();

  // Every answer of the integrations routes the browser receives during the scenario, to prove none carries the key.
  const answers: Promise<string>[] = [];
  page.on("response", (response: Response) => {
    if (new URL(response.url()).pathname.startsWith("/admin/integrations")) {
      answers.push(response.text().catch(() => ""));
    }
  });

  await signInAs(page, account);
  await page
    .getByRole("navigation", { name: "Admin sections" })
    .getByRole("link", { name: "Integrations", exact: true })
    .click();
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Integrations" })).toBeVisible();
  await expect(main.getByText(INACTIVE_NOTICE, { exact: true })).toBeVisible();
  await expect(
    main.getByText(/Email, payment and delivery providers can be turned on here/),
  ).toBeVisible();
  await expect(main.getByText("Keys cannot be saved on this server")).toHaveCount(0);

  const apiKey = row(page, "API key");
  await expect(apiKey.getByText("Not set", { exact: true })).toBeVisible();
  await expect(apiKey.getByRole("button", { name: /^Remove/ })).toHaveCount(0);

  // A value set on the server: read-only, with the variable's name and nothing to enter.
  const webhook = row(page, "Webhook secret");
  await expect(webhook.getByText("Set on the server", { exact: true })).toBeVisible();
  await expect(webhook).toContainText("FAKE_EMAIL_WEBHOOK_SECRET");
  await expect(webhook).toContainText("read-only");
  await expect(webhook.getByRole("button")).toHaveCount(0);

  // 1. A value that is not a key of this provider: refused on the key field; the API's English reason is not shown.
  await apiKey.getByRole("button", { name: `Enter key: API key, ${PROVIDER}` }).click();
  const dialog = page.getByRole("dialog", { name: `Enter the key: API key, ${PROVIDER}` });
  await expect(dialog).toBeVisible();
  const keyInput = dialog.getByLabel("Key", { exact: true });
  const passwordInput = dialog.getByLabel("Your current password", { exact: true });
  await expect(keyInput).toHaveAttribute("type", "password");
  await expect(keyInput).toHaveAttribute("autocomplete", "off");
  await expect(passwordInput).toHaveAttribute("type", "password");
  await expect(passwordInput).toHaveAttribute("autocomplete", "off");
  await keyInput.fill("not-a-key-of-this-provider");
  await passwordInput.fill(account.password);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    dialog.getByText(
      "This does not look like a key of this service. Check that you copied the right value.",
    ),
  ).toBeVisible();
  await expect(keyInput).toHaveValue("");
  await expect(passwordInput).toHaveValue("");

  // 2. A wrong password: the error is on the password field and nothing is stored.
  await keyInput.fill(`  ${key}  `);
  await passwordInput.fill(`${account.password}-wrong`);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByText("The password is not correct. Nothing was changed.")).toBeVisible();
  await expect(passwordInput).toHaveAttribute("aria-invalid", "true");
  await expect(keyInput).toHaveValue("");
  await expect(passwordInput).toHaveValue("");
  expect(secretOf((await fakeEmail(api)).integration, "api_key")?.state).toBe("not_set");

  // 3. The key (with spaces around it, as a paste brings) and the right password.
  await keyInput.fill(`  ${key}  `);
  await passwordInput.fill(account.password);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    main.getByText("The key is saved. It stays off until it is activated."),
  ).toBeVisible();

  // The suite's API sets EMAIL_PROVIDER, so turning the saved key on is refused before the password is checked.
  await main.getByRole("button", { name: `Turn on ${PROVIDER}` }).click();
  const turnOn = page.getByRole("dialog", { name: `Turn on ${PROVIDER}` });
  await expect(turnOn.getByLabel("Key", { exact: true })).toHaveCount(0);
  await turnOn.getByLabel("Your current password", { exact: true }).fill(account.password);
  await turnOn.getByRole("button", { name: "Turn on", exact: true }).click();
  await expect(
    turnOn.getByText("The server already sets this, so it cannot be changed or turned on here."),
  ).toBeVisible();
  await turnOn.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(turnOn).toBeHidden();
  expect((await fakeEmail(api)).integration).toMatchObject({ enabled: false });
  await expect(apiKey.getByText("Saved, not active yet", { exact: true })).toBeVisible();
  await expect(apiKey).toContainText(/Saved \w/);
  await expect(apiKey.getByRole("button", { name: /^Replace the saved key/ })).toBeVisible();
  const stored = secretOf((await fakeEmail(api)).integration, "api_key");
  expect(stored?.state).toBe("set");
  expect(stored?.versionId).not.toBeNull();

  // 4. After a full reload the value is nowhere: not in the text, not in the markup, not in an input.
  await page.reload();
  await expect(apiKey.getByText("Saved, not active yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(key);
  expect(await page.content()).not.toContain(key);
  expect(await inputValues(page)).toEqual(ROUTE_INPUTS);

  // 5. Remove, with the password again.
  await apiKey.getByRole("button", { name: `Remove the saved key: API key, ${PROVIDER}` }).click();
  const removal = page.getByRole("dialog", { name: `Remove the saved key: API key, ${PROVIDER}` });
  await expect(removal).toBeVisible();
  await expect(removal.getByLabel("Key", { exact: true })).toHaveCount(0);
  await removal.getByLabel("Your current password", { exact: true }).fill(account.password);
  await removal.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(removal).toBeHidden();
  await expect(main.getByText("The saved key is removed.")).toBeVisible();
  await expect(apiKey.getByText("Not set", { exact: true })).toBeVisible();
  expect(secretOf((await fakeEmail(api)).integration, "api_key")).toMatchObject({
    state: "not_set",
    versionId: null,
  });

  const bodies = await Promise.all(answers);
  // The list (twice at least), the refused saves, the save and the removal.
  expect(bodies.length).toBeGreaterThanOrEqual(6);
  for (const body of bodies) {
    expect(body).not.toContain(key);
    expect(body).not.toContain(account.password);
  }
});

for (const role of ["manager", "viewer"] as const) {
  test(`the ${role} has no Integrations entry, no screen and no API access`, async ({
    page,
    signIn,
  }) => {
    await signIn(role);
    const nav = page.getByRole("navigation", { name: "Admin sections" });
    await expect(nav.getByRole("link", { name: "Start", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Integrations" })).toHaveCount(0);

    const context: APIRequestContext = page.context().request;
    const read = await context.get("/admin/integrations");
    expect(read.status()).toBe(403);
    expect(await read.text()).not.toContain("providerCode");
    const write = await context.put(
      "/admin/integrations/00000000-0000-4000-8000-000000000000/secrets/api_key",
      { headers: CSRF, data: { expectedRevision: 0, value: "x", currentPassword: "x" } },
    );
    expect(write.status()).toBe(403);

    await page.goto(`${SPA}/integrations`);
    await expect(page.getByRole("heading", { level: 1, name: "Not allowed" })).toBeVisible();
    await expect(page.getByText(INACTIVE_NOTICE)).toHaveCount(0);
  });
}

test("a change made elsewhere meanwhile: the save is refused, the list is read again and the owner is told to try again", async ({
  page,
  owner,
  apiContext,
}, testInfo) => {
  const account = await createOwner(owner, unique(testInfo));
  const elsewhere = await AdminApi.signIn(
    await apiContext("own-owner"),
    account.email,
    account.password,
  );
  await removeStoredApiKey(elsewhere, account);
  await signInAs(page, account);
  await page.goto(`${SPA}/integrations`);
  const apiKey = row(page, "API key");
  await expect(apiKey.getByText("Not set", { exact: true })).toBeVisible();
  await apiKey.getByRole("button", { name: `Enter key: API key, ${PROVIDER}` }).click();
  const dialog = page.getByRole("dialog", { name: `Enter the key: API key, ${PROVIDER}` });
  await expect(dialog).toBeVisible();

  // The same owner saves a key from another client while the dialog is open: the revision on this screen is now old.
  const before = await fakeEmail(elsewhere);
  const saved = await elsewhere.put<{ integration: IntegrationView }>(
    `/admin/integrations/${before.integration.id}/secrets/api_key`,
    { expectedRevision: before.revision, value: fakeKey(), currentPassword: account.password },
  );
  const savedElsewhere = secretOf(saved.integration, "api_key");
  expect(savedElsewhere?.state).toBe("set");

  const lost = fakeKey();
  await dialog.getByLabel("Key", { exact: true }).fill(lost);
  await dialog.getByLabel("Your current password", { exact: true }).fill(account.password);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page
      .getByRole("main")
      .getByText(
        "The integrations were changed in the meantime. Nothing was changed and the list is reloaded: try again.",
      ),
  ).toBeVisible();
  // The list now shows what the other client stored; this screen's own value was not saved over it.
  await expect(apiKey.getByText("Saved, not active yet", { exact: true })).toBeVisible();
  await expect(apiKey.getByRole("button", { name: /^Replace the saved key/ })).toBeEnabled();
  expect(await inputValues(page)).toEqual(ROUTE_INPUTS);
  expect(await page.content()).not.toContain(lost);
  // Still the version the other client stored: the refused save created none.
  expect(secretOf((await fakeEmail(elsewhere)).integration, "api_key")).toEqual(savedElsewhere);
});

test("the session ends while a key is typed: nothing typed stays in the page under the re-sign-in dialog", async ({
  page,
  owner,
  apiContext,
  playwright,
}, testInfo) => {
  const account = await createOwner(owner, unique(testInfo));
  const api = await AdminApi.signIn(await apiContext("own-owner"), account.email, account.password);
  await removeStoredApiKey(api, account);
  await signInAs(page, account);
  await page.goto(`${SPA}/integrations`);
  const apiKey = row(page, "API key");
  await apiKey.getByRole("button", { name: `Enter key: API key, ${PROVIDER}` }).click();
  const dialog = page.getByRole("dialog", { name: `Enter the key: API key, ${PROVIDER}` });
  const key = fakeKey();
  await dialog.getByLabel("Key", { exact: true }).fill(key);
  await dialog.getByLabel("Your current password", { exact: true }).fill(account.password);
  expect(await inputValues(page)).toEqual([...ROUTE_INPUTS, key, account.password]);

  // The browser's session, signed out from another client: its cookie is now dead (as in `session.e2e.ts`).
  const other = await playwright.request.newContext({
    baseURL: ADMIN_E2E_ORIGIN,
    storageState: await page.context().storageState(),
    extraHTTPHeaders: {
      "x-e2e-client": clientMarker(
        testInfo.testId,
        testInfo.retry,
        testInfo.repeatEachIndex,
        "elsewhere",
      ),
    },
  });
  expect((await other.post("/admin/auth/logout", { headers: CSRF })).status()).toBe(204);
  await other.dispose();

  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const reauth = page.getByRole("dialog", { name: "Your session has ended" });
  await expect(reauth).toBeVisible();
  // The key dialog is gone with everything typed into it; the only inputs left are the re-sign-in form's own.
  await expect(dialog).toHaveCount(0);
  const left = await inputValues(page);
  expect(left).not.toContain(key);
  expect(left).not.toContain(account.password);
  expect(await page.content()).not.toContain(key);
  expect(await page.content()).not.toContain(account.password);

  // Signing in again continues on the same screen: no dialog comes back, nothing was saved, nothing is replayed.
  await reauth.getByRole("textbox", { name: "Email" }).fill(account.email);
  await reauth.getByLabel("Password", { exact: true }).fill(account.password);
  await reauth.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(reauth).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(apiKey.getByText("Not set", { exact: true })).toBeVisible();
  expect(secretOf((await fakeEmail(api)).integration, "api_key")?.state).toBe("not_set");
});
