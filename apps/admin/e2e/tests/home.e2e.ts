import { json } from "../support/api.ts";
import { SPA } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";

const counters = [
  { path: "/admin/orders", status: "awaiting_payment", label: "Orders awaiting payment" },
  { path: "/admin/orders", status: "paid", label: "Paid orders awaiting fulfilment" },
  { path: "/admin/customers", status: null, label: "Customers" },
  { path: "/admin/products", status: "draft", label: "Draft products" },
  { path: "/admin/products", status: "active", label: "Active products" },
] as const;

function isCounterRead(url: URL, counter: (typeof counters)[number]): boolean {
  return (
    url.pathname === counter.path &&
    url.searchParams.get("limit") === "1" &&
    url.searchParams.get("offset") === "0" &&
    url.searchParams.get("status") === counter.status &&
    [...url.searchParams].length === (counter.status === null ? 2 : 3)
  );
}

test("workspace totals name each link, paid navigation selects its status, create navigation and phone layout", async ({
  page,
  signIn,
}) => {
  const responses = counters.map((counter) =>
    page.waitForResponse(
      (response) =>
        response.request().method() === "GET" && isCounterRead(new URL(response.url()), counter),
    ),
  );
  await signIn("manager");
  const workspace = page.getByRole("region", { name: "Overview", exact: true });
  await expect(workspace.getByRole("link")).toHaveCount(5);
  for (const [index, response] of (await Promise.all(responses)).entries()) {
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { total: number };
    const counter = counters[index];
    if (counter === undefined) throw new Error("Counter definition missing");
    await expect(
      workspace.getByRole("link", {
        name: `${new Intl.NumberFormat("en").format(body.total)} ${counter.label}`,
        exact: true,
      }),
    ).toBeVisible();
  }
  const checklist = page.getByRole("heading", { name: "Getting started", exact: true });
  await expect(checklist).toBeVisible();
  expect(
    await checklist.evaluate((heading) => {
      const workspace = document.getElementById("home-counters-title");
      return (
        workspace !== null &&
        Boolean(workspace.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    }),
  ).toBe(true);
  await page.setViewportSize({ width: 360, height: 800 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  const paid = workspace.getByRole("link", { name: /Paid orders awaiting fulfilment/ });
  await paid.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${SPA}/orders\\?status=paid$`));
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("paid");
  await page.goto(`${SPA}/`);
  await page
    .getByRole("region", { name: "Quick actions", exact: true })
    .getByRole("link", { name: "New product", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${SPA}/products/new$`));
  await expect(page.getByRole("heading", { level: 1, name: "New product" })).toBeVisible();
});

test("one unavailable counter retries independently and recovers the real total", async ({
  page,
  signIn,
}) => {
  const customers = (url: URL) => isCounterRead(url, counters[2]);
  await page.route(customers, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Service unavailable",
        status: 503,
        code: "service_unavailable",
        detail: "Counter read refused by the test route.",
      }),
    }),
  );
  await signIn("manager");
  const workspace = page.getByRole("region", { name: "Overview", exact: true });
  await expect(
    workspace.getByRole("link", { name: "This count is unavailable Customers", exact: true }),
  ).toBeVisible();
  const retry = workspace.getByRole("button", { name: "Try again: Customers", exact: true });
  await expect(retry).toBeVisible();
  await expect(
    workspace.getByText("The service is temporarily unavailable. Try again later.", {
      exact: true,
    }),
  ).toBeVisible();
  for (const counter of counters.filter((counter) => counter.status !== null)) {
    // The exact same query as the workspace read, independent of how much data other specs create.
    const url = `${counter.path}?status=${counter.status}&limit=1&offset=0`;
    const body = await json<{ total: number }>(await page.request.get(url), 200);
    await expect(
      workspace.getByRole("link", {
        name: `${new Intl.NumberFormat("en").format(body.total)} ${counter.label}`,
        exact: true,
      }),
    ).toBeVisible();
  }
  await page.unroute(customers);
  const recovered = page.waitForResponse((response) => customers(new URL(response.url())));
  await retry.focus();
  await page.keyboard.press("Enter");
  const response = await recovered;
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { total: number };
  await expect(
    workspace.getByRole("link", {
      name: `${new Intl.NumberFormat("en").format(body.total)} Customers`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(workspace.getByRole("link", { name: /Customers$/ })).toBeFocused();
  await expect(retry).toHaveCount(0);
  await expect(workspace.getByRole("link")).toHaveCount(5);
});
