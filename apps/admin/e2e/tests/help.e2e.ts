import type { Page } from "@playwright/test";
import { SPA } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";

/**
 * The knowledge base (plan `docs/plans/2026-11-02-admin-knowledge-base.md`): the Help area from the navigation, the search
 * in English and in Ukrainian, an article with its "Open this screen" link, the getting-started checklist on the start page
 * (state kept in the browser, hidden and shown again), and the contextual "Help for this page" link with a section anchor.
 * The API runs with the fake email, payment and shipping providers and the seeded catalog (`support/env.ts`).
 */

async function openHelp(page: Page): Promise<void> {
  await page
    .getByRole("navigation", { name: "Admin sections" })
    .getByRole("link", { name: "Help" })
    .click();
  await expect(page).toHaveURL(new RegExp(`${SPA}/help$`));
  await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeFocused();
}

test("Help: open it from the navigation, search in English and Ukrainian, read an article and open its screen", async ({
  page,
  signIn,
}) => {
  await signIn("owner");
  await page.goto(`${SPA}/`);
  await openHelp(page);

  const box = page.getByRole("searchbox", { name: "Search the help" });
  await box.fill("refund");
  const results = page.getByRole("region", { name: "Search results" });
  await expect(results.getByRole("link").first()).toHaveText("Online payments and refunds");
  // The count is announced politely (a status region that was in the page before the search).
  await expect(page.getByRole("status").filter({ hasText: /articles? found\./ })).toHaveCount(1);
  await expect(page).toHaveURL(/[?&]q=refund/);
  // The navigation's Help link drops `?q`: the box and the results follow the URL (review of PR 212).
  await page
    .getByRole("navigation", { name: "Admin sections" })
    .getByRole("link", { name: "Help" })
    .click();
  await expect(page).toHaveURL(new RegExp(`${SPA}/help$`));
  await expect(box).toHaveValue("");
  await expect(results).toHaveCount(0);
  await box.fill("refund");
  await expect(results.getByRole("link").first()).toHaveText("Online payments and refunds");

  await box.fill("unicorn rocket");
  await expect(
    results.getByText("No article matches “unicorn rocket”.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear the search" }).click();
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();

  // The same search in the Ukrainian interface, typed partly in upper case.
  await page.getByRole("button", { name: "Українська" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Довідка" })).toBeVisible();
  const ukBox = page.getByRole("searchbox", { name: "Пошук у довідці" });
  await ukBox.fill("ПОВЕРНЕННЯ коштів");
  const ukResults = page.getByRole("region", { name: "Результати пошуку" });
  await expect(ukResults.getByRole("link").first()).toHaveText("Онлайн-оплата і повернення коштів");
  // An English word in the Ukrainian interface finds the article too (both languages are searched).
  await ukBox.fill("synonyms");
  await expect(ukResults.getByRole("link").first()).toHaveText("Пошук у вітрині");
  await ukResults.getByRole("link", { name: "Пошук у вітрині" }).click();

  await expect(page).toHaveURL(new RegExp(`${SPA}/help/search$`));
  // The document title names the article; an unknown article says it does not exist.
  await expect(page).toHaveTitle(/^Пошук у вітрині/);
  await expect(page.getByRole("heading", { level: 1, name: "Пошук у вітрині" })).toBeFocused();
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 2, name: "Синоніми" })).toBeVisible();
  await expect(main.getByRole("navigation", { name: "Інші статті" })).toBeVisible();
  await main.getByRole("link", { name: "Відкрити екран: Синоніми пошуку" }).click();
  await expect(page).toHaveURL(new RegExp(`${SPA}/catalog/search/synonyms$`));
  // The title of the next page is its own again (the article's name does not leak).
  await expect(page).toHaveTitle(/^Синоніми пошуку · /);

  await page.goto(`${SPA}/help/no-such-article`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Такої статті довідки немає" }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/^Такої статті довідки немає · /);
});

test("Help for this page: the contextual link opens the article at the section of the screen", async ({
  page,
  signIn,
}) => {
  await signIn("owner");
  // The help chunk is loaded first, so the article below renders in the SAME commit as the navigation: the route focus
  // (which moves the focus to the h1) runs after the article's own effect, and the section must still win.
  await page.goto(`${SPA}/help`);
  await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Admin sections" })
    .getByRole("link", { name: "Payments to review" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Payments to review" })).toBeVisible();
  await page.getByRole("link", { name: "Help for this page" }).click();
  await expect(page).toHaveURL(new RegExp(`${SPA}/help/payments#attention$`));
  const section = page.getByRole("heading", { level: 2, name: "Payments to review" });
  // The section heading takes the focus (after the route focus put it on the h1), so it is also scrolled into view.
  await expect(section).toBeFocused();
  await expect(section).toBeInViewport();

  // The contents of a long article link its own sections: the focus follows the anchor without a new page.
  await page
    .getByRole("navigation", { name: "On this page" })
    .getByRole("link", { name: "Refund" })
    .click();
  await expect(page).toHaveURL(new RegExp(`${SPA}/help/payments#refund$`));
  await expect(page.getByRole("heading", { level: 2, name: "Refund" })).toBeFocused();
});

test("Getting started: computed states, a manual tick kept in the browser, hidden on the start page and shown again from Help", async ({
  page,
  signIn,
}) => {
  await signIn("owner");
  await page.goto(`${SPA}/`);
  const card = page.getByRole("region", { name: "Getting started" });
  await expect(card).toBeVisible();
  // The seeded catalog has product types; the API runs with the fake mail provider, which is test-only.
  const productTypes = card
    .getByRole("listitem")
    .filter({ hasText: "Product types, attributes and options" });
  await expect(productTypes.getByText("Done", { exact: true })).toBeVisible();
  const email = card.getByRole("listitem").filter({ hasText: "Email" });
  await expect(email.getByText("Test provider only", { exact: true })).toBeVisible();
  await expect(card.getByText(/^\d of 9 steps done$/)).toBeVisible();
  await expect(productTypes.getByRole("link", { name: "How to do it" })).toHaveAttribute(
    "href",
    `${SPA}/help/product-types#product-types`,
  );

  // The legal texts step is ticked by hand and kept in this browser.
  const legal = card.getByRole("checkbox", { name: "I have done this" });
  await expect(legal).not.toBeChecked();
  await legal.check();
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Getting started" })
      .getByRole("checkbox", { name: "I have done this" }),
  ).toBeChecked();

  // Hidden from the start page: a focused line says where it went; after a reload the start page has no card.
  await page.getByRole("button", { name: "Hide from the start page" }).click();
  const notice = page.getByText("The checklist is hidden. You find it under Help.");
  await expect(notice).toBeFocused();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Start" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Getting started" })).toHaveCount(0);

  // Under Help it is always there, with the way back.
  await openHelp(page);
  const helpCard = page.getByRole("region", { name: "Getting started" });
  await expect(helpCard.getByText("The checklist is hidden from the start page.")).toBeVisible();
  const restore = helpCard.getByRole("button", { name: "Show on the start page again" });
  await restore.click();
  await expect(helpCard.getByRole("button", { name: "Hide from the start page" })).toBeFocused();
  await page.goto(`${SPA}/`);
  await expect(page.getByRole("region", { name: "Getting started" })).toBeVisible();
});

test("Getting started for the viewer: Help is in the navigation, and a step the role cannot read says so without a request", async ({
  page,
  signIn,
  guard,
}) => {
  await signIn("viewer");
  await page.goto(`${SPA}/`);
  const card = page.getByRole("region", { name: "Getting started" });
  const shipping = card.getByRole("listitem").filter({ hasText: "Delivery method" });
  await expect(shipping.getByText("Your role cannot check this", { exact: true })).toBeVisible();
  // No screen link the viewer may not open, and no request the role would be refused.
  await expect(shipping.getByRole("link", { name: "Open the screen" })).toHaveCount(0);
  expect(guard.requests.some((request) => request.url.includes("/admin/shipping/"))).toBe(false);
  expect(guard.requests.some((request) => request.url.includes("/admin/email/"))).toBe(false);
  await openHelp(page);
  await page.getByRole("link", { name: "Audit log" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
  await expect(
    page.getByText("Screen “Audit log”: your role cannot open it.", { exact: false }),
  ).toBeVisible();
});
