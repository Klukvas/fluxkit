import { CSRF } from "../support/api.ts";
import { ADMIN_E2E_ORIGIN, SPA } from "../support/env.ts";
import { CREDENTIALS, expect, test, unique } from "../support/fixtures.ts";
import { clientMarker } from "../support/env.ts";

test("a session ended elsewhere: the next save opens the re-sign-in dialog and the form keeps its input", async ({
  page,
  signIn,
  owner,
  playwright,
}, testInfo) => {
  const u = unique(testInfo);
  const brand = await owner.post<{ id: string }>("/admin/brands", {
    name: { uk: `Сесія ${u}`, en: `Session ${u}` },
    slug: `session-${u}`,
  });
  await signIn("manager");
  const main = page.getByRole("main");
  await page.goto(`${SPA}/catalog/brands/${brand.id}`);
  const english = main.getByRole("textbox", { name: "Name (English)", exact: true });
  await expect(english).toHaveValue(`Session ${u}`);
  await english.fill(`Session ${u} edited`);

  // The same session, signed out from another client: the browser's cookie is now dead.
  const elsewhere = await playwright.request.newContext({
    baseURL: ADMIN_E2E_ORIGIN,
    storageState: await page.context().storageState(),
    extraHTTPHeaders: {
      "x-e2e-client": clientMarker(testInfo.testId, testInfo.retry, "elsewhere"),
    },
  });
  expect((await elsewhere.post("/admin/auth/logout", { headers: CSRF })).status()).toBe(204);
  await elsewhere.dispose();

  await main.getByRole("button", { name: "Save changes" }).click();
  const dialog = page.getByRole("dialog", { name: "Your session has ended" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("This page and your input stay");
  await expect(english).toHaveValue(`Session ${u} edited`);
  expect((await owner.get<{ name: { en: string } }>(`/admin/brands/${brand.id}`)).name.en).toBe(
    `Session ${u}`,
  );

  await dialog.getByRole("textbox", { name: "Email" }).fill(CREDENTIALS.manager.email);
  await dialog.getByLabel("Password", { exact: true }).fill(CREDENTIALS.manager.password);
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog).toBeHidden();
  // The failed save is not replayed: the input is still there, and saving again stores it.
  await expect(english).toHaveValue(`Session ${u} edited`);
  await main.getByRole("button", { name: "Save changes" }).click();
  await expect(main.getByText("Saved.", { exact: true })).toBeVisible();
  expect((await owner.get<{ name: { en: string } }>(`/admin/brands/${brand.id}`)).name.en).toBe(
    `Session ${u} edited`,
  );
});

test("sign-out asks before unsaved input is discarded: from the header and from the re-sign-in dialog", async ({
  page,
  signIn,
  owner,
  playwright,
}, testInfo) => {
  const u = unique(testInfo);
  const brand = await owner.post<{ id: string }>("/admin/brands", {
    name: { uk: `Вихід ${u}`, en: `Leave ${u}` },
    slug: `leave-${u}`,
  });
  await signIn("manager");
  const main = page.getByRole("main");
  await page.goto(`${SPA}/catalog/brands/${brand.id}`);
  const english = main.getByRole("textbox", { name: "Name (English)", exact: true });
  await expect(english).toHaveValue(`Leave ${u}`);
  await english.fill(`Leave ${u} typed`);
  const leave = page.getByRole("alertdialog", { name: "Leave this page?" });

  // The header's sign-out asks first; "Stay" keeps the session and the input.
  await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
  await expect(leave).toBeVisible();
  await expect(leave.getByRole("button", { name: "Stay" })).toBeFocused();
  await leave.getByRole("button", { name: "Stay" }).click();
  await expect(leave).toBeHidden();
  await expect(english).toHaveValue(`Leave ${u} typed`);
  expect((await page.request.get("/admin/auth/me")).status()).toBe(200);

  // The session ends elsewhere; the re-sign-in dialog's sign-out asks the same question.
  const elsewhere = await playwright.request.newContext({
    baseURL: ADMIN_E2E_ORIGIN,
    storageState: await page.context().storageState(),
    extraHTTPHeaders: {
      "x-e2e-client": clientMarker(testInfo.testId, testInfo.retry, "elsewhere"),
    },
  });
  expect((await elsewhere.post("/admin/auth/logout", { headers: CSRF })).status()).toBe(204);
  await elsewhere.dispose();
  await main.getByRole("button", { name: "Save changes" }).click();
  const reauth = page.getByRole("dialog", { name: "Your session has ended" });
  await expect(reauth).toBeVisible();
  await reauth.getByRole("button", { name: "Sign out" }).click();
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "Stay" }).click();
  await expect(leave).toBeHidden();
  await expect(reauth).toBeVisible();
  await expect(english).toHaveValue(`Leave ${u} typed`);

  // "Leave" signs out and goes to the sign-in page.
  await reauth.getByRole("button", { name: "Sign out" }).click();
  await leave.getByRole("button", { name: "Leave" }).click();
  await expect(page).toHaveURL(new RegExp(`${SPA}/login`));
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to the admin" })).toBeVisible();
});
