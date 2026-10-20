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
