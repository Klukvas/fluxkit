import type { Page } from "@playwright/test";
import { AdminApi } from "../support/api.ts";
import { SPA } from "../support/env.ts";
import { delayAnimationFrames } from "../support/late-frames.ts";
import { expect, test, unique } from "../support/fixtures.ts";

async function fillNewUser(page: Page, email: string, password: string): Promise<void> {
  const main = page.getByRole("main");
  await main.getByRole("textbox", { name: "Email" }).fill(email);
  await main.getByRole("radio", { name: /Manager/ }).check();
  await main.getByLabel("Initial password").fill(password);
}

test("the owner creates a manager: password policy feedback, the password never shown again, duplicate email", async ({
  page,
  signIn,
  apiContext,
}, testInfo) => {
  const u = unique(testInfo);
  const email = `e2e-new-manager-${u}@example.com`;
  const password = `new-manager-password-${u}`;
  await signIn("owner");
  const main = page.getByRole("main");
  await page
    .getByRole("navigation", { name: "Admin sections" })
    .getByRole("link", { name: "Admin users" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Admin users" })).toBeVisible();
  await main.getByRole("link", { name: "Create an admin user" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New admin user" })).toBeVisible();

  // Live policy feedback, and a too short password is refused before anything is sent.
  await fillNewUser(page, email, "short");
  await expect(
    main.getByRole("listitem").filter({ hasText: "Not met: 12 to 128 characters (now 5)" }),
  ).toBeVisible();
  const created: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/admin/users") {
      created.push(request.postData() ?? "");
    }
  });
  await main.getByRole("button", { name: "Create user" }).click();
  await expect(main.getByText("This value is too short.")).toBeVisible();
  await expect(main.getByLabel("Initial password")).toBeFocused();
  expect(created, "nothing sent for a password the policy refuses").toEqual([]);
  await main.getByLabel("Initial password").fill(email);
  await expect(
    main.getByRole("listitem").filter({ hasText: "Not met: Not the user's email address" }),
  ).toBeVisible();

  await main.getByLabel("Initial password").fill(password);
  await expect(
    main
      .getByRole("listitem")
      .filter({ hasText: `Met: 12 to 128 characters (now ${String(password.length)})` }),
  ).toBeVisible();
  await main.getByRole("button", { name: "Create user" }).click();
  const panel = main.getByRole("status").filter({ hasText: "Admin user created" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(email);
  await expect(panel).toContainText("Manager");
  await expect(main.getByText("The password is not shown again.")).toBeVisible();
  expect(created).toHaveLength(1);
  expect(JSON.parse(created[0] ?? "{}")).toEqual({ email, role: "manager", password });
  await expect(page.getByText(password)).toHaveCount(0);
  expect(
    await page
      .locator("input")
      .evaluateAll(
        (inputs, secret) => inputs.some((input) => (input as HTMLInputElement).value === secret),
        password,
      ),
  ).toBe(false);

  // The new manager can sign in with the handed-over password.
  const asNewManager = await AdminApi.signIn(await apiContext("new-manager"), email, password);
  const me = await asNewManager.get<{ user: { role: string } }>("/admin/auth/me");
  expect(me.user.role).toBe("manager");

  // The same email again: refused on the email field, the password cleared.
  await main.getByRole("button", { name: "Create another user" }).click();
  await fillNewUser(page, email.toUpperCase(), `${password}-again`);
  await main.getByRole("button", { name: "Create user" }).click();
  await expect(main.getByText("Another admin user already has this email address.")).toBeVisible();
  await expect(main.getByRole("textbox", { name: "Email" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(main.getByLabel("Initial password")).toHaveValue("");
  expect(created).toHaveLength(2);

  // The list shows the new user once.
  await page.goto(`${SPA}/users`);
  await expect(
    main.getByRole("table", { name: "Admin users" }).getByRole("link", { name: email }),
  ).toHaveCount(1);
});

test("the owner creates a user: a refused form focuses its field at once, so what is typed next stays in that field (late frames)", async ({
  page,
  signIn,
}, testInfo) => {
  const u = unique(testInfo);
  // Regression of the CI run of PR #191: a focus moved from an animation frame arrives after the test has moved on.
  await delayAnimationFrames(page);
  await signIn("owner");
  await page.goto(`${SPA}/users/new`);
  const main = page.getByRole("main");
  await expect(page.getByRole("heading", { level: 1, name: "New admin user" })).toBeVisible();
  await fillNewUser(page, `e2e-late-${u}@example.com`, "short");
  await main.getByRole("button", { name: "Create user" }).click();
  await expect(main.getByText("This value is too short.")).toBeVisible();
  // Read once, no waiting: the first invalid field has the focus as soon as its message is shown.
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("user-password");

  // The admin goes on to the email at once and types: every key stays in the email.
  const email = main.getByRole("textbox", { name: "Email" });
  await email.focus();
  await page.keyboard.type("-more", { delay: 40 });
  await expect(email).toHaveValue(`e2e-late-${u}@example.com-more`);
  await expect(main.getByLabel("Initial password")).toHaveValue("short");
  await expect(email).toBeFocused();
});
