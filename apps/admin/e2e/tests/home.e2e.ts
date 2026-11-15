import { json } from "../support/api.ts";
import { SPA } from "../support/env.ts";
import { seedSucceededPayment } from "../support/payments-db.ts";
import { expect, test, unique } from "../support/fixtures.ts";

const counters = [
  { path: "/admin/orders", status: "awaiting_payment", label: "Orders awaiting payment" },
  { path: "/admin/orders", status: "paid", label: "Paid orders awaiting fulfilment" },
  { path: "/admin/payments", status: null, label: "Payments to review" },
  { path: "/admin/customers", status: null, label: "Customers" },
  { path: "/admin/products", status: "draft", label: "Draft products" },
  { path: "/admin/products", status: "active", label: "Active products" },
] as const;

function isCounterRead(url: URL, counter: (typeof counters)[number]): boolean {
  if (counter.path === "/admin/payments") {
    return (
      url.pathname === counter.path &&
      url.searchParams.get("needsAttention") === "true" &&
      url.searchParams.get("limit") === "1" &&
      [...url.searchParams].length === 2
    );
  }
  return (
    url.pathname === counter.path &&
    url.searchParams.get("limit") === "1" &&
    url.searchParams.get("offset") === "0" &&
    url.searchParams.get("status") === counter.status &&
    [...url.searchParams].length === (counter.status === null ? 2 : 3)
  );
}

for (const role of ["owner", "manager"] as const) {
  test(`${role}: workspace totals, payment navigation, keyboard and responsive layout`, async ({
    page,
    signIn,
    shopper,
    owner,
  }, testInfo) => {
    const suffix = unique(testInfo);
    const placed = await shopper.placeGuestOrder(
      `e2e-home-${suffix}@example.com`,
      "demo-screwdriver",
      "DEMO-SCREWDRIVER",
    );
    const orderId = await owner.orderIdByNumber(placed.number);
    for (let index = 0; index < 3; index += 1) {
      await seedSucceededPayment({
        orderId,
        providerPaymentId: `e2e-home-${suffix}-${String(index)}`,
        amount: placed.total.amount,
        attentionCode: "duplicate_payment",
      });
    }
    const responses = counters.map((counter) =>
      page.waitForResponse(
        (response) =>
          response.request().method() === "GET" && isCounterRead(new URL(response.url()), counter),
      ),
    );
    await signIn(role);
    const workspace = page.getByRole("region", { name: "Overview", exact: true });
    await expect(workspace.getByRole("link")).toHaveCount(6);
    for (const [index, response] of (await Promise.all(responses)).entries()) {
      expect(response.status()).toBe(200);
      const body = (await response.json()) as { total: number; items: unknown[] };
      const counter = counters[index];
      if (counter === undefined) throw new Error("Counter definition missing");
      if (counter.path === "/admin/payments") {
        expect(body.total).toBeGreaterThanOrEqual(3);
        expect(body.items).toHaveLength(1);
      }
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
    const grid = workspace.locator("div.grid");
    for (const width of [1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(() =>
          grid.evaluate(
            (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length,
          ),
        )
        .toBe(3);
    }
    await page.setViewportSize({ width: 360, height: 800 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Українська", exact: true }).click();
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(
      page
        .getByRole("link", { name: /Платежі на перевірку/ })
        .filter({ has: page.locator("span.tabular-nums") }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "English", exact: true }).click();
    const payments = workspace.getByRole("link", { name: /Payments to review/ });
    const attentionRead = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/admin/payments" &&
        url.searchParams.get("needsAttention") === "true" &&
        url.searchParams.get("limit") !== "1"
      );
    });
    await payments.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${SPA}/payments$`));
    expect((await attentionRead).status()).toBe(200);
    await expect(page.getByRole("table", { name: "Payments that need attention" })).toBeVisible();
    await page.goto(`${SPA}/`);
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
}

test("one unavailable counter retries independently and recovers the real total", async ({
  page,
  signIn,
}) => {
  const payments = (url: URL) => isCounterRead(url, counters[2]);
  await page.route(payments, (route) =>
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
    workspace.getByRole("link", {
      name: "This count is unavailable Payments to review",
      exact: true,
    }),
  ).toBeVisible();
  const retry = workspace.getByRole("button", {
    name: "Try again: Payments to review",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await expect(
    workspace.getByText("The service is temporarily unavailable. Try again later.", {
      exact: true,
    }),
  ).toBeVisible();
  for (const counter of counters.filter((counter) => counter.path !== "/admin/payments")) {
    // The exact same query as the workspace read, independent of how much data other specs create.
    const url = `${counter.path}?${counter.status === null ? "" : `status=${counter.status}&`}limit=1&offset=0`;
    const body = await json<{ total: number }>(await page.request.get(url), 200);
    await expect(
      workspace.getByRole("link", {
        name: `${new Intl.NumberFormat("en").format(body.total)} ${counter.label}`,
        exact: true,
      }),
    ).toBeVisible();
  }
  await page.unroute(payments);
  const recovered = page.waitForResponse((response) => payments(new URL(response.url())));
  await retry.focus();
  await page.keyboard.press("Enter");
  const response = await recovered;
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { total: number };
  await expect(
    workspace.getByRole("link", {
      name: `${new Intl.NumberFormat("en").format(body.total)} Payments to review`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(workspace.getByRole("link", { name: /Payments to review$/ })).toBeFocused();
  await expect(retry).toHaveCount(0);
  await expect(workspace.getByRole("link")).toHaveCount(6);
});

test("a delayed payment counter leaves the other five counters and checklist ready", async ({
  page,
  signIn,
}) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const payments = (url: URL) => isCounterRead(url, counters[2]);
  await page.route(payments, async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await signIn("manager");
    const workspace = page.getByRole("region", { name: "Overview", exact: true });
    await expect(
      workspace.getByRole("link", {
        name: "Loading this counter… Payments to review",
        exact: true,
      }),
    ).toBeVisible();
    for (const counter of counters.filter((entry) => entry.path !== "/admin/payments")) {
      await expect(
        workspace.getByRole("link", { name: new RegExp(`^[0-9,]+ ${counter.label}$`) }),
      ).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Getting started", exact: true })).toBeVisible();
  } finally {
    release();
  }
  await expect(
    page
      .getByRole("region", { name: "Overview", exact: true })
      .getByRole("link", { name: /^[0-9,]+ Payments to review$/ }),
  ).toBeVisible();
});
