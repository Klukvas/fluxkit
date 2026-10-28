import { SPA } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";

/**
 * The Email area (email plan step 11). The API of this suite runs with `EMAIL_PROVIDER=fake` (the test-only provider: it
 * delivers nothing) and no scheduler, so a test send or a resend is sent by its immediate attempt. With no scheduler the
 * domain events are not relayed either, so no order mail is queued and there is no waiting mail to cancel here: the cancel
 * flow is covered by the API integration tests (`EmailMessageChanges.cancel`) and the unit and source specs of the area.
 * The test mails go to the sender's own address and the limit is 5 an hour per admin: the owner sends 1 here, the manager 5
 * (the last scenario).
 */

test("email: status, a test mail to the own address, the list, the detail, a resend after a confirmation", async ({
  page,
  signIn,
  guard,
}) => {
  await signIn("owner");
  const nav = page.getByRole("navigation", { name: "Admin sections" });
  await nav.getByRole("link", { name: "Email" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Email" })).toBeVisible();
  const main = page.getByRole("main");

  // Status: a configured provider, the sender, the six statuses in a table, no setup steps.
  await expect(main.getByText("fake", { exact: true })).toBeVisible();
  await expect(main.getByText("Fluxkit E2E <shop@example.com>")).toBeVisible();
  await expect(main.getByText("No email provider is configured")).toHaveCount(0);
  const counts = main.getByRole("table", { name: "Mails by status in the last 24 hours" });
  await expect(counts.getByRole("row")).toHaveCount(7);

  // The test send: to the own address, in English; the answer links the message.
  await main.getByRole("button", { name: "Send test email" }).click();
  await expect(main.getByText("The test mail is queued.")).toBeVisible();
  await main.getByRole("link", { name: "Open the message" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Message" })).toBeVisible();
  await expect(main.getByText("admin.test")).toBeVisible();
  await expect(main.getByText("e2e-owner@example.com")).toBeVisible();
  // The immediate attempt of the fake provider: the mail turns sent without the scheduler.
  await expect(async () => {
    await page.reload();
    await expect(main.getByRole("definition").filter({ hasText: /^Sent$/ })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
  const detailUrl = page.url();
  const originalId = detailUrl.slice(detailUrl.lastIndexOf("/") + 1);
  // The frozen variables of the test mail, shown as a table.
  await expect(main.getByRole("rowheader", { name: "providerCode" })).toBeVisible();
  // A sent mail can be resent, not cancelled.
  await expect(main.getByRole("button", { name: "Resend" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Cancel sending" })).toHaveCount(0);

  // The list: filter by status, template and recipient; this mail is in it as sent.
  await main.getByRole("link", { name: "Back to the messages" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Messages" })).toBeVisible();
  const filters = main.getByRole("form", { name: "Filter messages" });
  await filters.getByRole("combobox", { name: "Status" }).selectOption({ label: "Sent" });
  await filters.getByRole("combobox", { name: "Template" }).selectOption({ label: "admin.test" });
  await filters.getByRole("searchbox", { name: "Recipient" }).fill("E2E-OWNER");
  await filters.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/status=sent/);
  await expect(page).toHaveURL(/template=admin\.test/);
  const table = main.getByRole("table", { name: "Mail messages" });
  await expect(table.locator(`a[href$="/email/messages/${originalId}"]`)).toBeVisible();
  await expect(table.getByRole("row", { name: /Sent/ }).first()).toBeVisible();
  // A filter nothing matches: the no-match state with a way out.
  await filters.getByRole("searchbox", { name: "Recipient" }).fill("nobody-has-this-address");
  await filters.getByRole("button", { name: "Apply" }).click();
  await expect(main.getByText("No mail matches")).toBeVisible();
  await main.getByRole("link", { name: "Clear filters" }).first().click();
  await expect(page).not.toHaveURL(/status=/);

  // Resend: the button only asks; nothing is sent before the confirmation.
  await page.goto(`${SPA}/email/messages/${originalId}`);
  const writesBefore = guard.writes().length;
  await main.getByRole("button", { name: "Resend" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Resend this mail?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("your own address");
  await expect(dialog.getByRole("button", { name: "Keep" })).toBeFocused();
  expect(guard.writes().length, "no write before the confirmation").toBe(writesBefore);
  await dialog.getByRole("button", { name: "Keep" }).click();
  await expect(dialog).toBeHidden();
  expect(guard.writes().length, "keeping the mail sends nothing").toBe(writesBefore);

  await main.getByRole("button", { name: "Resend" }).click();
  const resent = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith(`/${originalId}/resend`),
  );
  await dialog.getByRole("button", { name: "Resend" }).click();
  await resent;
  await expect(main.getByText("A new mail is queued.")).toBeVisible();
  expect(guard.writes().length - writesBefore, "exactly one write").toBe(1);
  await main.getByRole("link", { name: "Open the new message" }).click();
  await expect(main.getByRole("link", { name: "Open the original mail" })).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(main.getByRole("definition").filter({ hasText: /^Sent$/ })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
});

test("email: templates, and a preview in a sandboxed frame (no scripts, no same-origin) that keeps the CSP", async ({
  page,
  signIn,
  guard,
}) => {
  // Playwright reads the frame through scripts of its own; the sandbox refuses them and Chrome logs that. Nothing else may.
  guard.expectConsoleErrors(
    /^Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed/,
  );
  await signIn("owner");
  const nav = page.getByRole("navigation", { name: "Admin sections" });
  await nav.getByRole("link", { name: "Email" }).click();
  const main = page.getByRole("main");
  await main
    .getByRole("navigation", { name: "Email sections" })
    .getByRole("link", { name: "Templates" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Templates" })).toBeVisible();
  const table = main.getByRole("table", { name: "Mail templates" });
  for (const key of ["admin.test", "order.placed", "order.paid", "customer.password_reset"]) {
    await expect(table.getByRole("link", { name: key, exact: true })).toBeVisible();
  }
  await table.getByRole("link", { name: "order.placed", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Preview: order.placed" }),
  ).toBeVisible();

  // The frame: an EMPTY sandbox, the document comes as srcdoc.
  const frame = main.locator("iframe");
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute("sandbox", "");
  expect(await frame.getAttribute("sandbox")).toBe("");
  expect(await frame.getAttribute("src")).toBeNull();
  expect(await frame.getAttribute("srcdoc")).toContain("<!doctype html>");
  const content = page.frameLocator("iframe");
  await expect(content.locator("body")).toContainText("Fluxkit E2E");
  // The template's inline styles apply inside the frame (the page's CSP is inherited by the srcdoc document).
  const background = await content
    .locator("body")
    .evaluate((body) => getComputedStyle(body).backgroundColor);
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
  // Subject and plain-text part are text of the admin page.
  await expect(main.getByText("Subject")).toBeVisible();
  await expect(main.locator("pre")).not.toBeEmpty();

  // The same document cannot run script or reach the admin page: the origin is opaque.
  const isolated = await frame.evaluate((element) => {
    const iframe = element as HTMLIFrameElement;
    let reachable: boolean;
    try {
      reachable = iframe.contentDocument !== null;
    } catch {
      reachable = false;
    }
    return { reachable, sandboxed: iframe.sandbox.length };
  });
  expect(isolated).toEqual({ reachable: false, sandboxed: 0 });

  // The language switch re-renders in Ukrainian.
  const english = await main.locator("pre").textContent();
  await main
    .getByRole("navigation", { name: "Preview language" })
    .getByRole("link", { name: "Ukrainian" })
    .click();
  await expect(page).toHaveURL(/locale=uk/);
  await expect(main.getByRole("link", { name: "Ukrainian" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(async () => {
    expect(await main.locator("pre").textContent()).not.toBe(english);
  }).toPass();
  await expect(main.locator("iframe")).toHaveAttribute("sandbox", "");

  // No CSP violation, no console error and no request outside the admin (the guard fails the test otherwise).
  expect(guard.csp).toEqual([]);
});

test("email: the test send is limited to 5 an hour: the sixth is explained, nothing else breaks", async ({
  page,
  signIn,
}) => {
  // Five test mails through the API as the manager (the limit is per admin user), then the sixth from the screen.
  await signIn("manager");
  for (let sent = 1; sent <= 5; sent += 1) {
    const response = await page.context().request.post("/admin/email/test", {
      headers: { "X-Fluxkit-CSRF": "1" },
      data: {},
    });
    expect(response.status(), `test send ${String(sent)}`).toBe(202);
  }
  await page.goto(`${SPA}/email`);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Send test email" }).click();
  await expect(main.getByText("The test mail was not sent")).toBeVisible();
  await expect(main.getByText(/Too many test mails/)).toBeVisible();
  // The button works again afterwards (nothing is stuck in a busy state).
  await expect(main.getByRole("button", { name: "Send test email" })).toBeEnabled();
});
