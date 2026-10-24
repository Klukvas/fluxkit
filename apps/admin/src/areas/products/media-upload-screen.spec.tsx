import { createTranslator, type Translator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import {
  TEST_UPLOAD_LIMITS,
  leftoverText,
  messagesForArea,
  renderInRouter,
  sentinelTranslator,
  textAttributes,
  uploadControls,
} from "../../test-helpers";
import type { UploadControls } from "../catalog-dictionaries/upload-panel";
import type { UploadItem } from "../catalog-dictionaries/upload-queue";
import { MESSAGE_FILES } from "./index";
import { MAX_MEDIA, mediaRowsFrom, newMediaRow, type MediaRow } from "./media-list";
import { MediaListView } from "./tabs/media-tab";

/**
 * The Media tab's upload controls in every state, as static markup (plan 2026-10-23-media-upload, section 6): who sees
 * them, what the file input is, what a running or finished queue shows, and that Save and the row buttons are locked
 * while files upload.
 */
const content = { defaultLocale: "uk", locales: ["uk", "en"] };
let t: Translator = sentinelTranslator();
const noop = () => undefined;
const stamp = "2026-10-23T10:00:00.000Z";

const stored = (id: string, position: number, url: string) => ({
  id,
  url,
  alt: null,
  position,
  optionId: null,
  optionValueId: null,
  createdAt: stamp,
  updatedAt: stamp,
});
const twoRows = (): MediaRow[] =>
  mediaRowsFrom(
    [
      stored("a", 0, "https://img.example/a.jpg"),
      stored("b", 1, "https://shop.example/media/b.jpg"),
    ],
    content.locales,
  );

function view(options: {
  canWrite?: boolean;
  uploadsEnabled?: boolean;
  rows?: readonly MediaRow[];
  upload?: UploadControls;
  busy?: boolean;
}) {
  return renderInRouter(
    <MediaListView
      t={t}
      uiLocale="en"
      content={content}
      rows={options.rows ?? twoRows()}
      onChange={noop}
      onAdd={noop}
      links={[]}
      issues={{}}
      summary={[]}
      problems={[]}
      busy={options.busy ?? false}
      canWrite={options.canWrite ?? true}
      uploadsEnabled={options.uploadsEnabled ?? true}
      upload={options.upload ?? uploadControls()}
      onSubmit={noop}
    />,
  );
}

const fileInputs = (html: string) =>
  [...html.matchAll(/<input\b[^>]*type="file"[^>]*>/g)].map((m) => m[0]);
/** The class string of every `Button` has `disabled:opacity-50`, so only the attribute counts. */
const isDisabled = (tag: string) => /\sdisabled=""/.test(tag);
/** The opening tag of the button whose text is exactly `text`. */
const buttonWith = (html: string, text: string) =>
  new RegExp(`<button\\b[^>]*>${text.replace(/\./g, "\\.")}</button>`).exec(html)?.[0] ?? "";
const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
const item = (id: number, name: string, state: UploadItem["state"]): UploadItem => ({
  id,
  name,
  state,
});

describe("Media tab upload controls: who sees them", () => {
  it("shows a labelled upload button around ONE visually hidden multiple file input to a writer when uploads are on", () => {
    const html = view({});
    const inputs = fileInputs(html);
    expect(inputs).toHaveLength(1);
    const input = inputs[0] as string;
    expect(input).toContain('class="sr-only"');
    expect(input).toContain("multiple");
    expect(input).not.toContain("name=");
    expect(isDisabled(input)).toBe(false);
    expect(html).toMatch(
      /<label\b[^>]*for="product-media-upload"[^>]*>\s*<span>§dict\.upload\.images<\/span>\s*<input\b/,
    );
    expect(html).toContain("§products.media.uploadHint");
    expect(html).toContain("§products.media.dropHint");
    expect(html).toContain("§products.media.uploadLimits");
    expect(html).toContain("border-dashed");
    expect(html).not.toContain("§products.media.uploadsOff");
  });

  it("builds the input's accept attribute from the server's content types, not from a list of its own", () => {
    expect(fileInputs(view({}))[0]).toContain('accept="image/jpeg,image/png,image/webp"');
    const narrow = uploadControls({ limits: { maxBytes: 1000, contentTypes: ["image/png"] } });
    expect(fileInputs(view({ upload: narrow }))[0]).toContain('accept="image/png"');
    expect(TEST_UPLOAD_LIMITS.contentTypes).toHaveLength(3);
  });

  it("offers no upload control with uploads switched off, and says images can still be added by address", () => {
    const html = view({ uploadsEnabled: false });
    expect(fileInputs(html)).toEqual([]);
    expect(html).toContain("§products.media.uploadsOff");
    expect(html).not.toContain("§dict.upload.images");
    expect(html).not.toContain("border-dashed");
    // URL entry stays.
    expect(html).toContain('id="product-media-0-url"');
    expect(html).toContain("§products.media.add");
  });

  it("offers nothing to a viewer, with uploads on or off, and no hint about uploads either", () => {
    for (const uploadsEnabled of [true, false]) {
      const html = view({ canWrite: false, uploadsEnabled });
      expect(fileInputs(html), String(uploadsEnabled)).toEqual([]);
      expect(html).not.toContain("§dict.upload.images");
      expect(html).not.toContain("§products.media.uploadsOff");
      expect(html).not.toContain("§products.media.uploadHint");
      expect(html).not.toContain("border-dashed");
      expect(buttons(html)).toEqual([]);
    }
  });

  it("keeps the address field and the whole-list save exactly as they were", () => {
    const html = view({});
    expect(html).toMatch(/<form\b[^>]*method="post"/);
    expect(html).not.toMatch(/<form\b[^>]*action=/);
    expect(html).toContain('name="media.0.url"');
    expect(html).toContain("§products.media.save");
  });

  it("offers no upload at the 100-row limit, and shows the limit text", () => {
    const full = Array.from({ length: MAX_MEDIA }, (_, index) => ({
      ...newMediaRow(`r${index}`, content.locales),
      url: `https://img.example/${index}.jpg`,
    }));
    const html = view({ rows: full });
    expect(fileInputs(html)).toEqual([]);
    expect(html).toContain("§products.media.full");
    expect(html).not.toContain("border-dashed");
  });
});

describe("Media tab while files upload", () => {
  const running = uploadControls({
    running: true,
    items: [
      item(1, "one.jpg", { status: "added", url: "https://shop.example/media/x.jpg" }),
      item(2, "two.png", { status: "uploading" }),
      item(3, "three.webp", { status: "queued" }),
    ],
  });

  it("locks the file input (aria-disabled, never disabled: it keeps the focus), disables Save, Add, and every row button; offers to cancel the waiting files", () => {
    const html = view({ upload: running });
    // A disabled input would drop the keyboard focus to <body> (step 9 review L-1).
    expect(isDisabled(fileInputs(html)[0] as string)).toBe(false);
    expect(fileInputs(html)[0]).toContain('aria-disabled="true"');
    const submit = buttons(html).filter((button) => button.includes('type="submit"'));
    expect(submit).toHaveLength(1);
    expect(isDisabled(submit[0] as string)).toBe(true);
    // Not the "saving" label: it is a lock, not a save in progress.
    expect(html).toContain("§products.media.save");
    expect(html).not.toContain("§products.form.saving");
    const rowButtons = buttons(html).filter((button) => button.includes("aria-label"));
    expect(rowButtons).toHaveLength(6);
    for (const button of rowButtons) expect(isDisabled(button), button).toBe(true);
    expect(isDisabled(buttonWith(html, "§products.media.add"))).toBe(true);
    expect(html).toContain("§dict.upload.cancel");
  });

  it("lists each file with its state and a polite live region with the summary", () => {
    const html = view({ upload: running });
    expect(html).toContain("one.jpg");
    expect(html).toContain("§dict.upload.state.uploading");
    expect(html).toContain("§dict.upload.state.queued");
    expect(html).toContain("§dict.upload.state.added");
    expect(html).toMatch(
      /<div role="status" aria-live="polite" aria-atomic="true">[^]*§dict\.upload\.summary/,
    );
    expect(html).toContain('aria-label="§dict.upload.listLabel"');
  });

  it("keeps Save enabled when no upload runs (the normal state)", () => {
    const submit = buttons(view({})).find((button) => button.includes('type="submit"'));
    expect(submit).toBeDefined();
    expect(isDisabled(submit as string)).toBe(false);
    const html = view({});
    expect(isDisabled(buttonWith(html, "§products.media.add"))).toBe(false);
    expect(isDisabled(fileInputs(html)[0] as string)).toBe(false);
  });
});

describe("Media tab after uploads: failures, lost answers, refusals", () => {
  const finished = uploadControls({
    items: [
      item(1, "ok.jpg", { status: "added", url: "https://shop.example/media/x.jpg" }),
      item(2, "bad.jpg", { status: "failed", message: { key: "errors.reason.corrupt_image" } }),
      item(3, "lost.jpg", { status: "unknown" }),
      item(4, "huge.jpg", { status: "rejected", reason: "fileTooLarge" }),
      item(5, "x.svg", { status: "rejected", reason: "unsupportedType" }),
      item(6, "n.jpg", { status: "cancelled" }),
      item(7, "odd.jpg", {
        status: "failed",
        message: { key: "errors.generic", code: "brand_new" },
      }),
    ],
  });

  it("shows each reason as a translated message next to the file's name", () => {
    const html = view({ upload: finished });
    for (const key of [
      "errors.reason.corrupt_image",
      "dict.upload.unknown",
      "dict.upload.reject.fileTooLarge",
      "dict.upload.reject.unsupportedType",
      "dict.upload.state.cancelled",
      "errors.generic",
    ]) {
      expect(html, key).toContain(`§${key}`);
    }
    expect(html).toContain("§errors.reference");
    // Save is enabled again and the finished list can be cleared.
    expect(html).toContain("§dict.upload.dismiss");
    expect(
      isDisabled(buttons(html).find((button) => button.includes('type="submit"')) as string),
    ).toBe(false);
  });

  it("shows a drop note", () => {
    const html = view({ upload: uploadControls({ notice: { key: "dict.upload.dropNothing" } }) });
    expect(html).toContain("§dict.upload.dropNothing");
  });

  it("renders a file name as text, never as HTML", () => {
    const html = view({
      upload: uploadControls({
        items: [item(1, "<img src=x onerror=alert(1)>.jpg", { status: "queued" })],
      }),
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;.jpg");
  });

  it("leaves no hardcoded text in the markup of any state", () => {
    for (const upload of [uploadControls(), finished]) {
      const html = view({ upload });
      expect(leftoverText(html.replace(/>[^<>]*\.(jpg|png|webp|svg)</g, "><"))).toBe("");
      expect(textAttributes(html).every((text) => text.startsWith("§") || text === "")).toBe(true);
    }
  });
});

describe("the Media tab's upload controls with the real uk and en messages", () => {
  it("render every state without a missing key (the real translator throws on one)", async () => {
    const sentinel = t;
    try {
      for (const locale of ["uk", "en"] as const) {
        t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
        const states: UploadItem["state"][] = [
          { status: "queued" },
          { status: "uploading" },
          { status: "added", url: "https://shop.example/media/x.jpg" },
          { status: "failed", message: { key: "errors.reason.too_many_pixels" } },
          { status: "failed", message: { key: "dict.upload.rateLimited", values: { minutes: 2 } } },
          { status: "unknown" },
          { status: "cancelled" },
          { status: "rejected", reason: "emptyFile" },
          { status: "rejected", reason: "unsupportedType" },
          { status: "rejected", reason: "fileTooLarge" },
          { status: "rejected", reason: "tooManyFiles" },
          { status: "rejected", reason: "noRoom" },
          { status: "rejected", reason: "duplicate" },
        ];
        const html = view({
          upload: uploadControls({
            running: true,
            notice: { key: "dict.upload.dropSkipped", values: { count: 2 } },
            items: states.map((state, index) => item(index, `f${index}.jpg`, state)),
          }),
        });
        expect(html).toContain("<form");
        expect(html).toContain(locale === "en" ? "Upload images" : "Завантажити зображення");
        expect(html).toContain(locale === "en" ? "may have been stored" : "міг зберегтися");
        expect(view({ uploadsEnabled: false })).toContain("<form");
      }
    } finally {
      t = sentinel;
    }
  });
});
