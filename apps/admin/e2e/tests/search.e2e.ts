import { SPA, VIEWER_EMAIL, VIEWER_PASSWORD } from "../support/env.ts";
import { AdminApi } from "../support/api.ts";
import { expect, test, unique } from "../support/fixtures.ts";

/**
 * The Search area (search plan step 10b). The API of this suite runs with `SEARCH_ENABLED=true` against the real
 * Meilisearch, with a key scoped to this suite's prefix; `prepare-database.ts` builds the indexes once (`search/reindex.js`).
 * The scheduler is off, so jobs 13 and 14 never run: a rebuild request or a synonym change stays "waiting" and the status
 * says so, which is what these scenarios read. The "search switched off" state is covered in the browser by answering the
 * search routes with the API's own 404 (`SEARCH_ENABLED=false` mounts none of them; the API specs and the feature matrix
 * cover that side), because one run has one API.
 */

const NOT_FOUND = {
  type: "about:blank",
  title: "Not Found",
  status: 404,
  code: "not_found",
  detail: "ENGLISH-API-DETAIL-SEARCH-OFF",
};

test("status: the engine, the index of each language, the queue, and a rebuild that asks first and is requested once", async ({
  page,
  signIn,
  guard,
}) => {
  await signIn("owner");
  await page
    .getByRole("navigation", { name: "Admin sections" })
    .getByRole("link", { name: "Search", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  const main = page.getByRole("main");

  // The engine answers; one section per language with the live index of this suite's prefix and its documents.
  await expect(main.getByText("The engine answers")).toBeVisible();
  const uk = main.getByRole("region", { name: "Ukrainian" });
  const en = main.getByRole("region", { name: "English" });
  await expect(uk.getByText(/adme2e\d+_catalog_uk/)).toBeVisible();
  await expect(en.getByText(/adme2e\d+_catalog_en/)).toBeVisible();
  await expect(
    uk.locator("dt", { hasText: "Documents" }).locator("xpath=following-sibling::dd[1]"),
  ).toHaveText(/^[1-9][\d,]*$/);
  // The queue: the numbers are there (what the earlier scenarios changed waits in it: the scheduler is off).
  const queue = main.getByRole("region", { name: "Sync queue" });
  await expect(queue.getByText("Products waiting")).toBeVisible();
  await expect(queue.getByText("Oldest waiting change")).toBeVisible();

  // Refresh reads the status again.
  const reread = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/admin/search/status" && response.status() === 200,
  );
  await main.getByRole("button", { name: "Refresh" }).click();
  await reread;

  // The button only asks: the dialog opens with the safe choice focused, and nothing is sent.
  const writesBefore = guard.writes().length;
  await main.getByRole("button", { name: "Rebuild index" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Rebuild the search index?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(main.getByRole("button", { name: "Rebuild index" })).toBeFocused();
  expect(guard.writes().length, "no write before the confirmation").toBe(writesBefore);

  // Confirm, with the answer held back: the buttons are off and Escape does not close the dialog; one request in all.
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/admin/search/rebuild", async (route) => {
    await gate;
    await route.continue();
  });
  await main.getByRole("button", { name: "Rebuild index" }).click();
  await dialog.getByRole("button", { name: "Request rebuild" }).click();
  await expect(dialog.getByRole("button", { name: "Request rebuild" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  const answered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/admin/search/rebuild" && response.status() === 202,
  );
  release();
  await answered;
  await expect(dialog).toBeHidden();
  await page.unroute("**/admin/search/rebuild");

  // Honest outcome: requested, not done. Every language says a rebuild waits for the job.
  await expect(main.getByText(/Rebuild requested at .+ for: Ukrainian, English\./)).toBeVisible();
  await expect(main.getByText(/Nothing has been rebuilt yet/)).toBeVisible();
  await expect(uk.getByText("Rebuild requested", { exact: true }).first()).toBeVisible();
  await expect(en.getByText("Rebuild requested", { exact: true }).first()).toBeVisible();
  const rebuilds = guard
    .writes()
    .filter((request) => request.url.endsWith("/admin/search/rebuild"));
  expect(rebuilds).toHaveLength(1);
  expect(rebuilds[0]?.method).toBe("POST");
  expect(rebuilds[0]?.csrf).toBe("1");

  // Idempotent: asking again while it waits is accepted and changes nothing visible but the time.
  await main.getByRole("button", { name: "Rebuild index" }).click();
  await dialog.getByRole("button", { name: "Request rebuild" }).click();
  await expect(dialog).toBeHidden();
  await expect(uk.getByText("Rebuild requested", { exact: true }).first()).toBeVisible();
  expect(
    guard.writes().filter((request) => request.url.endsWith("/admin/search/rebuild")),
  ).toHaveLength(2);
});

test("synonym groups: terms checked before sending, add, edit and delete with their confirmations", async ({
  page,
  signIn,
  guard,
}, testInfo) => {
  const id = unique(testInfo);
  await signIn("owner");
  await page.goto(`${SPA}/catalog/search`);
  await page
    .getByRole("navigation", { name: "Search sections" })
    .getByRole("link", { name: "Synonyms" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Search synonyms" })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByText("Products waiting in the sync queue now:")).toBeVisible();

  // Add: a term of four words is refused on the field before anything is sent.
  await main.getByRole("button", { name: "Add group" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a synonym group" });
  await expect(dialog).toBeVisible();
  const terms = dialog.getByLabel("Terms");
  await terms.fill(`shirt${id}, long sleeve cotton top`);
  const writesBefore = guard.writes().length;
  await dialog.getByRole("button", { name: "Add group" }).click();
  await expect(
    dialog.getByText('At most 3 words per term: "long sleeve cotton top".'),
  ).toBeVisible();
  await expect(terms).toHaveAttribute("aria-invalid", "true");
  await expect(terms).toBeFocused();
  expect(guard.writes().length, "nothing is sent while the terms are wrong").toBe(writesBefore);

  // Fixed (typed in capitals and with a space: the preview shows what will be saved), then the exact request.
  const first = `викрутка${id}`;
  const second = `відвертка${id}`;
  const third = `screwdriver ${id}`;
  await terms.fill(`${first.toUpperCase()},  ${second}\n${third}`);
  await expect(dialog.getByText(`Will be saved as: ${first}, ${second}, ${third}`)).toBeVisible();
  const create = page.waitForRequest(
    (request) =>
      request.method() === "POST" && new URL(request.url()).pathname === "/admin/search/synonyms",
  );
  await dialog.getByRole("button", { name: "Add group" }).click();
  expect((await create).postDataJSON()).toEqual({ locale: "uk", terms: [first, second, third] });
  await expect(main.getByText("The group was added.")).toBeVisible();
  await expect(main.getByText("It reaches the search index with the next sync.")).toBeVisible();
  const row = main.getByRole("row", { name: new RegExp(first) });
  await expect(row).toContainText("Ukrainian");
  await expect(row).toContainText(`${first}, ${second}, ${third}`);
  // The scheduler is off, so the language waits for the settings; the page says which.
  await expect(main.getByText(/Waiting for the latest settings: .*Ukrainian/)).toBeVisible();

  // Edit: the language is fixed; unchanged terms send nothing; a changed list sends only the terms.
  await row.getByRole("button", { name: `Edit the group: ${first}, ${second}, ${third}` }).click();
  const edit = page.getByRole("dialog", { name: "Edit the synonym group" });
  await expect(edit.getByRole("combobox")).toHaveCount(0);
  await expect(edit.getByLabel("Terms")).toHaveValue(`${first}, ${second}, ${third}`);
  const editWrites = guard.writes().length;
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(
    main.getByText("The terms are the same as before, so nothing was sent."),
  ).toBeVisible();
  expect(guard.writes().length, "an unchanged list sends nothing").toBe(editWrites);

  const fourth = `hammer${id}`;
  await row.getByRole("button", { name: /^Edit the group:/ }).click();
  await edit.getByLabel("Terms").fill(`${first}, ${second}, ${fourth}`);
  const patch = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" &&
      new URL(request.url()).pathname.startsWith("/admin/search/synonyms/"),
  );
  await edit.getByRole("button", { name: "Save" }).click();
  expect((await patch).postDataJSON()).toEqual({ terms: [first, second, fourth] });
  await expect(main.getByText("The group was changed.")).toBeVisible();
  const changed = main.getByRole("row", { name: new RegExp(fourth) });
  await expect(changed).toContainText(`${first}, ${second}, ${fourth}`);

  // Delete: asks first (the safe choice focused), Cancel sends nothing, the confirmation sends one DELETE.
  const deleteName = `Delete the group: ${first}, ${second}, ${fourth}`;
  await changed.getByRole("button", { name: deleteName }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete this synonym group?" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  const deleteWrites = guard.writes().length;
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  expect(guard.writes().length, "no write before the confirmation").toBe(deleteWrites);
  await changed.getByRole("button", { name: deleteName }).click();
  await confirm.getByRole("button", { name: "Delete group" }).click();
  await expect(main.getByText("The group was deleted.")).toBeVisible();
  await expect(main.getByRole("row", { name: new RegExp(fourth) })).toHaveCount(0);
  const deletes = guard.writes().filter((request) => request.method === "DELETE");
  expect(deletes).toHaveLength(1);
  expect(deletes[0]?.csrf).toBe("1");
});

test("synonym groups: a refusal of the API is shown on the field it names, in the SPA's words", async ({
  page,
  signIn,
}) => {
  await signIn("owner");
  // The client checks everything the API checks, so a refusal is provoked by answering the create with the API's own 400 shape
  // (the English detail must never reach the page: the guard checks it).
  await page.route("**/admin/search/synonyms", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 400,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        code: "validation_failed",
        detail: "ENGLISH-API-DETAIL-SYNONYM-400",
        errors: [
          { path: "terms", code: "duplicate_terms" },
          { path: "locale", code: "invalid_value" },
        ],
      }),
    });
  });
  await page.goto(`${SPA}/catalog/search/synonyms`);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Add group" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a synonym group" });
  await dialog.getByLabel("Terms").fill("alpha, beta");
  await dialog.getByRole("button", { name: "Add group" }).click();
  const terms = dialog.getByLabel("Terms");
  await expect(
    dialog.getByText("Two terms are the same once cleaned (case and spacing do not count)."),
  ).toBeVisible();
  await expect(terms).toHaveAttribute("aria-invalid", "true");
  await expect(terms).toBeFocused();
  await expect(dialog.getByRole("combobox", { name: "Language" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  // The dialog stays open with the input in place.
  await expect(terms).toHaveValue("alpha, beta");
});

test("the viewer reads the status and the synonym groups and changes nothing", async ({
  openAs,
  owner,
  apiContext,
}, testInfo) => {
  const id = unique(testInfo);
  const group = await owner.post<{ id: string }>("/admin/search/synonyms", {
    locale: "en",
    terms: [`viewer${id}`, `readonly${id}`],
  });
  try {
    const page = await openAs("viewer");
    const nav = page.getByRole("navigation", { name: "Admin sections" });
    await nav.getByRole("link", { name: "Search", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
    const main = page.getByRole("main");
    await expect(main.getByText("The engine answers")).toBeVisible();
    await expect(main.getByText("You can read the search status.")).toBeVisible();
    await expect(main.getByRole("button", { name: "Rebuild index" })).toHaveCount(0);

    await page
      .getByRole("navigation", { name: "Search sections" })
      .getByRole("link", { name: "Synonyms" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Search synonyms" })).toBeVisible();
    await expect(main.getByText("You can read the synonym groups.")).toBeVisible();
    await expect(main.getByRole("row", { name: new RegExp(`viewer${id}`) })).toBeVisible();
    await expect(main.getByRole("button", { name: /^(Add group|Edit|Delete)/ })).toHaveCount(0);

    // The API refuses the viewer's writes as well (the UI is convenience only).
    const viewer = await AdminApi.signIn(
      await apiContext("viewer-api"),
      VIEWER_EMAIL,
      VIEWER_PASSWORD,
    );
    await viewer.get("/admin/search/status");
    await viewer.post("/admin/search/rebuild", {}, 403);
    await viewer.post("/admin/search/synonyms", { locale: "en", terms: ["a", "b"] }, 403);
    await viewer.patch(`/admin/search/synonyms/${group.id}`, { terms: ["a", "b"] }, 403);
    await viewer.delete(`/admin/search/synonyms/${group.id}`, 403);
  } finally {
    await owner.delete(`/admin/search/synonyms/${group.id}`);
  }
});

test("search switched off (the routes answer 404): both screens say so and offer no action", async ({
  page,
  signIn,
}) => {
  await signIn("owner");
  await page.route("**/admin/search/**", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/problem+json",
      body: JSON.stringify(NOT_FOUND),
    }),
  );
  await page.goto(`${SPA}/catalog/search`);
  await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByText("Search is switched off")).toBeVisible();
  await expect(main.getByText(/SEARCH_ENABLED=true, MEILI_URL and MEILI_API_KEY/)).toBeVisible();
  await expect(main.getByRole("button", { name: /Rebuild|Refresh/ })).toHaveCount(0);

  await main.getByRole("link", { name: "Synonyms" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Search synonyms" })).toBeVisible();
  await expect(main.getByText("Search is switched off")).toBeVisible();
  await expect(main.getByRole("button", { name: /Add group|Edit|Delete/ })).toHaveCount(0);
});

test("synonym groups: the empty state and a page of groups (the list answered by the test)", async ({
  page,
  signIn,
}) => {
  await signIn("owner");
  await page.route("**/admin/search/synonyms?*", async (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const items =
      url.searchParams.get("locale") === "en"
        ? []
        : [
            {
              id: `00000000-0000-4000-8000-00000000000${String(offset === 0 ? 1 : 2)}`,
              locale: "uk",
              terms: offset === 0 ? ["first", "page"] : ["second", "page"],
              createdAt: "2026-10-29T09:00:00.000Z",
              updatedAt: "2026-10-29T10:00:00.000Z",
            },
          ];
    await route.fulfill({
      json: { items, total: items.length === 0 ? 0 : 120, limit: 50, offset },
    });
  });
  await page.goto(`${SPA}/catalog/search/synonyms`);
  const main = page.getByRole("main");
  await expect(main.getByRole("row", { name: /first, page/ })).toBeVisible();
  await expect(main.getByText("1 to 1 of 120")).toBeVisible();
  await main.getByRole("link", { name: "Next page" }).click();
  await expect(page).toHaveURL(/offset=50/);
  await expect(main.getByRole("row", { name: /second, page/ })).toBeVisible();
  await expect(main.getByRole("link", { name: "Previous page" })).toBeVisible();

  await main.getByRole("combobox", { name: "Language" }).selectOption({ label: "English" });
  await expect(page).toHaveURL(/locale=en/);
  await expect(main.getByText("No synonym groups yet")).toBeVisible();
  await expect(main.getByText("This language has no synonym groups.")).toBeVisible();
});
