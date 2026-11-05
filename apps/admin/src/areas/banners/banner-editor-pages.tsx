import type { AdminHomeBanner, AdminMediaUpload } from "@fluxkit/api-client";
import { Button } from "@fluxkit/ui";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { browserTimeZone } from "../../lib/date-range";
import { jsonEqual } from "../../lib/diff-for-patch";
import { useRefreshingResource } from "../../lib/use-refreshing-resource";
import { PATHS, buildPath } from "../../router/paths";
import { useUnsavedChangesGuard } from "../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../router/unsaved-changes-dialog";
import { ResourceFallback } from "../../views/status-views";
import { ConfigGate, useContentLocales } from "../catalog-dictionaries/config-gate";
import {
  BackLink,
  CreateUnknown,
  DangerZone,
  DeletedPanel,
  FocusedPanel,
  NoticeBar,
  linkClass,
  type NoticeKind,
} from "../catalog-dictionaries/dictionary-frame";
import { ConfirmDelete } from "../catalog-dictionaries/form-dialog";
import type { ContentLocales } from "../catalog-dictionaries/form-parts";
import { hasIssues } from "../catalog-dictionaries/form-rules";
import { useEditorState } from "../catalog-dictionaries/use-editor-state";
import { useFormSubmit } from "../catalog-dictionaries/use-form-submit";
import {
  bannerCreateBody,
  bannerFieldNames,
  bannerFormFrom,
  bannerPatchBody,
  bannerProblemMapper,
  bannerWarnings,
  emptyBannerForm,
  imageLocalesSent,
  pictureFromUpload,
  validateBannerForm,
  type BannerFormValues,
} from "./banner-form";
import { BannerFormView } from "./banner-form-view";
import { bannerName } from "./banner-list-view";
import { useCanWriteBanners } from "./banner-permissions";
import { useBannerPictureUpload, type PictureSlot } from "./banner-picture-upload";
import { BannerPreview } from "./banner-preview";
import { zoneLabel } from "./banner-time";
import { BannersFrame } from "./banners-frame";

/** Puts an uploaded picture into its slot of the form. */
function withPicture(
  values: BannerFormValues,
  slot: PictureSlot,
  upload: AdminMediaUpload,
): BannerFormValues {
  const picture = pictureFromUpload(upload);
  return slot === null
    ? { ...values, picture }
    : { ...values, localePictures: { ...values.localePictures, [slot]: picture } };
}

/**
 * The state both forms share: the values, the submit, the picture uploads and the unsaved-changes guard. The time zone
 * is read once per form (the dates are typed in it).
 */
function useBannerForm(initial: BannerFormValues, content: ContentLocales, saved: boolean) {
  const [values, setValues] = useState<BannerFormValues>(initial);
  const [timeZone] = useState(browserTimeZone);
  const form = useFormSubmit(
    bannerFieldNames(content.locales),
    bannerProblemMapper(imageLocalesSent(values, content.locales)),
  );
  const upload = useBannerPictureUpload((slot, uploaded) =>
    setValues((current) => withPicture(current, slot, uploaded)),
  );
  const blocker = useUnsavedChangesGuard(
    (!jsonEqual(initial, values) || upload.running) && !saved && !form.state.busy,
  );
  return { values, setValues, timeZone, form, upload, blocker };
}

function BannerCreate() {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWriteBanners();
  const [initial, setInitial] = useState(() => emptyBannerForm(content.locales));
  const [created, setCreated] = useState<AdminHomeBanner | null>(null);
  const [unknown, setUnknown] = useState(false);
  const state = useBannerForm(initial, content, created !== null);
  const { values, setValues, timeZone, form, upload, blocker } = state;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A save must not race a picture that is still uploading.
    if (form.state.busy || !canWrite || upload.running) return;
    const issues = validateBannerForm(values, content, timeZone);
    if (hasIssues(issues)) {
      form.showIssues(issues);
      return;
    }
    const outcome = await form.submit(() =>
      adminClient.createHomeBanner(bannerCreateBody(values, content.locales, timeZone)),
    );
    if (outcome.kind === "ok") setCreated(outcome.data);
    else if (outcome.kind === "unknown") setUnknown(true);
  }

  function again() {
    const fresh = emptyBannerForm(content.locales);
    setInitial(fresh);
    setValues(fresh);
    setCreated(null);
    setUnknown(false);
  }

  return (
    <BannersFrame title={t("page.bannerNew.title")}>
      {created !== null ? (
        <FocusedPanel
          title={t("banners.created", { name: bannerName(t, created, locale, content) })}
        >
          <p className="flex flex-wrap gap-4">
            <Link to={buildPath(PATHS.bannerDetail, { id: created.id })} className={linkClass}>
              {t("banners.openCreated")}
            </Link>
            <Button variant="secondary" onClick={again}>
              {t("dict.form.createAnother")}
            </Button>
            <Link to={PATHS.banners} className={linkClass}>
              {t("banners.backToList")}
            </Link>
          </p>
        </FocusedPanel>
      ) : (
        <>
          <BackLink to={PATHS.banners} label={t("banners.backToList")} />
          {unknown ? <CreateUnknown t={t} listTo={PATHS.banners} /> : null}
          <BannerFormView
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
            onSubmit={(event) => void submit(event)}
            cancelTo={PATHS.banners}
            upload={upload}
            zone={zoneLabel(timeZone, Date.now())}
            warnings={bannerWarnings(values, content.locales, timeZone, Date.now())}
            preview={<BannerPreview t={t} uiLocale={locale} content={content} values={values} />}
          />
        </>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </BannersFrame>
  );
}

/** `/storefront/banners/new`. */
export function BannerNewPage() {
  return (
    <ConfigGate>
      <BannerCreate />
    </ConfigGate>
  );
}

function BannerEditForm({
  banner,
  content,
  onChanged,
}: {
  banner: AdminHomeBanner;
  content: ContentLocales;
  onChanged: (kind: NoticeKind) => void;
}) {
  const { t, locale } = useI18n();
  const canWrite = useCanWriteBanners();
  const [initial, setInitial] = useState(() =>
    bannerFormFrom(banner, content.locales, browserTimeZone()),
  );
  const { values, setValues, timeZone, form, upload, blocker } = useBannerForm(
    initial,
    content,
    false,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A save must not race a picture that is still uploading.
    if (form.state.busy || !canWrite || upload.running) return;
    const issues = validateBannerForm(values, content, timeZone, initial);
    if (hasIssues(issues)) {
      form.showIssues(issues);
      return;
    }
    const body = bannerPatchBody(initial, values, content.locales, timeZone);
    if (Object.keys(body).length === 0) {
      onChanged("noChanges");
      return;
    }
    const outcome = await form.submit(() => adminClient.updateHomeBanner(banner.id, body));
    if (outcome.kind === "ok") {
      setInitial(values);
      onChanged("saved");
    } else if (outcome.kind === "unknown") onChanged("unknown");
  }

  return (
    <>
      <BannerFormView
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
        onSubmit={(event) => void submit(event)}
        cancelTo={PATHS.banners}
        upload={upload}
        zone={zoneLabel(timeZone, Date.now())}
        warnings={bannerWarnings(values, content.locales, timeZone, Date.now(), initial)}
        initial={initial}
        preview={<BannerPreview t={t} uiLocale={locale} content={content} values={values} />}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}

function BannerEditor({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWriteBanners();
  const resource = useRefreshingResource(
    (signal) => adminClient.getHomeBanner(id, { signal }),
    [id],
  );
  const editor = useEditorState(resource.reload);
  const banner = resource.data;
  const title =
    banner === null ? t("page.bannerDetail.title") : bannerName(t, banner, locale, content);

  if (editor.deleted) {
    return (
      <BannersFrame title={t("page.bannerDetail.title")}>
        <DeletedPanel t={t} title={t("banners.deletedOne")} listTo={PATHS.banners} />
      </BannersFrame>
    );
  }

  return (
    <BannersFrame title={title}>
      <BackLink to={PATHS.banners} label={t("banners.backToList")} />
      <NoticeBar t={t} notice={editor.notice} innerRef={editor.noticeRef} />
      {resource.fallback !== null ? (
        <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
      ) : banner === null ? null : (
        <div className="flex flex-col gap-8" aria-busy={resource.refreshing || undefined}>
          <BannerEditForm
            key={banner.updatedAt}
            banner={banner}
            content={content}
            onChanged={editor.changed}
          />
          <DangerZone
            t={t}
            canWrite={canWrite}
            id="banner-danger"
            info={t("banners.delete.info")}
            buttonLabel={t("banners.list.delete")}
            onDelete={() => editor.setConfirmingDelete(true)}
          />
          {editor.confirmingDelete ? (
            <ConfirmDelete
              t={t}
              canWrite={canWrite}
              open
              onClose={() => editor.setConfirmingDelete(false)}
              remove={() => adminClient.deleteHomeBanner(banner.id)}
              onDeleted={() => {
                editor.setConfirmingDelete(false);
                editor.setDeleted(true);
              }}
              onUnknown={() => {
                editor.setConfirmingDelete(false);
                editor.changed("unknown");
              }}
              title={t("banners.delete.title", { name: title })}
              description={t("banners.delete.body")}
              hint={t("banners.delete.hint")}
              confirmLabel={t("banners.delete.confirm")}
            />
          ) : null}
        </div>
      )}
    </BannersFrame>
  );
}

/** `/storefront/banners/:id`: edit or delete one banner. */
export function BannerDetailPage() {
  const { id } = useParams();
  if (id === undefined) throw new Error("The banner route has no id parameter.");
  return (
    <ConfigGate>
      <BannerEditor key={id} id={id} />
    </ConfigGate>
  );
}
