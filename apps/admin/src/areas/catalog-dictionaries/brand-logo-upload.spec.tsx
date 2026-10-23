import { createTranslator, type Translator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import {
  leftoverText,
  messagesForArea,
  renderInRouter,
  sentinelTranslator,
  uploadControls,
} from "../../test-helpers";
import { BrandFormView } from "./brand-form-view";
import { emptyBrandForm } from "./dictionary-forms";
import { MESSAGE_FILES } from "./index";
import type { UploadControls } from "./upload-panel";
import type { UploadItem } from "./upload-queue";

/** The brand form's "Upload logo" button in each state (plan 2026-10-23-media-upload, section 6). */
const content = { defaultLocale: "uk", locales: ["uk", "en"] };
let t: Translator = sentinelTranslator();
const noop = () => undefined;

function form(options: {
  canWrite?: boolean;
  uploadsEnabled?: boolean;
  upload?: UploadControls;
  logoUrl?: string;
  busy?: boolean;
}) {
  return renderInRouter(
    <BrandFormView
      t={t}
      uiLocale="en"
      content={content}
      mode="edit"
      idPrefix="brand"
      values={{
        ...emptyBrandForm(content.locales),
        slug: "acme",
        logoUrl: options.logoUrl ?? "https://shop.example/media/logo.png",
      }}
      onChange={noop}
      issues={{}}
      summary={[]}
      busy={options.busy ?? false}
      canWrite={options.canWrite ?? true}
      onSubmit={noop}
      cancelTo="/catalog/brands"
      logoAlt="Logo of Acme"
      uploadsEnabled={options.uploadsEnabled ?? true}
      upload={options.upload ?? uploadControls({ maxFiles: 1 })}
    />,
  );
}

const fileInputs = (html: string) =>
  [...html.matchAll(/<input\b[^>]*type="file"[^>]*>/g)].map((match) => match[0]);
const isDisabled = (tag: string) => /\sdisabled=""/.test(tag);
const submitButton = (html: string) => /<button\b[^>]*type="submit"[^>]*>/.exec(html)?.[0] ?? "";
const item = (name: string, state: UploadItem["state"]): UploadItem => ({ id: 1, name, state });

describe("brand form: Upload logo", () => {
  it("offers a labelled button around ONE visually hidden single-file input, next to the logo address", () => {
    const html = form({});
    const inputs = fileInputs(html);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toContain('class="sr-only"');
    expect(inputs[0]).not.toContain("multiple");
    expect(inputs[0]).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toMatch(
      /<label\b[^>]*for="brand-logoUpload"[^>]*>\s*<span>§dict\.upload\.logo<\/span>/,
    );
    expect(html).toContain("§dict.brand.logoUploadHint");
    // The address field stays and is where an upload lands.
    expect(html).toContain('id="brand-logoUrl"');
    expect(html).toContain('name="logoUrl"');
    // The preview of the logo stays (lazy, no referrer, alt from the brand).
    expect(html).toContain('src="https://shop.example/media/logo.png"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('alt="Logo of Acme"');
  });

  it("builds accept from the server's types", () => {
    const narrow = uploadControls({
      maxFiles: 1,
      limits: { maxBytes: 100, contentTypes: ["image/webp"] },
    });
    expect(fileInputs(form({ upload: narrow }))[0]).toContain('accept="image/webp"');
  });

  it("offers nothing when uploads are off (and says so), nor to a viewer", () => {
    const off = form({ uploadsEnabled: false });
    expect(fileInputs(off)).toEqual([]);
    expect(off).toContain("§dict.brand.logoUploadsOff");
    expect(off).toContain('id="brand-logoUrl"');
    for (const uploadsEnabled of [true, false]) {
      const viewer = form({ canWrite: false, uploadsEnabled });
      expect(fileInputs(viewer)).toEqual([]);
      expect(viewer).not.toContain("§dict.upload.logo");
      expect(viewer).not.toContain("§dict.brand.logoUploadsOff");
      expect(viewer).not.toContain('type="submit"');
    }
  });

  it("locks the file input and Save while the logo uploads, with the normal label on Save", () => {
    const html = form({
      upload: uploadControls({
        maxFiles: 1,
        running: true,
        items: [item("logo.png", { status: "uploading" })],
      }),
    });
    expect(isDisabled(fileInputs(html)[0] as string)).toBe(true);
    expect(isDisabled(submitButton(html))).toBe(true);
    expect(html).toContain("§dict.form.save");
    expect(html).not.toContain("§dict.form.saving");
    expect(html).toContain("§dict.upload.state.uploading");
    expect(html).toContain("logo.png");
    expect(isDisabled(submitButton(form({})))).toBe(false);
  });

  it("shows a refusal, a failure and a lost answer as translated status text", () => {
    const refusal = form({
      upload: uploadControls({
        maxFiles: 1,
        items: [item("a.svg", { status: "rejected", reason: "unsupportedType" })],
      }),
    });
    expect(refusal).toContain("§dict.upload.reject.unsupportedType");
    const failed = form({
      upload: uploadControls({
        maxFiles: 1,
        items: [
          item("a.png", { status: "failed", message: { key: "errors.reason.corrupt_image" } }),
        ],
      }),
    });
    expect(failed).toContain("§errors.reason.corrupt_image");
    const lost = form({
      upload: uploadControls({ maxFiles: 1, items: [item("a.png", { status: "unknown" })] }),
    });
    expect(lost).toContain("§dict.upload.unknown");
    expect(lost).toMatch(/role="status"/);
  });

  it("has no hardcoded text", () => {
    const html = form({
      upload: uploadControls({
        maxFiles: 1,
        items: [item("a.png", { status: "added", url: "https://shop.example/media/a.png" })],
      }),
    });
    expect(leftoverText(html.replace(/>[^<>]*\.(png)</g, "><"))).toBe("");
  });

  it("renders with the real uk and en messages", async () => {
    const sentinel = t;
    try {
      for (const locale of ["uk", "en"] as const) {
        t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
        const html = form({
          upload: uploadControls({
            maxFiles: 1,
            items: [item("a.png", { status: "unknown" })],
          }),
        });
        expect(html).toContain(locale === "en" ? "Upload logo" : "Завантажити логотип");
        expect(html).toContain(locale === "en" ? "may have been stored" : "міг зберегтися");
        expect(form({ uploadsEnabled: false })).toContain("<form");
      }
    } finally {
      t = sentinel;
    }
  });
});
