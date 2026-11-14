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
import type { BlogCoverUpload } from "./blog-cover-upload";
import { blogFormFrom, emptyBlogForm } from "./blog-form";
import { BlogFormView, type BlogFormViewProps } from "./blog-form-view";
import { BlogListView, type BlogListState } from "./blog-list-view";
import { BlogPublishPanel } from "./blog-publish-panel";
import { MESSAGE_FILES } from "./pages";
import { COVER, CONTENT, postFixture } from "./test-fixtures";

const sentinel = sentinelTranslator();
const noop = () => undefined;
const en = createTranslator(await messagesForArea("en", MESSAGE_FILES), "en") as Translator;
const uk = createTranslator(await messagesForArea("uk", MESSAGE_FILES), "uk") as Translator;

const upload = (overrides: Partial<BlogCoverUpload> = {}): BlogCoverUpload => ({
  uploadsEnabled: true,
  running: false,
  controls: uploadControls(),
  ...overrides,
});

function form(overrides: Partial<BlogFormViewProps> = {}, t: Translator = sentinel): string {
  return renderInRouter(
    <BlogFormView
      t={t}
      uiLocale="en"
      content={CONTENT}
      mode="edit"
      values={blogFormFrom(postFixture(), CONTENT.locales)}
      onChange={noop}
      issues={{}}
      summary={[]}
      busy={false}
      canWrite
      slugLocked={false}
      onSubmit={noop}
      cancelTo="/features/blog"
      upload={upload()}
      {...overrides}
    />,
  );
}

function list(state: BlogListState, status?: "draft", page = 1, t: Translator = sentinel): string {
  return renderInRouter(
    <BlogListView
      t={t}
      uiLocale="en"
      content={CONTENT}
      query={{ ...(status === undefined ? {} : { status }), page }}
      state={state}
      onRetry={noop}
      createLink={<a href="/admin-ui/features/blog/new">{t("features.blog.new")}</a>}
      hrefForOffset={(offset) => `/features/blog?page=${String(offset / 50 + 1)}`}
    />,
  );
}

const ready = (
  items = [
    postFixture(),
    postFixture({
      id: "b",
      state: "scheduled",
      status: "published",
      publishedAt: "2026-12-01T08:00:00.000Z",
      title: { uk: "Зима" },
    }),
  ],
): BlogListState => ({
  status: "ready",
  data: { items, total: items.length, page: 1, limit: 50 },
});

describe("the post list", () => {
  it("renders only translated text: rows with a link, the state as text, the dates", () => {
    const html = list(ready());
    expect(
      leftoverText(html.replace(/(First post|Зима|November|December|AM|PM|at|,|:)/g, "")),
    ).toBe("");
    expect(html).toContain('href="/admin-ui/features/blog/7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d"');
    expect(html).toContain("§features.blog.state.draft");
    expect(html).toContain("§features.blog.state.scheduled");
    expect(html).toContain("§features.blog.list.noDate");
    // The name falls back to the main language (no English title).
    expect(html).toContain("Зима");
  });

  it("has a loading table, a failure with retry, an empty state with the create link, and a filtered empty state", () => {
    expect(list({ status: "loading" })).toContain('aria-busy="true"');
    expect(list({ status: "error", failure: { kind: "network" } })).toContain("§action.retry");
    const empty = list(ready([]));
    expect(empty).toContain("§features.blog.list.emptyTitle");
    expect(empty).toContain("§features.blog.new");
    const filtered = list(ready([]), "draft");
    expect(filtered).toContain("§features.blog.list.emptyFilteredTitle");
    expect(filtered).not.toContain("§features.blog.new");
    expect(list(ready([]), undefined, 3)).toContain("§dict.list.firstPage");
    expect(list({ status: "forbidden" })).toContain("§error.forbiddenData");
  });

  it("reads in both languages with the slice's messages", () => {
    expect(list(ready(), undefined, 1, en)).toContain("Draft");
    expect(list(ready(), undefined, 1, uk)).toContain("Чернетка");
  });
});

describe("the post form", () => {
  it("renders only translated text and labels every field per content locale", () => {
    const html = form();
    expect(
      leftoverText(
        html.replace(
          /(Перший допис|First post|Коротко|In short|##|Вступ|Текст|Intro|Text|first-post|\.)/g,
          "",
        ),
      ),
    ).toBe("");
    for (const value of textAttributes(html)) expect(value).toMatch(/^§|^$/);
    for (const id of [
      "blog-title-uk",
      "blog-title-en",
      "blog-body-uk",
      "blog-body-en",
      "blog-seoDescription-en",
      "blog-coverAlt-uk",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toMatch(/<form id="blog-post-form"[^>]*method="post"/);
  });

  it("shows a Markdown refusal under its locale's body, with the line, and marks the field", () => {
    const html = form(
      {
        issues: { "body.en": { key: "features.blog.markdown.heading_level", values: { line: 3 } } },
      },
      en,
    );
    expect(html).toContain("Line 3: headings use ## to ####");
    expect(html).toMatch(/<textarea[^>]*id="blog-body-en"[^>]*aria-invalid="true"/);
  });

  it("locks the slug once the post has a publish date", () => {
    const html = form({ slugLocked: true });
    expect(html).toMatch(
      /<input[^>]*id="blog-slug"[^>]*readOnly=""|<input[^>]*readonly=""[^>]*id="blog-slug"/i,
    );
    expect(html).toContain("§features.blog.form.slugLocked");
  });

  it("is read-only without catalog.write: no actions, no upload, no remove", () => {
    const html = form({
      canWrite: false,
      values: { ...blogFormFrom(postFixture(), CONTENT.locales), cover: COVER },
    });
    expect(html).not.toContain('type="submit"');
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("§features.blog.cover.remove");
    expect(html).toContain("§features.blog.cover.size");
  });

  it("explains switched-off uploads and locks Save while a cover uploads", () => {
    expect(form({ upload: upload({ uploadsEnabled: false }) })).toContain(
      "§features.blog.cover.uploadsOffTitle",
    );
    expect(
      form({
        upload: upload({ running: true }),
        mode: "create",
        values: emptyBlogForm(CONTENT.locales),
      }),
    ).toMatch(
      /<button[^>]*type="submit"[^>]*disabled=""|<button[^>]*disabled=""[^>]*type="submit"/,
    );
  });
});

describe("the publish panel", () => {
  const panel = (overrides: Partial<Parameters<typeof BlogPublishPanel>[0]> = {}) =>
    renderInRouter(
      <BlogPublishPanel
        t={sentinel}
        uiLocale="en"
        post={postFixture()}
        canPublish
        unsaved={false}
        onChanged={noop}
        {...overrides}
      />,
    );

  it("offers publish now and scheduling for a draft", () => {
    const html = panel();
    expect(html).toContain("§features.blog.publish.isDraft");
    expect(html).toContain("§features.blog.publish.now");
    expect(html).toContain('type="datetime-local"');
    expect(html).not.toContain("§features.blog.publish.unpublish");
  });

  it("offers unpublish only for a published post", () => {
    const html = panel({
      post: postFixture({
        state: "published",
        status: "published",
        publishedAt: "2026-11-01T08:00:00.000Z",
        slugLocked: true,
      }),
    });
    expect(html).toContain("§features.blog.publish.unpublish");
    expect(html).not.toContain("§features.blog.publish.now");
    expect(html).not.toContain('type="datetime-local"');
  });

  it("locks publishing while the form has unsaved changes, and says why", () => {
    const html = panel({ unsaved: true });
    expect(html).toContain("§features.blog.publish.saveFirst");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="blog-publish-unsaved"/);
  });

  it("locks unpublishing too while the form has unsaved changes (the reload would drop them)", () => {
    for (const state of ["published", "scheduled"] as const) {
      const html = panel({
        unsaved: true,
        post: postFixture({
          state,
          status: "published",
          publishedAt:
            state === "published" ? "2026-11-01T08:00:00.000Z" : "2099-01-01T08:00:00.000Z",
          slugLocked: true,
        }),
      });
      const buttons = [...html.matchAll(/<button[^>]*>[^<]*<\/button>/g)].map((match) => match[0]);
      const unpublish = buttons.find((button) =>
        button.includes("§features.blog.publish.unpublish"),
      );
      expect(unpublish, state).toMatch(/disabled=""/);
      expect(unpublish, state).toMatch(/aria-describedby="blog-publish-unsaved"/);
      // Every button of the panel is locked, none is left to drop the edits.
      for (const button of buttons) expect(button, state).toMatch(/disabled=""/);
    }
  });

  it("shows the state but no control without catalog.publish", () => {
    const html = panel({ canPublish: false });
    expect(html).toContain("§features.blog.publish.noPermission");
    expect(html).not.toContain("<button");
    expect(html).not.toContain('type="datetime-local"');
  });
});
