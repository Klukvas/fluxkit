import type { ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  bannerCreateBody,
  bannerFieldNames,
  bannerFormFrom,
  bannerPatchBody,
  bannerProblemMapper,
  bannerWarnings,
  emptyBannerForm,
  hasBannerRatio,
  imageLocalesSent,
  localesUsingDefault,
  pictureFor,
  validateBannerForm,
  type BannerFormValues,
} from "./banner-form";
import { CONTENT, PICTURE, bannerFixture } from "./test-helpers";

const ZONE = "Europe/Kyiv";

function filled(overrides: Partial<BannerFormValues> = {}): BannerFormValues {
  return {
    ...emptyBannerForm(CONTENT.locales),
    title: { uk: "Розпродаж", en: "Sale" },
    picture: { ...PICTURE },
    link: "/catalog",
    ...overrides,
  };
}

describe("checks before sending", () => {
  it("accepts a complete card and an empty optional text", () => {
    expect(validateBannerForm(filled(), CONTENT, ZONE)).toEqual({});
  });

  it("asks for the main picture, the title in the main language and a link", () => {
    const issues = validateBannerForm(emptyBannerForm(CONTENT.locales), CONTENT, ZONE);
    expect(issues["imageUploadId"]?.key).toBe("banners.form.pictureRequired");
    expect(issues["title.uk"]?.key).toBe("banners.form.required");
    expect(issues["title.en"]).toBeUndefined();
    expect(issues["link"]?.key).toBe("banners.link.empty");
  });

  it("counts characters as the API does and names the limit", () => {
    const issues = validateBannerForm(
      filled({
        title: { uk: "я".repeat(81), en: "a".repeat(80) },
        text: { uk: "😀".repeat(200), en: "x".repeat(201) },
        imageAlt: { uk: "a".repeat(151), en: "" },
      }),
      CONTENT,
      ZONE,
    );
    expect(issues["title.uk"]).toEqual({ key: "banners.form.tooLong", values: { limit: 80 } });
    expect(issues["title.en"]).toBeUndefined();
    // 200 emoji are 400 UTF-16 units but 200 characters: allowed.
    expect(issues["text.uk"]).toBeUndefined();
    expect(issues["text.en"]).toEqual({ key: "banners.form.tooLong", values: { limit: 200 } });
    expect(issues["imageAlt.uk"]).toEqual({ key: "banners.form.tooLong", values: { limit: 150 } });
  });

  it("asks for the main language when an optional text is given only in another one", () => {
    const issues = validateBannerForm(
      filled({ text: { uk: " ", en: "Only English" } }),
      CONTENT,
      ZONE,
    );
    expect(issues["text.uk"]?.key).toBe("errors.reason.default_locale_missing");
  });

  it("image layout: needs the description in the main language, ignores the hidden title and text", () => {
    const values = filled({
      layout: "image",
      title: { uk: "", en: "" },
      text: { uk: "x".repeat(300), en: "" },
    });
    const issues = validateBannerForm(values, CONTENT, ZONE);
    expect(issues["imageAlt.uk"]?.key).toBe("banners.form.required");
    expect(issues["title.uk"]).toBeUndefined();
    expect(issues["text.uk"]).toBeUndefined();
    expect(
      validateBannerForm({ ...values, imageAlt: { uk: "Опис", en: "" } }, CONTENT, ZONE),
    ).toEqual({});
  });

  it("switched on: every language needs the text that names the banner (both languages required to activate)", () => {
    const card = filled({ isActive: true, title: { uk: "Розпродаж", en: " " } });
    expect(validateBannerForm(card, CONTENT, ZONE)["title.en"]?.key).toBe(
      "banners.form.requiredToActivate",
    );
    expect(validateBannerForm({ ...card, isActive: false }, CONTENT, ZONE)).toEqual({});
    const image = filled({ layout: "image", isActive: true, imageAlt: { uk: "Опис", en: "" } });
    expect(validateBannerForm(image, CONTENT, ZONE)["imageAlt.en"]?.key).toBe(
      "banners.form.requiredToActivate",
    );
    expect(
      validateBannerForm({ ...image, imageAlt: { uk: "Опис", en: "Alt" } }, CONTENT, ZONE),
    ).toEqual({});
  });

  it("checks the link with the core rule, the content locales included", () => {
    const reason = (link: string) =>
      validateBannerForm(filled({ link }), CONTENT, ZONE)["link"]?.key;
    expect(reason("https://example.com/sale")).toBeUndefined();
    expect(reason("  /catalog  ")).toBeUndefined();
    expect(reason("/uk/catalog")).toBe("banners.link.locale_prefix");
    expect(reason("http://example.com")).toBe("banners.link.not_path_or_https");
    expect(reason("javascript:alert(1)")).toBe("banners.link.not_path_or_https");
    expect(reason("//evil.test")).toBe("banners.link.protocol_relative");
    expect(reason("/%2e%2e/admin")).toBe("banners.link.dot_segment");
    expect(reason("https://u:p@example.com")).toBe("banners.link.credentials");
  });

  it("checks the window: real dates, end after start, years 2000 to 2199", () => {
    const window = (startsAt: string, endsAt: string) =>
      validateBannerForm(filled({ startsAt, endsAt }), CONTENT, ZONE);
    expect(window("2026-11-05T10:00", "2026-11-06T10:00")).toEqual({});
    expect(window("2026-11-05T10:00", "")).toEqual({});
    expect(window("2026-11-05T10:00", "2026-11-05T10:00")["endsAt"]?.key).toBe(
      "errors.reason.invalid_window",
    );
    expect(window("2026-11-05T10:00", "2026-11-04T10:00")["endsAt"]?.key).toBe(
      "errors.reason.invalid_window",
    );
    expect(window("1999-12-31T10:00", "")["startsAt"]?.key).toBe("errors.reason.out_of_range");
    expect(window("", "2200-01-01T10:00")["endsAt"]?.key).toBe("errors.reason.out_of_range");
    expect(window("2026-02-30T10:00", "")["startsAt"]?.key).toBe("banners.form.dateInvalid");
  });
});

describe("the activation rule on an edit (review of PR 230, m3)", () => {
  // Created through the API: switched on with the default-locale title only (the API allows it).
  const stored = filled({ isActive: true, title: { uk: "Розпродаж", en: "" } });

  it("does not block an unrelated edit of a banner that was already on; warns instead", () => {
    const next = { ...stored, link: "/sale" };
    expect(validateBannerForm(next, CONTENT, ZONE, stored)).toEqual({});
    expect(bannerWarnings(next, CONTENT.locales, ZONE, 0, stored)).toContainEqual({
      kind: "missingLanguage",
      path: "title.en",
    });
  });

  it("blocks when this save switches it on, changes the layout or empties that language's naming text", () => {
    const off = { ...stored, isActive: false };
    expect(validateBannerForm(stored, CONTENT, ZONE, off)["title.en"]?.key).toBe(
      "banners.form.requiredToActivate",
    );
    const full = { ...stored, title: { uk: "Розпродаж", en: "Sale" } };
    expect(validateBannerForm(stored, CONTENT, ZONE, full)["title.en"]?.key).toBe(
      "banners.form.requiredToActivate",
    );
    const image = { ...stored, layout: "image" as const, imageAlt: { uk: "Опис", en: "" } };
    expect(validateBannerForm(image, CONTENT, ZONE, stored)["imageAlt.en"]?.key).toBe(
      "banners.form.requiredToActivate",
    );
    // A create has no stored values: always blocked.
    expect(validateBannerForm(stored, CONTENT, ZONE)["title.en"]?.key).toBe(
      "banners.form.requiredToActivate",
    );
  });
});

describe("times the zone skips or has twice", () => {
  it("are pointed out on their field with what is saved", () => {
    const values = filled({ startsAt: "2026-03-29T03:30", endsAt: "2026-10-25T03:30" });
    expect(validateBannerForm(values, CONTENT, ZONE)).toEqual({});
    expect(bannerWarnings(values, CONTENT.locales, ZONE, 0)).toEqual([
      { kind: "time", field: "startsAt", note: "gap", shown: "2026-03-29 04:30 UTC+03:00" },
      { kind: "time", field: "endsAt", note: "ambiguous", shown: "2026-10-25 03:30 UTC+03:00" },
    ]);
  });
});

describe("warnings that do not block", () => {
  it("warn about every picture that is not 2:1 and about an end in the past", () => {
    const now = Date.UTC(2026, 10, 5, 12);
    const values = filled({
      picture: { ...PICTURE, width: 1200, height: 900 },
      localePictures: { en: { ...PICTURE, uploadId: "e", width: 1290, height: 640 } },
      endsAt: "2026-11-05T13:00",
    });
    expect(bannerWarnings(values, CONTENT.locales, ZONE, now)).toEqual([
      { kind: "ratio", locale: null, width: 1200, height: 900 },
      { kind: "ended" },
    ]);
    expect(validateBannerForm(values, CONTENT, ZONE)).toEqual({});
    expect(bannerWarnings(filled(), CONTENT.locales, ZONE, now)).toEqual([]);
  });

  it("allows 5 % off 2:1, nothing more", () => {
    expect(hasBannerRatio({ width: 1280, height: 640 })).toBe(true);
    expect(hasBannerRatio({ width: 1344, height: 640 })).toBe(true);
    expect(hasBannerRatio({ width: 1345, height: 640 })).toBe(false);
    expect(hasBannerRatio({ width: 1216, height: 640 })).toBe(true);
    expect(hasBannerRatio({ width: 1215, height: 640 })).toBe(false);
    expect(hasBannerRatio({ width: 0, height: 0 })).toBe(false);
  });
});

describe("pictures per language", () => {
  it("shows a locale its own picture, else the main one, and says which locales use the main one", () => {
    const own = { ...PICTURE, uploadId: "en-own" };
    const values = filled({ localePictures: { en: own } });
    expect(pictureFor(values, "en")).toEqual(own);
    expect(pictureFor(values, "uk")).toEqual(values.picture);
    expect(localesUsingDefault(values, CONTENT.locales)).toEqual(["uk"]);
    expect(localesUsingDefault(filled(), CONTENT.locales)).toEqual(["uk", "en"]);
  });
});

describe("request bodies", () => {
  it("create: a card with its texts, the pictures in locale order, the instants in UTC", () => {
    const values = filled({
      text: { uk: " Знижки ", en: "" },
      localePictures: {
        en: { ...PICTURE, uploadId: "en-id" },
        uk: { ...PICTURE, uploadId: "uk-id" },
      },
      tone: "accent",
      isActive: true,
      startsAt: "2026-11-05T12:00",
      endsAt: "",
      link: " /catalog ",
    });
    expect(bannerCreateBody(values, CONTENT.locales, ZONE)).toEqual({
      layout: "card",
      title: { uk: "Розпродаж", en: "Sale" },
      text: { uk: "Знижки" },
      imageUploadId: PICTURE.uploadId,
      images: [
        { locale: "uk", imageUploadId: "uk-id" },
        { locale: "en", imageUploadId: "en-id" },
      ],
      link: "/catalog",
      tone: "accent",
      isActive: true,
      startsAt: "2026-11-05T10:00:00.000Z",
    });
  });

  it("create: an image banner sends no title or text, even when the hidden fields still hold some", () => {
    const body = bannerCreateBody(
      filled({ layout: "image", imageAlt: { uk: "Опис", en: "Alt" } }),
      CONTENT.locales,
      ZONE,
    );
    expect(body).not.toHaveProperty("title");
    expect(body).not.toHaveProperty("text");
    expect(body.imageAlt).toEqual({ uk: "Опис", en: "Alt" });
  });

  it("switching the layout keeps the shared fields and the hidden texts, so switching back loses nothing", () => {
    const card = filled({ text: { uk: "Текст", en: "" }, imageAlt: { uk: "Опис", en: "" } });
    const image = { ...card, layout: "image" as const };
    const back = { ...image, layout: "card" as const };
    expect(back).toEqual(card);
    expect(image.picture).toEqual(card.picture);
    expect(image.link).toBe(card.link);
  });

  it("edit: reads a stored banner and sends only what changed", () => {
    const banner = bannerFixture({
      startsAt: "2026-11-05T10:00:00.000Z",
      images: [
        {
          locale: "en",
          uploadId: "en-id",
          url: "https://media.example.com/en.webp",
          width: 1280,
          height: 640,
        },
        {
          locale: "pl",
          uploadId: "pl-id",
          url: "https://media.example.com/pl.webp",
          width: 1280,
          height: 640,
        },
      ],
    });
    const initial = bannerFormFrom(banner, CONTENT.locales, ZONE);
    expect(initial.startsAt).toBe("2026-11-05T12:00");
    // A picture of a locale the shop no longer has is not shown in the form.
    expect(Object.keys(initial.localePictures)).toEqual(["en"]);
    expect(bannerPatchBody(initial, initial, CONTENT.locales, ZONE)).toEqual({});
    const next = {
      ...initial,
      link: "https://example.com",
      endsAt: "2026-11-06T12:00",
      localePictures: {},
    };
    expect(bannerPatchBody(initial, next, CONTENT.locales, ZONE)).toEqual({
      link: "https://example.com",
      endsAt: "2026-11-06T10:00:00.000Z",
      images: [],
    });
    expect(bannerPatchBody(initial, { ...initial, startsAt: "" }, CONTENT.locales, ZONE)).toEqual({
      startsAt: null,
    });
  });

  it("edit: a switch to image sends the layout and the description, never the title or text (the API clears them)", () => {
    const initial = bannerFormFrom(bannerFixture(), CONTENT.locales, ZONE);
    const next: BannerFormValues = {
      ...initial,
      layout: "image",
      imageAlt: { uk: "Опис", en: "Alt" },
    };
    expect(bannerPatchBody(initial, next, CONTENT.locales, ZONE)).toEqual({
      layout: "image",
      imageAlt: { uk: "Опис", en: "Alt" },
    });
  });

  it("edit: a switch back to card sends the texts again", () => {
    const initial = bannerFormFrom(
      bannerFixture({
        layout: "image",
        title: null,
        text: null,
        imageAlt: { uk: "Опис", en: "Alt" },
      }),
      CONTENT.locales,
      ZONE,
    );
    const next: BannerFormValues = {
      ...initial,
      layout: "card",
      title: { uk: "Новий", en: "New" },
    };
    expect(bannerPatchBody(initial, next, CONTENT.locales, ZONE)).toEqual({
      layout: "card",
      title: { uk: "Новий", en: "New" },
    });
  });
});

describe("the server's refusals on the form", () => {
  const fields = bannerFieldNames(CONTENT.locales);
  const problem = (errors: { path: string; code: string }[]): ProblemDetails => ({
    type: "about:blank",
    title: "Bad Request",
    status: 400,
    code: "validation_failed",
    detail: "x",
    errors: errors.map((error) => ({ ...error, message: "x" })),
  });

  it("puts each code on its field, the i18n codes at title.<locale>", () => {
    const mapped = bannerProblemMapper([])(
      problem([
        { path: "link", code: "invalid_link" },
        { path: "title.en", code: "too_long" },
        { path: "endsAt", code: "invalid_window" },
        { path: "startsAt", code: "out_of_range" },
        { path: "imageUploadId", code: "upload_not_found" },
        { path: "title", code: "not_allowed_for_layout" },
      ]),
      400,
      fields,
    );
    expect(mapped.fields).toEqual({
      link: { key: "errors.reason.invalid_link" },
      "title.en": { key: "errors.reason.too_long" },
      endsAt: { key: "errors.reason.invalid_window" },
      startsAt: { key: "errors.reason.out_of_range" },
      imageUploadId: { key: "errors.reason.upload_not_found" },
      title: { key: "errors.reason.not_allowed_for_layout" },
    });
    expect(mapped.other).toEqual([]);
  });

  it("puts an images.N refusal on the picture slot of the N-th locale sent", () => {
    const values = filled({ localePictures: { en: { ...PICTURE, uploadId: "en" } } });
    const sent = imageLocalesSent(values, CONTENT.locales);
    expect(sent).toEqual(["en"]);
    const mapped = bannerProblemMapper(sent)(
      problem([
        { path: "images.0.imageUploadId", code: "upload_not_found" },
        { path: "images.5.locale", code: "locale_not_allowed" },
      ]),
      400,
      fields,
    );
    expect(mapped.fields).toEqual({ "picture.en": { key: "errors.reason.upload_not_found" } });
    // A path the form cannot place is never dropped: it goes to the summary.
    expect(mapped.other).toEqual([{ key: "errors.reason.locale_not_allowed" }]);
  });

  it("explains the 51st banner in the summary (409 rule_violation too_many_banners)", () => {
    const mapped = bannerProblemMapper([])(
      {
        type: "about:blank",
        title: "Conflict",
        status: 409,
        code: "rule_violation",
        rule: "too_many_banners",
        detail: "x",
      },
      409,
      fields,
    );
    expect(mapped.fields).toEqual({});
    expect(mapped.other).toEqual([{ key: "errors.reason.too_many_banners" }]);
  });
});
