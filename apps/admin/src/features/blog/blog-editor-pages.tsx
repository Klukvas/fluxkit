import { Button } from "@fluxkit/ui";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { jsonEqual } from "../../lib/diff-for-patch";
import { useRefreshingResource } from "../../lib/use-refreshing-resource";
import { buildPath } from "../../router/paths";
import { useUnsavedChangesGuard } from "../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../router/unsaved-changes-dialog";
import { standaloneLinkClass } from "../../views/links";
import { ResourceFallback } from "../../views/status-views";
import { ConfigGate, useContentLocales } from "../../areas/catalog-dictionaries/config-gate";
import {
  BackLink,
  CreateUnknown,
  DangerZone,
  DeletedPanel,
  FocusedPanel,
  NoticeBar,
  type NoticeKind,
} from "../../areas/catalog-dictionaries/dictionary-frame";
import { ConfirmDelete } from "../../areas/catalog-dictionaries/form-dialog";
import type { ContentLocales } from "../../areas/catalog-dictionaries/form-parts";
import { hasIssues } from "../../areas/catalog-dictionaries/form-rules";
import { useEditorState } from "../../areas/catalog-dictionaries/use-editor-state";
import { useFormSubmit } from "../../areas/catalog-dictionaries/use-form-submit";
import { blogApi, type BlogPost } from "./blog-api";
import { useBlogCoverUpload, type BlogCoverUpload } from "./blog-cover-upload";
import {
  blogCreateBody,
  blogFieldNames,
  blogFormFrom,
  blogPatchBody,
  blogProblemMapper,
  coverFromUpload,
  emptyBlogForm,
  validateBlogForm,
  type BlogFormValues,
} from "./blog-form";
import { BlogFormView, firstInvalidBlogField } from "./blog-form-view";
import { BlogFrame, postTitle } from "./blog-list-view";
import { BLOG_PATHS } from "./blog-paths";
import { useBlogPermissions } from "./blog-permissions";
import { BlogPublishPanel } from "./blog-publish-panel";

/**
 * The state both forms share: the values, the submit, the cover upload and the unsaved-changes guard (a dirty form, or a
 * cover still uploading, asks before the admin leaves).
 */
function useBlogForm(initial: BlogFormValues, content: ContentLocales, saved: boolean) {
  const { locale } = useI18n();
  const { canUpload } = useBlogPermissions();
  const [values, setValues] = useState<BlogFormValues>(initial);
  const form = useFormSubmit(blogFieldNames(content.locales), blogProblemMapper(locale));
  const queue = useBlogCoverUpload((upload) =>
    setValues((current) => ({ ...current, cover: coverFromUpload(upload) })),
  );
  const upload: BlogCoverUpload = { ...queue, uploadsEnabled: queue.uploadsEnabled && canUpload };
  const dirty = !jsonEqual(initial, values) || upload.running;
  const blocker = useUnsavedChangesGuard(dirty && !saved && !form.state.busy);
  return { values, setValues, form, upload, blocker, dirty };
}

function BlogCreate() {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const { canWrite } = useBlogPermissions();
  const [initial, setInitial] = useState(() => emptyBlogForm(content.locales));
  const [created, setCreated] = useState<BlogPost | null>(null);
  const [unknown, setUnknown] = useState(false);
  const { values, setValues, form, upload, blocker } = useBlogForm(
    initial,
    content,
    created !== null,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A save must not race a cover that is still uploading.
    if (form.state.busy || !canWrite || upload.running) return;
    const issues = validateBlogForm(values, content, "optional");
    if (hasIssues(issues)) {
      form.showIssues(issues, firstInvalidBlogField);
      return;
    }
    const outcome = await form.submit(() =>
      blogApi.createBlogPost(blogCreateBody(values, content.locales)),
    );
    if (outcome.kind === "ok") setCreated(outcome.data);
    else if (outcome.kind === "unknown") setUnknown(true);
  }

  function again() {
    const fresh = emptyBlogForm(content.locales);
    setInitial(fresh);
    setValues(fresh);
    setCreated(null);
    setUnknown(false);
  }

  return (
    <BlogFrame title={t("features.blog.page.new.title")}>
      {created !== null ? (
        <FocusedPanel
          title={t("features.blog.created", { name: postTitle(created, locale, content) })}
        >
          <p className="flex flex-wrap gap-4">
            <Link
              to={buildPath(BLOG_PATHS.detail, { id: created.id })}
              className={standaloneLinkClass}
            >
              {t("features.blog.openCreated")}
            </Link>
            <Button variant="secondary" onClick={again}>
              {t("dict.form.createAnother")}
            </Button>
            <Link to={BLOG_PATHS.list} className={standaloneLinkClass}>
              {t("features.blog.backToList")}
            </Link>
          </p>
        </FocusedPanel>
      ) : (
        <>
          <BackLink to={BLOG_PATHS.list} label={t("features.blog.backToList")} />
          {unknown ? <CreateUnknown t={t} listTo={BLOG_PATHS.list} /> : null}
          <BlogFormView
            t={t}
            uiLocale={locale}
            content={content}
            mode="create"
            values={values}
            onChange={setValues}
            issues={form.state.fieldErrors}
            summary={form.state.summary}
            summaryRef={form.summaryRef}
            busy={form.state.busy}
            canWrite={canWrite}
            slugLocked={false}
            onSubmit={(event) => void submit(event)}
            cancelTo={BLOG_PATHS.list}
            upload={upload}
          />
        </>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </BlogFrame>
  );
}

/** `/features/blog/new`: a new draft. */
export function BlogNewPage() {
  return (
    <ConfigGate>
      <BlogCreate />
    </ConfigGate>
  );
}

function BlogEditForm({
  post,
  content,
  onChanged,
  onDirty,
}: {
  post: BlogPost;
  content: ContentLocales;
  onChanged: (kind: NoticeKind) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const { canWrite } = useBlogPermissions();
  const [initial, setInitial] = useState(() => blogFormFrom(post, content.locales));
  const { values, setValues, form, upload, blocker, dirty } = useBlogForm(initial, content, false);

  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A save must not race a cover that is still uploading.
    if (form.state.busy || !canWrite || upload.running) return;
    const issues = validateBlogForm(values, content, post.slugLocked ? "locked" : "required");
    if (hasIssues(issues)) {
      form.showIssues(issues, firstInvalidBlogField);
      return;
    }
    const body = blogPatchBody(initial, values, content.locales, post.slugLocked);
    if (Object.keys(body).length === 0) {
      onChanged("noChanges");
      return;
    }
    const outcome = await form.submit(() => blogApi.updateBlogPost(post.id, body));
    if (outcome.kind === "ok") {
      setInitial(values);
      onChanged("saved");
    } else if (outcome.kind === "unknown") onChanged("unknown");
  }

  return (
    <>
      <BlogFormView
        t={t}
        uiLocale={locale}
        content={content}
        mode="edit"
        values={values}
        onChange={setValues}
        issues={form.state.fieldErrors}
        summary={form.state.summary}
        summaryRef={form.summaryRef}
        busy={form.state.busy}
        canWrite={canWrite}
        slugLocked={post.slugLocked}
        onSubmit={(event) => void submit(event)}
        cancelTo={BLOG_PATHS.list}
        upload={upload}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}

function BlogEditor({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const { canWrite, canPublish } = useBlogPermissions();
  const resource = useRefreshingResource((signal) => blogApi.getBlogPost(id, { signal }), [id]);
  const editor = useEditorState(resource.reload);
  const [dirty, setDirty] = useState(false);
  const post = resource.data;
  const title =
    post === null ? t("features.blog.page.detail.title") : postTitle(post, locale, content);

  if (editor.deleted) {
    return (
      <BlogFrame title={t("features.blog.page.detail.title")}>
        <DeletedPanel t={t} title={t("features.blog.deletedOne")} listTo={BLOG_PATHS.list} />
      </BlogFrame>
    );
  }

  return (
    <BlogFrame title={title}>
      <BackLink to={BLOG_PATHS.list} label={t("features.blog.backToList")} />
      <NoticeBar t={t} notice={editor.notice} innerRef={editor.noticeRef} />
      {resource.fallback !== null ? (
        <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
      ) : post === null ? null : (
        <div className="flex flex-col gap-10" aria-busy={resource.refreshing || undefined}>
          <BlogPublishPanel
            t={t}
            uiLocale={locale}
            post={post}
            canPublish={canPublish}
            unsaved={dirty}
            onChanged={resource.reload}
          />
          <BlogEditForm
            key={post.updatedAt}
            post={post}
            content={content}
            onChanged={editor.changed}
            onDirty={setDirty}
          />
          <DangerZone
            t={t}
            canWrite={canWrite}
            id="blog-danger"
            info={t("features.blog.delete.info")}
            buttonLabel={t("features.blog.delete.button")}
            onDelete={() => editor.setConfirmingDelete(true)}
          />
          {editor.confirmingDelete ? (
            <ConfirmDelete
              t={t}
              canWrite={canWrite}
              open
              onClose={() => editor.setConfirmingDelete(false)}
              remove={() => blogApi.deleteBlogPost(post.id)}
              onDeleted={() => {
                editor.setConfirmingDelete(false);
                editor.setDeleted(true);
              }}
              onUnknown={() => {
                editor.setConfirmingDelete(false);
                editor.changed("unknown");
              }}
              title={t("features.blog.delete.title", { name: title })}
              description={t("features.blog.delete.body")}
              hint={t("features.blog.delete.hint")}
              confirmLabel={t("features.blog.delete.confirm")}
            />
          ) : null}
        </div>
      )}
    </BlogFrame>
  );
}

/** `/features/blog/:id`: edit, publish or delete one post. */
export function BlogDetailPage() {
  const { id } = useParams();
  if (id === undefined) throw new Error("The blog post route has no id parameter.");
  return (
    <ConfigGate>
      <BlogEditor key={id} id={id} />
    </ConfigGate>
  );
}
