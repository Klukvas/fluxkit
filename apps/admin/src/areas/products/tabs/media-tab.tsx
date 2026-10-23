import { Button, ConfirmDialog, Field, Select, type Translator } from "@fluxkit/ui";
import { useMemo, useRef, useState, type FormEvent, type Ref } from "react";
import { useI18n } from "../../../i18n/i18n-context";
import { adminClient } from "../../../lib/api";
import type { MessageDescriptor } from "../../../lib/problem-messages";
import { useUnsavedChangesGuard } from "../../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../../router/unsaved-changes-dialog";
import { BrandLogoPreview } from "../../catalog-dictionaries/brand-form-view";
import {
  FormActions,
  FormErrorSummary,
  LocaleFields,
  TextField,
  describe,
  type ContentLocales,
} from "../../catalog-dictionaries/form-parts";
import { URL_MAX_LENGTH, hasIssues, type FormIssues } from "../../catalog-dictionaries/form-rules";
import { resolveLocalized } from "../../catalog-dictionaries/locale-text";
import { useAdminConfig } from "../../catalog-dictionaries/config-gate";
import { useFormSubmit } from "../../catalog-dictionaries/use-form-submit";
import {
  DropZone,
  UploadPanel,
  type UploadControls,
} from "../../catalog-dictionaries/upload-panel";
import { MAX_FILES_PER_SELECTION, limitValues } from "../../catalog-dictionaries/upload-queue";
import { useUploadQueue } from "../../catalog-dictionaries/use-upload-queue";
import { TabProblemsView } from "../editor-views";
import { MEDIA_FOCUS_ID, mediaFieldId } from "../field-ids";
import {
  ALT_MAX_LENGTH,
  MAX_MEDIA,
  addMedia,
  mediaBody,
  mediaDirty,
  mediaRowsFrom,
  moveMedia,
  newMediaRow,
  pairKey,
  removeMedia,
  removedMediaCount,
  setMediaLink,
  unsavedMedia,
  updateMedia,
  uploadedMediaRow,
  validateMedia,
  type MediaRow,
} from "../media-list";
import { problemsOnTab, type PublishProblem } from "../publish-problems";
import { useReportDirty, type ProductTabProps } from "../tab-props";
import { useCan } from "../use-can";
import { optionName, useOptionDefinitions, valueLabel } from "../use-option-definitions";

/** One option value an image can be linked to (one of the values the product chose), with its label. */
export interface MediaLinkChoice {
  optionId: string;
  optionValueId: string;
  label: string;
}

export interface MediaListViewProps {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  rows: readonly MediaRow[];
  onChange: (rows: readonly MediaRow[]) => void;
  onAdd: () => void;
  links: readonly MediaLinkChoice[];
  issues: FormIssues;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
  /** The tab's publish problems (listed at the top). */
  problems: readonly PublishProblem[];
  busy: boolean;
  canWrite: boolean;
  /** `GET /admin/config` `media.uploadsEnabled`: false leaves URL entry only (a hint says so). */
  uploadsEnabled: boolean;
  /** The upload queue of the tab; its buttons render only with write permission and enabled uploads. */
  upload: UploadControls;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const NO_LINK = "";

/**
 * The product's images as a list of addresses, in their order (the position): a lazy preview, the address, the alt text
 * per content locale, the option value it shows, and buttons to move a row up or down (keyboard reachable, no dragging)
 * or remove it. Read-only without write permission: no buttons, inputs read-only, the link disabled. With write permission
 * and enabled uploads it also offers "Upload images" (a file input behind a labelled button) and a drop zone around the
 * list; both feed the same queue. While files upload, the row buttons and Save are disabled.
 */
export function MediaListView({
  t,
  uiLocale,
  content,
  rows,
  onChange,
  onAdd,
  links,
  issues,
  summary,
  summaryRef,
  problems,
  busy,
  canWrite,
  uploadsEnabled,
  upload,
  onSubmit,
}: MediaListViewProps) {
  const errorOf = (path: string) => issues[path];
  const uploading = upload.running;
  const canUpload = canWrite && uploadsEnabled;
  const limitText = limitValues(upload.limits, upload.maxFiles);
  return (
    <form method="post" onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2 text-muted-foreground">
        <p>{t("products.media.intro", { max: MAX_MEDIA })}</p>
        <p>{t("products.media.policy")}</p>
      </div>
      <TabProblemsView t={t} id={MEDIA_FOCUS_ID} problems={problems} />
      <FormErrorSummary t={t} summary={summary} summaryRef={summaryRef} />
      {issues["media"] === undefined ? null : (
        <p className="text-danger">{describe(t, issues["media"])}</p>
      )}
      {canUpload ? (
        <section aria-labelledby="product-media-upload-title" className="flex flex-col gap-3">
          <h3 id="product-media-upload-title" className="font-semibold">
            {t("products.media.uploadTitle")}
          </h3>
          {rows.length >= MAX_MEDIA ? null : (
            <UploadPanel
              t={t}
              id="product-media-upload"
              label={t("dict.upload.images")}
              multiple
              controls={upload}
            />
          )}
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <p>{t("products.media.uploadLimits", limitText)}</p>
            <p>{t("products.media.uploadHint")}</p>
            <p>{t("products.media.dropHint")}</p>
          </div>
        </section>
      ) : canWrite ? (
        <p className="text-muted-foreground">{t("products.media.uploadsOff")}</p>
      ) : null}
      <DropZone onDrop={canUpload && rows.length < MAX_MEDIA ? upload.dropFiles : undefined}>
        {rows.length === 0 ? (
          <p className="text-muted-foreground">{t("products.media.none")}</p>
        ) : (
          <ol className="flex flex-col gap-6" aria-label={t("products.media.listLabel")}>
            {rows.map((row, index) => {
              const number = index + 1;
              const linkValue =
                row.optionId === null || row.optionValueId === null
                  ? NO_LINK
                  : pairKey(row.optionId, row.optionValueId);
              const linkKnown =
                linkValue === NO_LINK ||
                links.some((link) => pairKey(link.optionId, link.optionValueId) === linkValue);
              const linkError =
                errorOf(`media.${index}.optionValueId`) ?? errorOf(`media.${index}.optionId`);
              const alt =
                resolveLocalized(row.alt, uiLocale, content.defaultLocale) ||
                t("products.media.previewAlt", { number });
              return (
                <li
                  key={row.key}
                  className="flex flex-col gap-3 rounded-md border border-border p-4"
                >
                  <h3 className="font-semibold">{t("products.media.item", { number })}</h3>
                  <BrandLogoPreview
                    url={row.url}
                    alt={alt}
                    failedText={t("products.media.previewFailed")}
                  />
                  <TextField
                    t={t}
                    id={mediaFieldId(index, "url")}
                    name={`media.${index}.url`}
                    type="url"
                    label={t("products.media.url")}
                    hint={t("products.media.urlHint")}
                    value={row.url}
                    required
                    readOnly={!canWrite}
                    maxLength={URL_MAX_LENGTH}
                    error={errorOf(`media.${index}.url`)}
                    onChange={(url) => onChange(updateMedia(rows, index, { url }))}
                  />
                  <LocaleFields
                    t={t}
                    id={`product-media-${index}-alt`}
                    legend={t("products.media.alt")}
                    field={`media.${index}.alt`}
                    content={content}
                    uiLocale={uiLocale}
                    values={row.alt}
                    errors={issues}
                    readOnly={!canWrite}
                    required={false}
                    onChange={(locale, text) =>
                      onChange(updateMedia(rows, index, { alt: { ...row.alt, [locale]: text } }))
                    }
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("products.media.altHint", { max: ALT_MAX_LENGTH })}
                  </p>
                  <Field
                    id={mediaFieldId(index, "link")}
                    label={t("products.media.link")}
                    hint={t("products.media.linkHint")}
                    error={linkError === undefined ? undefined : describe(t, linkError)}
                  >
                    {(control) => (
                      <Select
                        {...control}
                        name={`media.${index}.optionValueId`}
                        value={linkValue}
                        disabled={!canWrite}
                        onChange={(event) => {
                          const chosen = links.find(
                            (link) =>
                              pairKey(link.optionId, link.optionValueId) === event.target.value,
                          );
                          onChange(
                            setMediaLink(
                              rows,
                              index,
                              chosen === undefined
                                ? null
                                : {
                                    optionId: chosen.optionId,
                                    optionValueId: chosen.optionValueId,
                                  },
                            ),
                          );
                        }}
                      >
                        <option value={NO_LINK}>{t("products.media.noLink")}</option>
                        {links.map((link) => (
                          <option
                            key={pairKey(link.optionId, link.optionValueId)}
                            value={pairKey(link.optionId, link.optionValueId)}
                          >
                            {link.label}
                          </option>
                        ))}
                        {linkKnown ? null : (
                          <option value={linkValue}>{t("products.media.unknownLink")}</option>
                        )}
                      </Select>
                    )}
                  </Field>
                  {canWrite ? (
                    <div
                      role="group"
                      aria-label={t("products.media.rowActions", { number })}
                      className="flex flex-wrap gap-3"
                    >
                      <Button
                        variant="secondary"
                        disabled={busy || uploading || index === 0}
                        aria-label={t("products.media.moveUpLabel", { number })}
                        onClick={() => onChange(moveMedia(rows, index, -1))}
                      >
                        {t("products.media.moveUp")}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy || uploading || index === rows.length - 1}
                        aria-label={t("products.media.moveDownLabel", { number })}
                        onClick={() => onChange(moveMedia(rows, index, 1))}
                      >
                        {t("products.media.moveDown")}
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busy || uploading}
                        aria-label={t("products.media.removeLabel", { number })}
                        onClick={() => onChange(removeMedia(rows, index))}
                      >
                        {t("products.media.remove")}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </DropZone>
      {canWrite ? (
        <div className="flex flex-col gap-4">
          {rows.length >= MAX_MEDIA ? (
            <p className="text-muted-foreground">{t("products.media.full", { max: MAX_MEDIA })}</p>
          ) : (
            <div>
              <Button variant="secondary" disabled={busy || uploading} onClick={onAdd}>
                {t("products.media.add")}
              </Button>
            </div>
          )}
          <FormActions
            t={t}
            busy={busy}
            locked={uploading}
            submitLabel={t("products.media.save")}
            busyLabel={t("products.form.saving")}
          />
        </div>
      ) : null}
    </form>
  );
}

/** The field names of the list: the API's paths of every row. */
function mediaFieldNames(rows: readonly MediaRow[], locales: readonly string[]): string[] {
  return [
    "media",
    ...rows.flatMap((_, index) => [
      `media.${index}.url`,
      `media.${index}.optionId`,
      `media.${index}.optionValueId`,
      ...locales.map((locale) => `media.${index}.alt.${locale}`),
    ]),
  ];
}

/**
 * Media: the image list, saved whole with `PUT /admin/products/{id}/media`. Addresses are typed, or files are uploaded
 * (`POST /admin/media/uploads`, one at a time): each uploaded file appends a row with the returned URL to the UNSAVED
 * list, and the save attaches them. Leaving with unsaved rows or running uploads is warned about (the unsaved-changes
 * guard); Save is disabled while files upload. Removing stored images is confirmed on save. Never optimistic: the editor
 * reloads the product after the save.
 */
export function MediaTab({
  product,
  content,
  problems,
  onChanged,
  onDirtyChange,
}: ProductTabProps) {
  const { t, locale } = useI18n();
  const canWrite = useCan("putProductMedia");
  const mediaConfig = useAdminConfig().media;
  const [initial, setInitial] = useState<readonly MediaRow[]>(() =>
    mediaRowsFrom(product.media, content.locales),
  );
  const [rows, setRows] = useState<readonly MediaRow[]>(initial);
  const [confirming, setConfirming] = useState(false);
  const added = useRef(0);
  const rowsNow = useRef(rows);
  rowsNow.current = rows;
  const definitions = useOptionDefinitions(product.options.map((option) => option.optionId));
  const form = useFormSubmit(mediaFieldNames(rows, content.locales));
  const limits = useMemo(
    () => ({ maxBytes: mediaConfig.maxBytes, contentTypes: mediaConfig.contentTypes }),
    [mediaConfig.maxBytes, mediaConfig.contentTypes],
  );
  const queue = useUploadQueue({
    limits,
    maxRows: MAX_MEDIA,
    maxFiles: MAX_FILES_PER_SELECTION,
    rowCount: () => rowsNow.current.length,
    accept: (upload) => {
      if (rowsNow.current.length >= MAX_MEDIA) return false;
      added.current += 1;
      const row = uploadedMediaRow(`new-${added.current}`, upload.url, content.locales);
      rowsNow.current = [...rowsNow.current, row];
      setRows((current) => addMedia(current, row));
      return true;
    },
  });
  const dirty = unsavedMedia(initial, rows, content.locales, queue.running) && !form.state.busy;
  const blocker = useUnsavedChangesGuard(dirty);
  useReportDirty(dirty, onDirtyChange);
  const issues = { ...problemsOnTab(problems, "media"), ...form.state.fieldErrors };
  const own = problems.filter((problem) => problem.tab === "media");

  const links = useMemo<MediaLinkChoice[]>(
    () =>
      [...product.options]
        .sort((left, right) => left.position - right.position)
        .flatMap((option) => {
          const definition = definitions.byId.get(option.optionId);
          const name = optionName(definition, option.optionCode, locale, content.defaultLocale);
          return [...option.values]
            .sort((left, right) => left.position - right.position)
            .map((value) => ({
              optionId: option.optionId,
              optionValueId: value.optionValueId,
              label: t("products.media.linkChoice", {
                option: name,
                value: valueLabel(
                  definition,
                  value.optionValueId,
                  value.valueCode,
                  locale,
                  content.defaultLocale,
                ),
              }),
            }));
        }),
    [product.options, definitions.byId, locale, content.defaultLocale, t],
  );
  const chosenPairs = useMemo(
    () => new Set(links.map((link) => pairKey(link.optionId, link.optionValueId))),
    [links],
  );

  async function save() {
    setConfirming(false);
    const outcome = await form.submit(() =>
      adminClient.putProductMedia(product.id, mediaBody(rows, content.locales)),
    );
    if (outcome.kind === "ok") {
      setInitial(rows);
      onChanged("saved");
    } else if (outcome.kind === "unknown") onChanged("unknown");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A save must not race the rows that running uploads still add.
    if (form.state.busy || !canWrite || queue.running) return;
    const local = validateMedia(rows, { ...content, chosenPairs });
    if (hasIssues(local)) {
      form.showIssues(local);
      return;
    }
    if (!mediaDirty(initial, rows, content.locales)) {
      onChanged("noChanges");
      return;
    }
    if (removedMediaCount(initial, rows) > 0) setConfirming(true);
    else void save();
  }

  return (
    <>
      <MediaListView
        t={t}
        uiLocale={locale}
        content={content}
        rows={rows}
        onChange={setRows}
        onAdd={() => {
          added.current += 1;
          setRows(addMedia(rows, newMediaRow(`new-${added.current}`, content.locales)));
        }}
        links={links}
        issues={issues}
        summary={form.state.summary}
        summaryRef={form.summaryRef}
        problems={own}
        busy={form.state.busy}
        canWrite={canWrite}
        uploadsEnabled={mediaConfig.uploadsEnabled}
        upload={{ ...queue, limits, maxFiles: MAX_FILES_PER_SELECTION }}
        onSubmit={submit}
      />
      {confirming ? (
        <ConfirmDialog
          open
          tone="danger"
          busy={form.state.busy}
          title={t("products.media.removeTitle")}
          description={t("products.media.removeBody", {
            count: removedMediaCount(initial, rows),
          })}
          confirmLabel={t("products.media.removeConfirm")}
          cancelLabel={t("dict.form.cancel")}
          onClose={() => setConfirming(false)}
          onConfirm={() => void save()}
        />
      ) : null}
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}
