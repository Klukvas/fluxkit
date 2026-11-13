import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { AdminApi } from "../support/api.ts";
import { ADMIN_E2E_FEATURES, OWNER_EMAIL, OWNER_PASSWORD, SPA } from "../support/env.ts";
import { expect, test, unique } from "../support/fixtures.ts";
import { asPayload, pngFile } from "../support/images.ts";

/**
 * The blog's admin screens (feature `blog`, docs/plans/2026-11-13-blog.md section 10, ADR 0049 E8) against the real API.
 * The default suite runs without the feature (`FEATURES_ENABLED=` like the template) and checks that the admin shows no
 * blog at all; `ADMIN_E2E_FEATURES=blog` starts the API with the feature (and its migration) and runs the scenarios.
 * Each scenario works on its own posts under unique titles.
 */

const BLOG = ADMIN_E2E_FEATURES.includes("blog");

interface StoredPost {
  id: string;
  slug: string;
  state: string;
  slugLocked: boolean;
  title: Record<string, string>;
  body: Record<string, string>;
  publishedAt: string | null;
  cover: { width: number; height: number } | null;
}

async function ownerApi(
  apiContext: (role: string) => Promise<APIRequestContext>,
): Promise<AdminApi> {
  return AdminApi.signIn(await apiContext("blog-owner-api"), OWNER_EMAIL, OWNER_PASSWORD);
}

function navigation(page: Page): Locator {
  return page.getByRole("navigation", { name: "Admin sections" });
}

async function openList(page: Page): Promise<void> {
  await navigation(page).getByRole("link", { name: "Blog", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Blog" })).toBeVisible();
}

function textbox(scope: Locator, name: string): Locator {
  return scope.getByRole("textbox", { name, exact: true });
}

test.describe("without the blog feature (the default suite)", () => {
  test.skip(BLOG, "runs only without ADMIN_E2E_FEATURES=blog");

  test("the admin shows no blog: its address is not found and the navigation has no entry", async ({
    page,
    signIn,
  }) => {
    await signIn("owner");
    await page.goto(`${SPA}/features/blog`);
    // The page waits for GET /admin/config; the feature is not listed, so it is an unknown address.
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(navigation(page).getByRole("link", { name: "Home banners" })).toBeVisible();
    await expect(navigation(page).getByRole("link", { name: "Blog", exact: true })).toHaveCount(0);
  });
});

test.describe("with the blog feature (ADMIN_E2E_FEATURES=blog)", () => {
  test.skip(!BLOG, "needs the API with FEATURES_ENABLED=blog (ADMIN_E2E_FEATURES=blog)");

  test("the manager writes a draft with a cover: the title check, a Markdown error with its line, then created", async ({
    page,
    signIn,
    apiContext,
  }, testInfo) => {
    const u = unique(testInfo);
    const cover = pngFile(`cover-${u}.png`, 64, 32);
    await signIn("manager");
    await expect(
      navigation(page).getByRole("link", { name: "Blog", exact: true }),
      "the entry joins the Storefront group once the API lists the feature",
    ).toBeVisible();
    await openList(page);
    const main = page.getByRole("main");
    await main.getByRole("link", { name: "New post" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "New post" })).toBeVisible();

    // Nothing is sent without the title in the main language: the first invalid field takes the focus.
    await main.getByRole("button", { name: "Create draft" }).click();
    await expect(main.getByText("Enter the title in the main language.")).toBeVisible();
    await expect(textbox(main, "Title (Ukrainian)")).toBeFocused();

    await textbox(main, "Title (Ukrainian)").fill(`Допис ${u}`);
    await textbox(main, "Title (English)").fill(`Post ${u}`);
    await textbox(main, "Text (Ukrainian)").fill("## Вступ\n\nТекст допису.");
    // `#` is the page title: the API refuses it and names the line.
    await textbox(main, "Text (English)").fill("Intro line.\n\n# Wrong level\n\nBody.");
    await main.getByLabel("Upload cover").setInputFiles(asPayload(cover));
    await expect(main.getByText("64 × 32 pixels")).toBeVisible();

    await main.getByRole("button", { name: "Create draft" }).click();
    await expect(
      main.getByText(
        "Line 3: headings use ## to #### (# is the post's title; ##### and deeper are not allowed).",
      ),
    ).toBeVisible();
    await expect(textbox(main, "Text (English)")).toHaveAttribute("aria-invalid", "true");
    await expect(
      main.getByRole("alert").filter({ hasText: "Check the marked fields." }),
    ).toBeVisible();

    await textbox(main, "Text (English)").fill("Intro line.\n\n## Right level\n\nBody.");
    await main.getByRole("button", { name: "Create draft" }).click();
    await expect(
      page.getByText(
        `Draft “Post ${u}” created. It is not on the storefront until you publish it.`,
      ),
    ).toBeVisible();

    const api = await ownerApi(apiContext);
    const listed = await api.get<{ items: StoredPost[] }>(
      "/admin/blog/posts?status=draft&limit=100",
    );
    const summary = listed.items.find((item) => item.title["en"] === `Post ${u}`);
    expect(summary).toBeDefined();
    const stored = await api.get<StoredPost>(`/admin/blog/posts/${(summary as StoredPost).id}`);
    expect(stored).toMatchObject({
      state: "draft",
      slug: `dopys-${u}`,
      slugLocked: false,
      body: { uk: "## Вступ\n\nТекст допису.", en: "Intro line.\n\n## Right level\n\nBody." },
      cover: { width: 64, height: 32 },
    });

    await page.getByRole("link", { name: "Open the post" }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Post ${u}` })).toBeVisible();
    await expect(main.getByText("Draft: not on the storefront.")).toBeVisible();
  });

  test("publishing needs every language; publish now fixes the address; unpublish and schedule", async ({
    page,
    signIn,
    apiContext,
  }, testInfo) => {
    const u = unique(testInfo);
    const api = await ownerApi(apiContext);
    const post = await api.post<StoredPost>(
      "/admin/blog/posts",
      { title: { uk: `Новина ${u}`, en: `News ${u}` }, body: { uk: "Текст." } },
      201,
    );
    await signIn("manager");
    await page.goto(`${SPA}/features/blog/${post.id}`);
    const main = page.getByRole("main");
    await expect(page.getByRole("heading", { level: 1, name: `News ${u}` })).toBeVisible();

    // The English text is missing: the API refuses and the panel says which language.
    await main.getByRole("button", { name: "Publish now" }).click();
    const refusal = main.getByRole("alert").filter({ hasText: "To publish, the post needs" });
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText("The text in English is missing.");

    // Unsaved text locks publishing until it is saved.
    await textbox(main, "Text (English)").fill("Text.");
    await expect(
      main.getByText("Save your changes first: publishing uses the saved post."),
    ).toBeVisible();
    await expect(main.getByRole("button", { name: "Publish now" })).toBeDisabled();
    await main.getByRole("button", { name: "Save changes" }).click();
    await expect(main.getByText("Saved.", { exact: true })).toBeVisible();

    await main.getByRole("button", { name: "Publish now" }).click();
    await expect(main.getByText("The post is published.")).toBeVisible();
    await expect(main.getByText("Published", { exact: true })).toBeVisible();
    await expect(textbox(main, "Address (slug)")).toHaveAttribute("readonly", "");
    await expect(
      main.getByText("Fixed: the post has a publish date, and links to it must keep working."),
    ).toBeVisible();

    await main.getByRole("button", { name: "Unpublish" }).click();
    await expect(
      main.getByText("The post is a draft again and no longer on the storefront."),
    ).toBeVisible();
    await expect(main.getByRole("button", { name: /^Publish again with the date / })).toBeVisible();

    await main.getByLabel("Date and time").fill("2099-03-01T10:00");
    await main.getByRole("button", { name: "Publish at this time" }).click();
    await expect(main.getByText("The post is scheduled.")).toBeVisible();
    await expect(main.getByText("Scheduled", { exact: true })).toBeVisible();
    const stored = await api.get<StoredPost>(`/admin/blog/posts/${post.id}`);
    expect(stored).toMatchObject({
      state: "scheduled",
      publishedAt: "2099-03-01T10:00:00.000Z",
      slugLocked: true,
    });

    // The list filters by state: the scheduled post is there, not under "Published".
    await page.getByRole("link", { name: "Back to the posts" }).first().click();
    await main.getByLabel("State").selectOption({ label: "Scheduled" });
    await expect(page).toHaveURL(/\/features\/blog\?status=scheduled$/);
    await expect(main.getByRole("link", { name: `News ${u}` })).toBeVisible();
    await main.getByLabel("State").selectOption({ label: "Published" });
    await expect(page).toHaveURL(/status=published$/);
    await expect(main.getByRole("link", { name: `News ${u}` })).toHaveCount(0);
  });

  test("a post is deleted after a confirmation", async ({ page, signIn, apiContext }, testInfo) => {
    const u = unique(testInfo);
    const api = await ownerApi(apiContext);
    const post = await api.post<StoredPost>(
      "/admin/blog/posts",
      { title: { uk: `Видалити ${u}`, en: `Delete ${u}` } },
      201,
    );
    await signIn("owner");
    await page.goto(`${SPA}/features/blog/${post.id}`);
    const main = page.getByRole("main");
    await main.getByRole("button", { name: "Delete post" }).click();
    const dialog = page.getByRole("alertdialog", { name: `Delete “Delete ${u}”?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await main.getByRole("button", { name: "Delete post" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(page.getByText("The post was deleted.")).toBeVisible();
    await api.get(`/admin/blog/posts/${post.id}`, 404);
  });

  test("the viewer reads the blog but changes nothing", async ({
    page,
    signIn,
    apiContext,
  }, testInfo) => {
    const u = unique(testInfo);
    const api = await ownerApi(apiContext);
    const post = await api.post<StoredPost>(
      "/admin/blog/posts",
      { title: { uk: `Читати ${u}`, en: `Read ${u}` }, body: { uk: "Текст.", en: "Text." } },
      201,
    );
    await signIn("viewer");
    await openList(page);
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: "New post" })).toHaveCount(0);
    await main.getByRole("link", { name: `Read ${u}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Read ${u}` })).toBeVisible();
    await expect(textbox(main, "Title (English)")).toHaveAttribute("readonly", "");
    await expect(main.getByText("Your role cannot publish posts.")).toBeVisible();
    for (const name of ["Save changes", "Publish now", "Delete post", "Upload cover"]) {
      await expect(main.getByRole("button", { name })).toHaveCount(0);
    }
    expect((await api.get<StoredPost>(`/admin/blog/posts/${post.id}`)).state).toBe("draft");

    await page.goto(`${SPA}/features/blog/new`);
    await expect(page.getByRole("heading", { level: 1, name: "Not allowed" })).toBeVisible();
  });
});
