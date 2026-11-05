import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { AdminApi, CSRF } from "../support/api.ts";
import { OWNER_EMAIL, OWNER_PASSWORD, SPA } from "../support/env.ts";
import { expect, test, unique } from "../support/fixtures.ts";
import { asPayload, pngFile } from "../support/images.ts";

/**
 * Home banners (plan 2026-11-05-admin-home-banners.md, PR 2): the Storefront -> Home banners screens against the real API.
 * Each test creates its own banners under unique names and checks only those (the seed may hold demo banners, and other
 * tests add theirs to the same list).
 */

interface StoredBanner {
  id: string;
  layout: "card" | "image";
  title: Record<string, string> | null;
  text: Record<string, string> | null;
  imageAlt: Record<string, string> | null;
  image: { uploadId: string; width: number; height: number };
  images: { locale: string; uploadId: string }[];
  link: string;
  tone: string;
  isActive: boolean;
  state: string;
}

/** The owner's API session and its raw request context (the picture upload sends bytes, not JSON). */
async function ownerApi(
  apiContext: (role: string) => Promise<APIRequestContext>,
): Promise<{ api: AdminApi; context: APIRequestContext }> {
  const context = await apiContext("banner-owner-api");
  return { api: await AdminApi.signIn(context, OWNER_EMAIL, OWNER_PASSWORD), context };
}

async function uploadPicture(context: APIRequestContext, name: string): Promise<string> {
  const answer = await context.post("/admin/media/uploads", {
    headers: { ...CSRF, "Content-Type": "application/octet-stream" },
    data: pngFile(name, 64, 32).buffer,
  });
  expect(answer.status()).toBe(201);
  return ((await answer.json()) as { id: string }).id;
}

async function createBanner(
  api: AdminApi,
  context: APIRequestContext,
  name: string,
  overrides: Record<string, unknown> = {},
): Promise<StoredBanner> {
  return api.post<StoredBanner>(
    "/admin/banners",
    {
      title: { uk: `Банер ${name}`, en: name },
      imageUploadId: await uploadPicture(context, `${name}.png`),
      link: "/catalog",
      isActive: true,
      ...overrides,
    },
    201,
  );
}

async function storedIds(api: AdminApi): Promise<string[]> {
  return (await api.get<{ items: StoredBanner[] }>("/admin/banners")).items.map((item) => item.id);
}

/** The row of a banner in the list, found by its name (the link to its editor). */
function row(page: Page, name: string): Locator {
  return page
    .getByRole("list", { name: "Banners in the order the home page shows them" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name, exact: true }) });
}

function uploadStatus(scope: Locator, fileName: string): Locator {
  return scope
    .getByRole("list", { name: "Upload status of each file" })
    .getByRole("listitem")
    .filter({ hasText: fileName });
}

async function openList(page: Page): Promise<void> {
  await page
    .getByRole("navigation", { name: "Admin sections" })
    .getByRole("link", { name: "Home banners" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Home banners" })).toBeVisible();
}

test("the manager creates a card banner with an uploaded picture: early checks, preview, saved and live", async ({
  page,
  signIn,
  apiContext,
}, testInfo) => {
  const u = unique(testInfo);
  const name = `Card ${u}`;
  const picture = pngFile(`card-${u}.png`, 64, 32);
  await signIn("manager");
  await openList(page);
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "New banner" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New banner" })).toBeVisible();

  // Nothing is sent while the form is incomplete: the summary takes the focus and names the fields.
  await main.getByRole("button", { name: "Create the banner" }).click();
  const summary = main.getByRole("alert").filter({ hasText: "Check the marked fields." });
  await expect(summary).toBeVisible();
  await expect(main.getByText("Upload the main picture.", { exact: true })).toBeVisible();

  await main.getByLabel("Upload the main picture").setInputFiles(asPayload(picture));
  await expect(uploadStatus(main, picture.name)).toContainText("Uploaded");
  await expect(main.getByText("64 × 32 pixels").first()).toBeVisible();
  await expect(main.getByText("Proportions 2:1.").first()).toBeVisible();
  await expect(main.getByText("Using the main picture: Ukrainian, English.")).toBeVisible();

  await main.getByRole("textbox", { name: "Title (Ukrainian)", exact: true }).fill(`Картка ${u}`);
  await main.getByRole("textbox", { name: "Title (English)", exact: true }).fill(name);
  await main
    .getByRole("textbox", { name: "Text (English)", exact: true })
    .fill("Up to a third off");
  await main.getByRole("textbox", { name: "Text (Ukrainian)", exact: true }).fill("Знижки");
  const link = main.getByRole("textbox", { name: "Link", exact: true });
  await link.fill("/uk/catalog");
  await main.getByRole("checkbox", { name: "Show this banner on the home page" }).check();
  await main.getByRole("button", { name: "Create the banner" }).click();
  await expect(
    main.getByText(
      "Leave out the language at the start: the shop adds the shopper's language itself.",
    ),
  ).toBeVisible();
  await link.fill("/catalog");

  // The preview draws the shared card in the chosen language, theme and width.
  const preview = main.getByRole("region", { name: "Banner preview" });
  // It starts in the UI language (English), and shows the other content locale on request.
  await expect(preview.getByRole("heading", { name })).toBeVisible();
  await main
    .getByRole("group", { name: "Language" })
    .getByRole("radio", { name: "Ukrainian" })
    .check();
  await expect(preview.getByRole("heading", { name: `Картка ${u}` })).toBeVisible();
  await main.getByRole("radio", { name: "Dark" }).check();
  await expect(preview).toHaveAttribute("data-theme", "dark");
  // The admin itself stays light.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await main.getByRole("radio", { name: "Phone" }).check();
  await expect(preview).toHaveAttribute("data-preview-device", "phone");

  await main.getByRole("button", { name: "Create the banner" }).click();
  await expect(page.getByText(`Banner “${name}” created.`, { exact: true })).toBeVisible();

  const { api } = await ownerApi(apiContext);
  const stored = (await api.get<{ items: StoredBanner[] }>("/admin/banners")).items.find(
    (item) => item.title?.["en"] === name,
  );
  expect(stored).toMatchObject({
    layout: "card",
    title: { uk: `Картка ${u}`, en: name },
    text: { uk: "Знижки", en: "Up to a third off" },
    link: "/catalog",
    tone: "surface",
    isActive: true,
    state: "live",
    image: { width: 64, height: 32 },
    images: [],
  });

  await page.getByRole("link", { name: "Back to the banners" }).first().click();
  const created = row(page, name);
  await expect(created.getByText("Live now")).toBeVisible();
  // The thumbnail is decorative (`alt=""`, the name is beside it) and really loads from /media.
  const thumbnail = created.locator("img");
  await expect(thumbnail).toHaveAttribute("alt", "");
  await expect
    .poll(() =>
      thumbnail.evaluate((element) =>
        element instanceof HTMLImageElement && element.complete ? element.naturalWidth : 0,
      ),
    )
    .toBe(64);
});

test("the manager creates a picture-only banner: description required, ratio warning, external link note", async ({
  page,
  signIn,
  apiContext,
}, testInfo) => {
  const u = unique(testInfo);
  const name = `Picture ${u}`;
  await signIn("manager");
  await page.goto(`${SPA}/storefront/banners/new`);
  const main = page.getByRole("main");
  await main.getByRole("radio", { name: "Picture only" }).check();
  await expect(main.getByRole("textbox", { name: "Title (Ukrainian)" })).toHaveCount(0);
  await expect(main.getByText("Text inside a picture is not read aloud")).toBeVisible();

  const picture = pngFile(`image-${u}.png`, 60, 40);
  await main.getByLabel("Upload the main picture").setInputFiles(asPayload(picture));
  await expect(uploadStatus(main, picture.name)).toContainText("Uploaded");
  // A warning, not a block.
  await expect(main.getByText(/^Not 2:1/).first()).toBeVisible();
  // An own picture for English; Ukrainian keeps the main one.
  const english = pngFile(`image-en-${u}.png`, 64, 32);
  await main.getByLabel("Upload a picture for English").setInputFiles(asPayload(english));
  await expect(uploadStatus(main, english.name)).toContainText("Uploaded");
  await expect(main.getByText("Using the main picture: Ukrainian.")).toBeVisible();

  await main
    .getByRole("textbox", { name: "What the picture says and shows (Ukrainian)", exact: true })
    .fill(`Опис ${u}`);
  await main
    .getByRole("textbox", { name: "What the picture says and shows (English)", exact: true })
    .fill(name);
  await main.getByRole("textbox", { name: "Link", exact: true }).fill("https://example.com/sale");
  await expect(
    main.getByText("This address leaves the shop: shoppers go to another site."),
  ).toBeVisible();
  await main.getByRole("button", { name: "Create the banner" }).click();
  await expect(page.getByText(`Banner “${name}” created.`, { exact: true })).toBeVisible();

  const { api } = await ownerApi(apiContext);
  const stored = (await api.get<{ items: StoredBanner[] }>("/admin/banners")).items.find(
    (item) => item.imageAlt?.["en"] === name,
  );
  expect(stored).toMatchObject({
    layout: "image",
    title: null,
    text: null,
    imageAlt: { uk: `Опис ${u}`, en: name },
    link: "https://example.com/sale",
    isActive: false,
    state: "inactive",
    image: { width: 60, height: 40 },
  });
  expect(stored?.images.map((image) => image.locale)).toEqual(["en"]);
});

test("the manager reorders by keyboard (announced) and by dragging a row", async ({
  page,
  signIn,
  apiContext,
}, testInfo) => {
  const u = unique(testInfo);
  const { api, context } = await ownerApi(apiContext);
  const first = await createBanner(api, context, `First ${u}`);
  const second = await createBanner(api, context, `Second ${u}`);
  await signIn("manager");
  await openList(page);

  const count = (await storedIds(api)).length;
  const up = row(page, `Second ${u}`).getByRole("button", { name: `Move up: Second ${u}` });
  await up.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("status").filter({
      hasText: `“Second ${u}” moved to position ${String(count - 1)} of ${String(count)}.`,
    }),
  ).toBeVisible();
  // The focus stays on the button, so the admin can keep moving.
  await expect(
    row(page, `Second ${u}`).getByRole("button", { name: `Move up: Second ${u}` }),
  ).toBeFocused();
  const ids = await storedIds(api);
  expect(ids.indexOf(second.id)).toBe(ids.indexOf(first.id) - 1);

  // Dragging is a pointer shortcut for the same request: grab the row by its number, drop it on the other row. The
  // mouse moves in steps, as a person's does (Chromium starts a native drag only after the pointer has moved).
  await row(page, `Second ${u}`)
    .getByText(/^\d+\.$/)
    .hover();
  await page.mouse.down();
  await row(page, `First ${u}`).hover({ position: { x: 20, y: 20 } });
  await row(page, `First ${u}`).hover({ position: { x: 30, y: 30 } });
  await page.mouse.up();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `“Second ${u}” moved to position ${String(count)} of ${String(count)}.` }),
  ).toBeVisible();
  const after = await storedIds(api);
  expect(after.indexOf(second.id)).toBe(after.indexOf(first.id) + 1);
});

test("the manager switches a banner off in its editor, then deletes it from the list after a confirmation", async ({
  page,
  signIn,
  apiContext,
}, testInfo) => {
  const u = unique(testInfo);
  const name = `Off ${u}`;
  const { api, context } = await ownerApi(apiContext);
  const banner = await createBanner(api, context, name);
  await signIn("manager");
  await openList(page);
  await expect(row(page, name).getByText("Live now")).toBeVisible();

  await row(page, name).getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const main = page.getByRole("main");
  await main.getByRole("checkbox", { name: "Show this banner on the home page" }).uncheck();
  await main.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  expect((await api.get<StoredBanner>(`/admin/banners/${banner.id}`)).isActive).toBe(false);

  await page.getByRole("link", { name: "Back to the banners" }).first().click();
  await expect(row(page, name).getByText("Switched off")).toBeVisible();
  await row(page, name)
    .getByRole("button", { name: `Delete: ${name}` })
    .click();
  const dialog = page.getByRole("alertdialog", { name: `Delete the banner “${name}”?` });
  await expect(dialog).toBeVisible();
  // Cancel first: nothing happens.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, name)).toHaveCount(1);
  await row(page, name)
    .getByRole("button", { name: `Delete: ${name}` })
    .click();
  await page
    .getByRole("alertdialog", { name: `Delete the banner “${name}”?` })
    .getByRole("button", { name: "Delete the banner" })
    .click();
  await expect(page.getByText(`Banner “${name}” deleted.`, { exact: true })).toBeVisible();
  await expect(row(page, name)).toHaveCount(0);
  await api.get(`/admin/banners/${banner.id}`, 404);
});

test("the viewer reads the banners without any write control", async ({
  page,
  signIn,
  apiContext,
}, testInfo) => {
  const u = unique(testInfo);
  const name = `Read ${u}`;
  const { api, context } = await ownerApi(apiContext);
  await createBanner(api, context, name);
  await signIn("viewer");
  await openList(page);
  const main = page.getByRole("main");
  await expect(row(page, name)).toHaveCount(1);
  await expect(main.getByRole("link", { name: "New banner" })).toHaveCount(0);
  await expect(main.getByRole("button")).toHaveCount(0);
  await row(page, name).getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(main.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await expect(main.getByLabel("Upload the main picture")).toHaveCount(0);
});
