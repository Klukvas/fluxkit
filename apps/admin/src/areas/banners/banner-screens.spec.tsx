import { createTranslator, type Translator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import {
  leftoverText,
  messagesForArea,
  renderInRouter,
  sentinelTranslator,
  textAttributes,
  uploadControls,
} from "../../test-helpers";
import { emptyBannerForm, type BannerFormValues } from "./banner-form";
import { BannerFormView, type BannerFormViewProps } from "./banner-form-view";
import { BannerListView, type BannerListViewProps } from "./banner-list-view";
import { BannerPreviewView, type PreviewOptions } from "./banner-preview";
import { ListStatusView } from "./banners-page";
import { MESSAGE_FILES } from "./index";
import { CONTENT, PICTURE, bannerFixture } from "./test-helpers";

const sentinel = sentinelTranslator();
const noop = () => undefined;
const enMessages = await messagesForArea("en", MESSAGE_FILES);
const en = createTranslator(enMessages, "en") as Translator;

function list(overrides: Partial<BannerListViewProps> = {}): string {
  return renderInRouter(
    <BannerListView
      t={sentinel}
      uiLocale="en"
      content={CONTENT}
      banners={[]}
      canWrite
      busy={false}
      onMove={noop}
      onDrop={noop}
      onDelete={noop}
      {...overrides}
    />,
  );
}

const three = [
  bannerFixture({ id: "a", position: 0 }),
  bannerFixture({
    id: "b",
    position: 1,
    state: "scheduled",
    shownOnStorefront: false,
    startsAt: "2026-12-01T08:00:00.000Z",
    title: { uk: "Зима" },
  }),
  bannerFixture({
    id: "c",
    position: 2,
    layout: "image",
    title: null,
    text: null,
    imageAlt: { uk: "Опис", en: "Picture sale" },
    state: "inactive",
    isActive: false,
    shownOnStorefront: false,
  }),
];

describe("the banner list", () => {
  it("renders only translated text, in every state of a row", () => {
    const html = list({ banners: three });
    expect(leftoverText(html.replace(/(Spring sale|Зима|Picture sale)/g, ""))).toBe("");
    for (const value of textAttributes(html)) expect(value).toMatch(/^§|^$/);
  });

  it("is an ordered list: picture, name linking to the editor, state as text, window, the shown mark", () => {
    const html = list({ banners: three });
    expect(html).toMatch(/<ol aria-label="§banners.list.label"/);
    expect(html.match(/<li /g)).toHaveLength(3);
    expect(html).toContain('href="/admin-ui/storefront/banners/a"');
    expect(html).toContain("§banners.state.live");
    expect(html).toContain("§banners.state.scheduled");
    expect(html).toContain("§banners.state.inactive");
    expect(html.match(/§banners\.list\.shown(?!Rule)/g)).toHaveLength(1);
    // The name falls back to the default locale (no English title) and an image banner is named by its description.
    expect(html).toContain(">Зима<");
    expect(html).toContain(">Picture sale<");
    expect(html).toContain("§banners.list.from");
    expect(html).toContain("§banners.list.noWindow");
    // The thumbnail is decorative (the name is the text next to it).
    expect(html).toMatch(/<img src="https:\/\/media\.example\.com\/aa\.webp" alt=""/);
  });

  it("marks a live banner beyond the first three as live but not shown, never as plainly 'Live now'", () => {
    const html = list({ banners: [bannerFixture({ id: "d", shownOnStorefront: false })] });
    expect(html).toContain("§banners.list.liveNotShown");
    expect(html).not.toContain("§banners.state.live");
    expect(html).not.toMatch(/§banners\.list\.shown(?!Rule)/);
  });

  it("warns that a scheduled or switched-off banner after the first three live ones will not appear", () => {
    const shown = ["a", "b", "c"].map((id, position) => bannerFixture({ id, position }));
    const html = list({
      banners: [
        ...shown,
        bannerFixture({ id: "s", state: "scheduled", shownOnStorefront: false, position: 3 }),
        bannerFixture({ id: "e", state: "expired", shownOnStorefront: false, position: 4 }),
      ],
    });
    expect(html.match(/§banners\.list\.behindShown/g)).toHaveLength(1);
    expect(html).toContain("§banners.state.scheduled");
  });

  it("gives a writer move buttons named with the banner, the ends disabled, and makes rows draggable", () => {
    const html = list({ banners: three });
    expect(html).toContain('aria-label="§banners.list.moveUpLabel"');
    expect(html).toMatch(/<button[^>]*id="banner-up-a"[^>]*disabled=""/);
    expect(html).not.toMatch(/<button[^>]*id="banner-down-a"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*id="banner-down-c"[^>]*disabled=""/);
    expect(html.match(/draggable="true"/g)).toHaveLength(3);
    expect(html).toContain("§banners.list.dragHint");
  });

  it("keeps the buttons focusable while a reorder runs (aria-disabled, never disabled) and stops dragging", () => {
    const html = list({ banners: three, busy: true });
    expect(html).toMatch(/<button[^>]*id="banner-down-a"[^>]*aria-disabled="true"/);
    expect(html).not.toMatch(/<button[^>]*id="banner-down-a"[^>]*\sdisabled=""/);
    expect(html).not.toContain('draggable="true"');
  });

  it("shows a reader no write control at all", () => {
    const html = list({ banners: three, canWrite: false });
    expect(html).not.toContain("<button");
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain("§banners.list.dragHint");
  });

  it("has an empty state with the create link for a writer only", () => {
    expect(list()).toContain("§banners.list.emptyTitle");
    expect(list()).toContain('href="/admin-ui/storefront/banners/new"');
    expect(list({ canWrite: false })).not.toContain("/storefront/banners/new");
  });

  it("says so when 50 banners are stored", () => {
    const fifty = Array.from({ length: 50 }, (_, index) =>
      bannerFixture({ id: `id${String(index)}`, position: index }),
    );
    expect(list({ banners: fifty })).toContain("§banners.list.capTitle");
    expect(list({ banners: three })).not.toContain("§banners.list.capTitle");
  });

  it("reads well in English", () => {
    const html = renderInRouter(
      <BannerListView
        t={en}
        uiLocale="en"
        content={CONTENT}
        banners={three}
        canWrite
        busy={false}
        onMove={noop}
        onDrop={noop}
        onDelete={noop}
      />,
    );
    expect(html).toContain("Live now");
    expect(html).toContain("Shown on the storefront");
    expect(html).toContain('aria-label="Move up: Spring sale"');
    expect(html).toContain("Picture only");
  });
});

describe("the status line of the list", () => {
  it("is always a live region and announces a move and a delete", () => {
    expect(renderInRouter(<ListStatusView t={en} status={null} />)).toContain('role="status"');
    expect(
      renderInRouter(
        <ListStatusView t={en} status={{ kind: "moved", name: "Sale", position: 2, count: 3 }} />,
      ),
    ).toContain("“Sale” moved to position 2 of 3.");
    expect(
      renderInRouter(<ListStatusView t={en} status={{ kind: "deleted", name: "Sale" }} />),
    ).toContain("Banner “Sale” deleted.");
  });
});

function form(
  values: BannerFormValues,
  overrides: Partial<BannerFormViewProps> = {},
  t: Translator = sentinel,
): string {
  const controls = uploadControls({ maxFiles: 1 });
  return renderInRouter(
    <BannerFormView
      t={t}
      uiLocale="en"
      content={CONTENT}
      mode="create"
      values={values}
      onChange={noop}
      issues={{}}
      summary={[]}
      busy={false}
      canWrite
      onSubmit={noop}
      cancelTo="/storefront/banners"
      upload={{ uploadsEnabled: true, running: false, controlsFor: () => controls }}
      zone="Europe/Kyiv, UTC+02:00"
      warnings={[]}
      preview={<p>preview-slot</p>}
      {...overrides}
    />,
  );
}

const blank = emptyBannerForm(CONTENT.locales);
const card: BannerFormValues = {
  ...blank,
  title: { uk: "Розпродаж", en: "Sale" },
  picture: { ...PICTURE },
  link: "/catalog",
};

describe("the banner form", () => {
  it("renders only translated text and a post form without action", () => {
    const html = form(card);
    expect(leftoverText(html.replace(/preview-slot|Розпродаж|Sale|Ukrainian|English/g, ""))).toBe(
      "",
    );
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).not.toMatch(/<form[^>]*action=/);
  });

  it("offers copying the main language's text into an empty field of another language only (UX round 2)", () => {
    const values: BannerFormValues = {
      ...card,
      title: { uk: "Розпродаж", en: "" },
      text: { uk: "Знижки", en: "Already translated" },
    };
    const html = form(values);
    // Only the English title: the English text has its own, the alt text has no main-language text, uk is the main one.
    expect(html.match(/§banners\.form\.copyDefault</g)).toHaveLength(1);
    const englishTitle = html.indexOf('id="banner-title-en"');
    const button = html.indexOf("§banners.form.copyDefault<");
    expect(button).toBeGreaterThan(englishTitle);
    expect(button).toBeLessThan(html.indexOf('id="banner-text-en"'));
    // Label in name (WCAG 2.5.3, review m3 of PR 235): no aria-label; the name is the visible text, then the field in a
    // visually hidden part.
    const english = form(values, {}, en);
    const copyButton =
      /<button[^>]*>Copy from the main language[^]*?<\/button>/.exec(english)?.[0] ?? "";
    expect(copyButton).not.toContain("aria-label");
    expect(copyButton.replace(/<[^>]*>/g, "")).toBe(
      "Copy from the main language (Ukrainian) into “Title (English)”",
    );
    expect(copyButton).toMatch(/<span class="sr-only[^"]*"> into “Title \(English\)”<\/span>/);
    // Nothing to copy for a reader.
    expect(form(values, { canWrite: false })).not.toContain("§banners.form.copyDefault");
  });

  it("card: one fieldset per content locale with title, text and the optional picture description", () => {
    const html = form(card);
    expect(html.match(/<fieldset class="flex flex-col gap-4">/g)).toHaveLength(2);
    for (const locale of ["uk", "en"]) {
      expect(html).toContain(`id="banner-title-${locale}"`);
      expect(html).toContain(`id="banner-text-${locale}"`);
      expect(html).toContain(`id="banner-imageAlt-${locale}"`);
      expect(html).toMatch(
        new RegExp(
          `id="banner-title-${locale}"[^>]*lang="${locale}"|lang="${locale}"[^>]*id="banner-title-${locale}"`,
        ),
      );
    }
    expect(html).toContain("§banners.form.altCardHint");
    expect(html).not.toContain("§banners.form.imageTextTitle");
    expect(html).toContain('id="banner-tone-accent"');
  });

  it("image: hides title, text and tone, requires the description and warns that text in a picture is not read", () => {
    const html = form({ ...card, layout: "image" });
    expect(html).not.toContain('id="banner-title-uk"');
    expect(html).not.toContain('id="banner-text-uk"');
    expect(html).not.toContain("banner-tone");
    expect(html).toContain('id="banner-imageAlt-uk"');
    expect(html).toContain("§banners.form.imageTextTitle");
    expect(html).toContain("§banners.form.altImageHint");
    expect(html).toMatch(/<input[^>]*id="banner-layout-image"[^>]*checked=""/);
  });

  it("has a main picture slot and one per locale: 'uses the main picture' until one is uploaded, then size and remove", () => {
    const html = form({
      ...card,
      localePictures: { en: { ...PICTURE, uploadId: "en", width: 1200, height: 900 } },
    });
    expect(html).toContain("§banners.picture.defaultHeading");
    expect(html.match(/§banners\.picture\.localeHeading/g)).toHaveLength(2);
    expect(html.match(/§banners\.picture\.usesDefault/g)).toHaveLength(1);
    expect(html.match(/§banners\.picture\.removeLocale/g)).toHaveLength(1);
    expect(html).toContain("§banners.picture.localesUsingDefault");
    // Real size and the 2:1 check, in text (never colour alone).
    expect(html.match(/§banners\.picture\.size/g)).toHaveLength(2);
    expect(html).toContain("§banners.picture.ratioOk");
    expect(html).toContain("§banners.picture.ratioOff");
    expect(html.match(/type="file"/g)).toHaveLength(3);
  });

  it("explains disabled uploads and offers no file input", () => {
    const html = form(card, {
      upload: { uploadsEnabled: false, running: false, controlsFor: () => uploadControls() },
    });
    expect(html).toContain("§banners.picture.uploadsOffTitle");
    expect(html).toContain("§banners.picture.uploadsOffCreate");
    expect(html).not.toContain('type="file"');
  });

  it("offers going back to the main picture with uploads switched off (it needs no upload)", () => {
    const html = form(
      { ...card, localePictures: { en: { ...PICTURE, uploadId: "en" } } },
      { upload: { uploadsEnabled: false, running: false, controlsFor: () => uploadControls() } },
    );
    expect(html).not.toContain('type="file"');
    expect(html.match(/§banners\.picture\.removeLocale/g)).toHaveLength(1);
  });

  it("marks a refusal of a whole field: title, text and description at the default locale, layout and tone at their controls", () => {
    const html = form(card, {
      issues: {
        title: { key: "errors.reason.not_allowed_for_layout" },
        text: { key: "errors.reason.invalid_type" },
        layout: { key: "errors.reason.invalid_value" },
        tone: { key: "errors.reason.required" },
      },
    });
    expect(html).toMatch(/<input[^>]*id="banner-title-uk"[^>]*aria-invalid="true"/);
    expect(html).not.toMatch(/<input[^>]*id="banner-title-en"[^>]*aria-invalid="true"/);
    expect(html).toMatch(/<textarea[^>]*id="banner-text-uk"[^>]*aria-invalid="true"/);
    expect(html).toContain('id="banner-layout-error"');
    expect(html).toContain("§errors.reason.invalid_value");
    expect(html).toContain('id="banner-tone-error"');
    expect(html).toContain("§errors.reason.required");
    const image = form({ ...card, layout: "image" }, { issues: { imageAlt: { key: "x" } } });
    expect(image).toMatch(/<textarea[^>]*id="banner-imageAlt-uk"[^>]*aria-invalid="true"/);
  });

  it("lets the link rule report a too long link (no maxLength cuts it off)", () => {
    expect(form(card)).not.toMatch(/<input[^>]*id="banner-link"[^>]*maxLength/i);
  });

  it("says under the date field when the typed time is skipped or occurs twice, and warns about a missing language", () => {
    const html = form(card, {
      warnings: [
        { kind: "time", field: "startsAt", note: "gap", shown: "2026-03-29 04:30 UTC+03:00" },
        { kind: "time", field: "endsAt", note: "ambiguous", shown: "2026-10-25 03:30 UTC+03:00" },
        { kind: "missingLanguage", path: "title.en" },
      ],
    });
    expect(html).toMatch(/id="banner-startsAt-hint"[^>]*>[^<]*§banners\.form\.timeGap/);
    expect(html).toMatch(/id="banner-endsAt-hint"[^>]*>[^<]*§banners\.form\.timeAmbiguous/);
    expect(html).toMatch(/id="banner-title-en-hint"[^>]*>[^<]*§banners\.form\.missingLanguage/);
  });

  it("locks Save while a picture uploads", () => {
    const html = form(card, {
      upload: {
        uploadsEnabled: true,
        running: true,
        controlsFor: () => uploadControls({ running: true }),
      },
    });
    const submit = /<button[^>]*type="submit"[^>]*>/.exec(html)?.[0] ?? "";
    expect(submit).toContain('disabled=""');
  });

  it("is read-only without write permission: no upload, no actions, inputs read-only", () => {
    const html = form(card, { canWrite: false });
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('type="submit"');
    expect(html).toMatch(/<input[^>]*id="banner-title-uk"[^>]*readOnly=""/);
    expect(html).toMatch(/<input[^>]*id="banner-isActive"[^>]*disabled=""/);
  });

  it("shows the time zone with the date fields, the live length of each text and the field errors", () => {
    const html = form(card, {
      issues: {
        link: { key: "banners.link.locale_prefix" },
        "title.en": { key: "banners.form.requiredToActivate" },
        imageUploadId: { key: "errors.reason.upload_not_found" },
      },
      summary: [{ key: "dict.form.checkFields" }],
      warnings: [{ kind: "ended" }],
    });
    expect(html).toContain("§banners.form.zone");
    expect(html).toMatch(
      /type="datetime-local"[^>]*aria-describedby="[^"]*banner-zone"|aria-describedby="[^"]*banner-zone"[^>]*type="datetime-local"/,
    );
    expect(html).toContain("§banners.form.count");
    expect(html).toContain("§banners.link.locale_prefix");
    expect(html).toContain("§banners.form.requiredToActivate");
    expect(html).toContain("§errors.reason.upload_not_found");
    expect(html).toContain("§dict.form.checkFields");
    expect(html).toContain("§banners.form.endedWarning");
    expect(html).toMatch(/<input[^>]*id="banner-title-en"[^>]*aria-invalid="true"/);
  });

  it("puts a missing main picture ON its slot: the file input invalid and described by the message (UX round 2)", () => {
    const html = form(
      { ...card, layout: "image", picture: null, localePictures: { uk: PICTURE, en: PICTURE } },
      {
        issues: { imageUploadId: { key: "banners.form.pictureRequired" } },
        summary: [{ key: "dict.form.checkFields" }],
      },
    );
    const input = /<input[^>]*id="banner-imageUploadId-upload"[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('aria-describedby="banner-imageUploadId-error"');
    // Read once: only the input refers to the message (the group would repeat it).
    expect(html.match(/aria-describedby="banner-imageUploadId-error"/g)).toHaveLength(1);
    expect(html).toMatch(/<p id="banner-imageUploadId-error"[^>]*>§banners\.form\.pictureRequired/);
    // Seen too, not only announced: the slot's frame takes the danger colour.
    expect(html).toMatch(
      /<div class="[^"]*border-danger[^"]*" role="group" aria-labelledby="banner-imageUploadId-heading"/,
    );
    // A language's own picture slot is not marked.
    expect(/<input[^>]*id="banner-picture-en-upload"[^>]*>/.exec(html)?.[0]).not.toContain(
      "aria-invalid",
    );
  });

  it("marks a language required only where the save would be blocked (second review of PR 230, item 4)", () => {
    const requiredInput = (html: string, id: string) =>
      new RegExp(`<input[^>]*id="${id}"[^>]*required=""`).test(html);
    const active = { ...card, isActive: true, title: { uk: "Розпродаж", en: "" } };
    // A create that switches it on: every language is required.
    expect(requiredInput(form(active), "banner-title-en")).toBe(true);
    // Already on with English missing (the API allows it), and this edit does not touch it: a warning, no required mark.
    const html = form(active, {
      mode: "edit",
      initial: active,
      warnings: [{ kind: "missingLanguage", path: "title.en" }],
    });
    expect(requiredInput(html, "banner-title-en")).toBe(false);
    expect(requiredInput(html, "banner-title-uk")).toBe(true);
    expect(html).toContain("§banners.form.missingLanguage");
    // Switched on by this edit: required again.
    expect(
      requiredInput(
        form(active, { mode: "edit", initial: { ...active, isActive: false } }),
        "banner-title-en",
      ),
    ).toBe(true);
  });

  it("names the offset of the reading used for a doubled hour", () => {
    const html = form(
      card,
      {
        warnings: [
          { kind: "time", field: "endsAt", note: "ambiguous", shown: "2026-10-25 03:30 UTC+03:00" },
        ],
      },
      en,
    );
    expect(html).toContain("the earlier one is used, 2026-10-25 03:30 UTC+03:00.");
  });

  it("says that an https link leaves the shop", () => {
    expect(form({ ...card, link: "https://example.com" })).toContain("§banners.form.linkExternal");
    expect(form(card)).not.toContain("§banners.form.linkExternal");
  });

  it("reads well in English (labels name the language)", () => {
    const html = form(card, {}, en);
    expect(html).toContain("Title (Ukrainian)");
    expect(html).toContain("Times are in your computer");
    expect(html).toContain("9 of 80 characters.");
  });
});

function preview(values: BannerFormValues, options: Partial<PreviewOptions> = {}, t = sentinel) {
  return renderInRouter(
    <BannerPreviewView
      t={t}
      uiLocale="en"
      content={CONTENT}
      values={values}
      options={{ locale: "uk", theme: "light", device: "desktop", ...options }}
      onOptionsChange={noop}
    />,
  );
}

describe("the live preview", () => {
  it("draws the shared BannerCard, labelled approximate, never as a link", () => {
    const html = preview({ ...card, text: { uk: "Знижки", en: "" } });
    expect(html).toContain("§banners.preview.approximate");
    expect(html).not.toContain("<a ");
    expect(html).toContain("aspect-2/1");
    expect(html).toContain(">Розпродаж<");
    expect(html).toContain(">Знижки<");
    expect(leftoverText(html.replace(/Розпродаж|Знижки|Ukrainian|English/g, ""))).toBe("");
  });

  it("scopes the dark theme to the preview box only, and switches the width for a phone", () => {
    const dark = preview(card, { theme: "dark", device: "phone" });
    expect(dark.match(/data-theme="/g)).toHaveLength(1);
    expect(dark).toMatch(/data-theme="dark"[^>]*data-preview-device="phone"/);
    expect(dark).toContain("max-w-xs");
    expect(preview(card)).toMatch(/data-theme="light"[^>]*data-preview-device="desktop"/);
    expect(preview(card)).toContain("grid-cols-3");
  });

  it("shows the locale's own picture, else the main one, with the texts' per-field fallback", () => {
    const values: BannerFormValues = {
      ...card,
      text: { uk: "Знижки", en: "" },
      localePictures: {
        en: { ...PICTURE, uploadId: "en", url: "https://media.example.com/en.webp" },
      },
    };
    const english = preview(values, { locale: "en" });
    expect(english).toContain('src="https://media.example.com/en.webp"');
    expect(english).toContain(">Sale<");
    // No English text: the Ukrainian one, as the store answers.
    expect(english).toContain(">Знижки<");
    expect(english).toContain('lang="en"');
    expect(english).toContain("§banners.preview.ownPicture");
    const ukrainian = preview(values, { locale: "uk" });
    expect(ukrainian).toContain(`src="${PICTURE.url}"`);
    expect(ukrainian).toContain("§banners.preview.defaultPicture");
  });

  it("image layout: the picture alone, its alt from the description; a placeholder without a picture", () => {
    const html = preview({ ...card, layout: "image", imageAlt: { uk: "Опис акції", en: "" } });
    expect(html).toMatch(/<img[^>]*alt="Опис акції"/);
    expect(html).not.toContain("<h3");
    expect(preview({ ...card, picture: null })).toContain("§banners.preview.noPicture");
  });
});
