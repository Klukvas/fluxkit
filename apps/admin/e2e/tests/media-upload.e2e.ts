import type { Locator, Page, Request } from "@playwright/test";
import { CSRF, type AdminApi } from "../support/api.ts";
import { ADMIN_E2E_ORIGIN, SPA, VIEWER_EMAIL, VIEWER_PASSWORD } from "../support/env.ts";
import { expect, test, unique } from "../support/fixtures.ts";
import {
  EXIF_SIGNATURE,
  asPayload,
  jpegFile,
  oversizedFile,
  pngFile,
  svgWithScript,
  textRenamedAsJpeg,
  webpFile,
} from "../support/images.ts";

/** A product type without attributes or options, so that a product of it can be published with one price (setup only). */
async function createProduct(
  owner: AdminApi,
  u: string,
  options: { publish: boolean },
): Promise<{ id: string; slug: string }> {
  const type = await owner.post<{ id: string }>(
    "/admin/product-types",
    { code: `media_${u}`, name: { uk: `Медіа ${u}`, en: `Media ${u}` }, requiresShipping: false },
    201,
  );
  const slug = `e2e-media-${u}`;
  const product = await owner.post<{ id: string; variants: { id: string }[] }>(
    "/admin/products",
    { productTypeId: type.id, title: { uk: `Фото ${u}`, en: `Photo ${u}` }, slug },
    201,
  );
  if (options.publish) {
    const variant = product.variants[0];
    if (variant === undefined) throw new Error("a new product has its default variant");
    await owner.put(`/admin/products/${product.id}/prices`, {
      items: [{ variantId: variant.id, currency: "UAH", amount: 12500 }],
    });
    await owner.post(`/admin/products/${product.id}/publish`, undefined);
  }
  return { id: product.id, slug };
}

async function openMediaTab(page: Page, productId: string): Promise<Locator> {
  await page.goto(`${SPA}/products/${productId}?tab=media`);
  const panel = page.getByRole("main").getByRole("tabpanel", { name: "Media" });
  await expect(panel).toBeVisible();
  return panel;
}

/** The status list of the upload queue: one item per chosen file, with the file's name and its state. */
function uploadStatus(scope: Locator, fileName: string): Locator {
  return scope
    .getByRole("list", { name: "Upload status of each file" })
    .getByRole("listitem")
    .filter({ hasText: fileName });
}

/** An `img` that the browser really decoded: loaded (not just present), with the natural size the file has. */
async function expectDecoded(image: Locator, width: number, height: number): Promise<void> {
  // The previews load lazily: bring the image into view first.
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      image.evaluate((element) =>
        element instanceof HTMLImageElement
          ? {
              complete: element.complete,
              width: element.naturalWidth,
              height: element.naturalHeight,
            }
          : null,
      ),
    )
    .toEqual({ complete: true, width, height });
}

/** The address of an `img`, which must be an uploaded file on the proxy's origin. */
async function uploadedPath(image: Locator): Promise<string> {
  const src = await image.getAttribute("src");
  if (src === null) throw new Error("the preview has no src");
  const url = new URL(src);
  expect(url.origin, "the preview comes from the proxy origin").toBe(ADMIN_E2E_ORIGIN);
  expect(url.pathname).toMatch(/^\/media\/[0-9a-f]{32}\.(jpg|png|webp)$/);
  return url.pathname;
}

const SERVED_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  "cache-control": "public, max-age=31536000, immutable",
  "cross-origin-resource-policy": "cross-origin",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
} as const;

test("the owner uploads a JPEG and a PNG: previews load through /media, alt saved, reload, the store returns the URLs, served headers, no EXIF", async ({
  page,
  signIn,
  guard,
  owner,
  apiContext,
}, testInfo) => {
  const u = unique(testInfo);
  const product = await createProduct(owner, u, { publish: true });
  const marker = `FLUXKIT-E2E-EXIF-${u}`;
  const jpeg = jpegFile(`front-${u}.jpg`, marker);
  const png = pngFile(`back-${u}.png`, 40, 30, marker);
  // The files we send do carry the metadata the server must drop.
  expect(jpeg.buffer.includes(EXIF_SIGNATURE) && jpeg.buffer.includes(marker)).toBe(true);
  expect(png.buffer.includes("eXIf") && png.buffer.includes("tEXt")).toBe(true);

  await signIn("manager");
  const mediaRequests: Request[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/media/")) mediaRequests.push(request);
  });
  const panel = await openMediaTab(page, product.id);
  await expect(panel.getByText("The product has no images yet.")).toBeVisible();

  // One selection with both files, as the file dialog would give it.
  await panel.getByLabel("Upload images").setInputFiles([asPayload(jpeg), asPayload(png)]);
  await expect(uploadStatus(panel, jpeg.name)).toContainText("Uploaded");
  await expect(uploadStatus(panel, png.name)).toContainText("Uploaded");
  await expect(panel.getByText("2 of 2 uploaded")).toBeVisible();

  const first = panel
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: "Image 1", exact: true }) });
  const second = panel
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: "Image 2", exact: true }) });
  // The previews are loaded by the browser from /media on the proxy's origin (the API serves them), with the natural size
  // of the file that was uploaded (the API re-encodes without resizing small files).
  const firstPreview = first.getByRole("img", { name: "Preview of image 1" });
  const secondPreview = second.getByRole("img", { name: "Preview of image 2" });
  await expectDecoded(firstPreview, jpeg.width, jpeg.height);
  await expectDecoded(secondPreview, png.width, png.height);
  const jpegPath = await uploadedPath(firstPreview);
  const pngPath = await uploadedPath(secondPreview);
  expect(jpegPath).toMatch(/\.jpg$/);
  expect(pngPath).toMatch(/\.png$/);

  // Alt texts (the default language is needed once any is given), then save.
  const alt = {
    firstUk: `Сорочка спереду ${u}`,
    firstEn: `Shirt front ${u}`,
    secondUk: `Сорочка ззаду ${u}`,
    secondEn: `Shirt back ${u}`,
  };
  await first
    .getByRole("textbox", { name: "Alternative text (Ukrainian)", exact: true })
    .fill(alt.firstUk);
  await first
    .getByRole("textbox", { name: "Alternative text (English)", exact: true })
    .fill(alt.firstEn);
  await second
    .getByRole("textbox", { name: "Alternative text (Ukrainian)", exact: true })
    .fill(alt.secondUk);
  await second
    .getByRole("textbox", { name: "Alternative text (English)", exact: true })
    .fill(alt.secondEn);
  await panel.getByRole("button", { name: "Save the images" }).click();
  await expect(page.getByRole("main").getByText("Saved.", { exact: true })).toBeVisible();

  // After a reload the rows come from the server: the same addresses, the alt texts, and the files load again.
  await page.reload();
  const reloaded = page.getByRole("main").getByRole("tabpanel", { name: "Media" });
  await expect(reloaded).toBeVisible();
  const urlFields = reloaded.getByRole("textbox", { name: "Address", exact: true });
  await expect(urlFields).toHaveCount(2);
  await expect(urlFields.nth(0)).toHaveValue(`${ADMIN_E2E_ORIGIN}${jpegPath}`);
  await expect(urlFields.nth(1)).toHaveValue(`${ADMIN_E2E_ORIGIN}${pngPath}`);
  await expectDecoded(reloaded.getByRole("img", { name: alt.firstEn }), jpeg.width, jpeg.height);
  await expectDecoded(reloaded.getByRole("img", { name: alt.secondEn }), png.width, png.height);

  // The shop serves the uploaded addresses, with the alt text of the requested language.
  const store = await page.request.get(`/store/products/${product.slug}?locale=en`);
  expect(store.status()).toBe(200);
  const shown = (await store.json()) as { media: { url: string; alt: string | null }[] };
  expect(shown.media.map((item) => ({ url: item.url, alt: item.alt }))).toEqual([
    { url: `${ADMIN_E2E_ORIGIN}${jpegPath}`, alt: alt.firstEn },
    { url: `${ADMIN_E2E_ORIGIN}${pngPath}`, alt: alt.secondEn },
  ]);

  // What the browser sent to /media: image loads only, and no cookie (the admin cookie is scoped to /admin).
  expect(mediaRequests.length).toBeGreaterThan(0);
  for (const request of mediaRequests) {
    expect(request.resourceType(), request.url()).toBe("image");
    expect((await request.allHeaders())["cookie"], request.url()).toBeUndefined();
  }
  const uploads = guard
    .writes()
    .filter((write) => new URL(write.url).pathname === "/admin/media/uploads");
  expect(uploads, "one upload request per file").toHaveLength(2);
  expect(uploads.filter((write) => write.csrf !== "1")).toEqual([]);

  // The stored files, read by an anonymous client (no cookies) through the proxy: fixed headers, and no metadata left.
  const anonymous = await apiContext("anonymous");
  for (const [path, type] of [
    [jpegPath, "image/jpeg"],
    [pngPath, "image/png"],
  ] as const) {
    const key = path.slice("/media/".length);
    const file = await anonymous.get(path);
    expect(file.status(), path).toBe(200);
    const headers = file.headers();
    expect(headers["content-type"]).toBe(type);
    for (const [name, value] of Object.entries(SERVED_HEADERS))
      expect(headers[name], name).toBe(value);
    expect(headers["content-disposition"]).toBe(`inline; filename="${key}"`);
    expect(headers["etag"]).toBe(`"${key}"`);
    expect(headers["set-cookie"], "the proxy and the API set no cookie on a file").toBeUndefined();
    const bytes = await file.body();
    expect(Number(headers["content-length"])).toBe(bytes.length);
    expect(bytes.includes(EXIF_SIGNATURE), "no EXIF block").toBe(false);
    expect(bytes.includes("eXIf") || bytes.includes("tEXt"), "no PNG metadata chunk").toBe(false);
    expect(bytes.includes(marker), "the marker we put into the metadata is gone").toBe(false);
    expect(
      bytes.subarray(0, 3).toString("hex") === "ffd8ff" ||
        bytes.subarray(1, 4).toString("latin1") === "PNG",
    ).toBe(true);
    // HEAD: the same headers, no body.
    const head = await anonymous.head(path);
    expect(head.status()).toBe(200);
    expect(head.headers()["content-length"]).toBe(headers["content-length"]);
    expect(head.headers()["x-content-type-options"]).toBe("nosniff");
  }
});

test("a file that is not an accepted image shows its message and adds no row", async ({
  page,
  signIn,
  guard,
  owner,
}, testInfo) => {
  const u = unique(testInfo);
  const product = await createProduct(owner, u, { publish: false });
  const config = await owner.get<{ media: { maxBytes: number } }>("/admin/config");
  const svg = svgWithScript(`logo-${u}.svg`);
  const text = textRenamedAsJpeg(`notes-${u}.jpg`);
  const huge = oversizedFile(`huge-${u}.jpg`, config.media.maxBytes + 1);

  await signIn("manager");
  const panel = await openMediaTab(page, product.id);
  const input = panel.getByLabel("Upload images");
  const uploadRequests = () =>
    guard.writes().filter((write) => new URL(write.url).pathname === "/admin/media/uploads");

  // An SVG is refused in the browser, by its type, before anything is sent.
  await input.setInputFiles(asPayload(svg));
  await expect(uploadStatus(panel, svg.name)).toContainText("Not an accepted image type");
  expect(uploadRequests()).toHaveLength(0);

  // A file over the server's limit (from GET /admin/config) is refused by size, before anything is sent.
  await panel.getByRole("button", { name: "Clear the list" }).click();
  await input.setInputFiles(asPayload(huge));
  await expect(uploadStatus(panel, huge.name)).toContainText("The file is larger than 10 MB.");
  expect(uploadRequests()).toHaveLength(0);

  // A text file called .jpg passes the browser's check (it only sees the name and the type), so it is sent, and the server
  // refuses it by its content: the message is the translated one, never the API's English sentence.
  await panel.getByRole("button", { name: "Clear the list" }).click();
  await input.setInputFiles(asPayload(text));
  await expect(uploadStatus(panel, text.name)).toContainText(
    "This file is not a JPEG, PNG or WebP image.",
  );
  expect(uploadRequests()).toHaveLength(1);
  expect(uploadRequests()[0]?.csrf).toBe("1");

  // None of them added a row, and Save has nothing to save.
  await expect(panel.getByText("The product has no images yet.")).toBeVisible();
  await expect(panel.getByRole("list", { name: "Images in display order" })).toHaveCount(0);
  expect((await owner.get<{ media: unknown[] }>(`/admin/products/${product.id}`)).media).toEqual(
    [],
  );
});

test("keyboard: the upload control keeps the focus while its file uploads and after the queue ends", async ({
  page,
  signIn,
  owner,
}, testInfo) => {
  // Step 9 review L-1: a `disabled` input dropped the focus to <body> during and after the upload.
  const u = unique(testInfo);
  const product = await createProduct(owner, u, { publish: false });
  const jpeg = jpegFile(`focus-${u}.jpg`, `FOCUS-${u}`);

  await signIn("manager");
  const panel = await openMediaTab(page, product.id);
  const input = panel.getByLabel("Upload images");
  await input.focus();
  await expect(input).toBeFocused();

  // The answer is held back so the state while the file uploads can be looked at.
  let release: () => void = () => undefined;
  const held = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/admin/media/uploads", async (route) => {
    await held;
    await route.continue();
  });
  const sent = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/admin/media/uploads",
  );
  await input.setInputFiles(asPayload(jpeg));
  await sent;
  await expect(uploadStatus(panel, jpeg.name)).toContainText("Uploading");
  await expect(input).toBeFocused();
  // Locked for assistive technology (Playwright counts aria-disabled as disabled), but not the `disabled` attribute.
  await expect(input).toBeDisabled();
  await expect(input).not.toHaveAttribute("disabled");
  await expect(input).toHaveAttribute("aria-disabled", "true");
  // The label (the control's name) stays the same while it is locked.
  await expect(panel.getByLabel("Upload images")).toHaveCount(1);

  const answered = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/admin/media/uploads",
  );
  release();
  expect((await answered).status()).toBe(201);
  await page.unroute("**/admin/media/uploads");
  await expect(uploadStatus(panel, jpeg.name)).toContainText("Uploaded");
  await expect(input).toBeFocused();
  await expect(input).not.toHaveAttribute("aria-disabled");
});

test("a viewer has no upload control and the API refuses a viewer's upload", async ({
  page,
  signIn,
  owner,
  apiContext,
}, testInfo) => {
  const u = unique(testInfo);
  const product = await createProduct(owner, u, { publish: false });
  await signIn("viewer");
  const panel = await openMediaTab(page, product.id);
  await expect(panel.getByText("The product has no images yet.")).toBeVisible();
  await expect(panel.getByLabel("Upload images")).toHaveCount(0);
  await expect(panel.getByText("Upload from your device")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Add an image" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Save the images" })).toHaveCount(0);

  // The control is a convenience; the API decides. A viewer's session is refused before the body is read.
  const viewer = await apiContext("viewer-api");
  const login = await viewer.post("/admin/auth/login", {
    headers: CSRF,
    data: { email: VIEWER_EMAIL, password: VIEWER_PASSWORD },
  });
  expect(login.status()).toBe(200);
  const refused = await viewer.post("/admin/media/uploads", {
    headers: { ...CSRF, "Content-Type": "application/octet-stream" },
    data: jpegFile("viewer.jpg").buffer,
  });
  expect(refused.status()).toBe(403);
});

test("a brand logo is uploaded into the field and survives the save", async ({
  page,
  signIn,
  owner,
}, testInfo) => {
  const u = unique(testInfo);
  const logo = webpFile(`logo-${u}.webp`);
  await signIn("manager");
  const main = page.getByRole("main");
  await page.goto(`${SPA}/catalog/brands/new`);
  await main.getByRole("textbox", { name: "Name (Ukrainian)", exact: true }).fill(`Логотип ${u}`);
  await main.getByRole("textbox", { name: "Name (English)", exact: true }).fill(`Logo ${u}`);
  await main.getByRole("textbox", { name: "Slug (part of the address)" }).fill(`logo-${u}`);

  await main.getByLabel("Upload logo").setInputFiles(asPayload(logo));
  await expect(uploadStatus(main, logo.name)).toContainText("Uploaded");
  const address = main.getByRole("textbox", { name: "Logo address", exact: true });
  await expect(address).toHaveValue(new RegExp(`^${ADMIN_E2E_ORIGIN}/media/[0-9a-f]{32}\\.webp$`));
  const url = await address.inputValue();
  await expectDecoded(
    main.getByRole("img", { name: `Logo of Логотип ${u}` }),
    logo.width,
    logo.height,
  );

  await main.getByRole("button", { name: "Create brand" }).click();
  await expect(page.getByText(`Brand Logo ${u} was created.`, { exact: true })).toBeVisible();

  // Stored with the brand, and shown again when the brand is opened from the server.
  await page.getByRole("link", { name: "Open the brand" }).click();
  await expect(main.getByRole("textbox", { name: "Logo address", exact: true })).toHaveValue(url);
  await expectDecoded(
    main.getByRole("img", { name: `Logo of Logo ${u}` }),
    logo.width,
    logo.height,
  );
  const brands = await owner.get<{ items: { slug: string; logoUrl: string | null }[] }>(
    `/admin/brands?limit=100`,
  );
  expect(brands.items.find((brand) => brand.slug === `logo-${u}`)?.logoUrl).toBe(url);
});

test("/media reaches the API: unknown keys and traversal attempts are a plain 404 that is never cached", async ({
  apiContext,
}) => {
  const anonymous = await apiContext("anonymous");
  for (const path of [
    `/media/${"0".repeat(32)}.jpg`,
    "/media/..%2f..%2fetc%2fpasswd",
    "/media/..%2f..%2f..%2f..%2fetc%2fpasswd",
    "/media/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    "/media/ab/cd/etc",
  ]) {
    const answer = await anonymous.get(path);
    expect(answer.status(), path).toBe(404);
    // The API's own answer, not the proxy's: the headers are the API's, and the key is not echoed.
    expect(answer.headers()["cache-control"], path).toBe("no-store");
    expect(answer.headers()["x-content-type-options"], path).toBe("nosniff");
    expect(answer.headers()["set-cookie"], path).toBeUndefined();
    expect(await answer.text(), path).not.toContain("etc");
  }
  // The bare prefix is also routed to the API (not to a proxy 404 text), with the same never-cached 404 (step 9 review).
  for (const path of ["/media", "/media/"]) {
    const answer = await anonymous.get(path);
    expect(answer.status(), path).toBe(404);
    expect(answer.headers()["cache-control"], path).toBe("no-store");
    expect(answer.headers()["x-content-type-options"], path).toBe("nosniff");
    expect(await answer.text(), path).not.toContain("e2e proxy");
  }
});
