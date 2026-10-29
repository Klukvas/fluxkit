import type { AdminResult, AdminSearchStatus, AdminSynonymGroup } from "@fluxkit/api-client";
import { Button } from "@fluxkit/ui";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { runWrite } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { useRefreshingResource } from "../../lib/use-refreshing-resource";
import { useResource } from "../../lib/use-resource";
import { LoadingView, ResourceFallback } from "../../views/status-views";
import { PATHS } from "../../router/paths";
import { SearchFrame, SearchOffView } from "./search-frame";
import { synonymOutcome, type SynonymAction, type SynonymFieldErrors } from "./search-outcome";
import { useCanManageSearch } from "./search-permissions";
import { searchScreenState } from "./search-view";
import { DeleteSynonymDialog, SynonymFormDialog } from "./synonym-dialogs";
import {
  listOptions,
  readSynonymListQuery,
  withLocale,
  writeSynonymListQuery,
} from "./synonym-list-query";
import { canSubmitTerms, parseTermsInput, sameTerms, termsToText } from "./synonym-terms";
import {
  SynonymApplyNote,
  SynonymFilter,
  SynonymResultsView,
  SynonymStatusLine,
  type SynonymNotice,
} from "./synonyms-view";

type DialogState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; group: AdminSynonymGroup }
  | { kind: "delete"; group: AdminSynonymGroup };

function SynonymsLoaded({
  status,
  reloadStatus,
}: {
  status: AdminSearchStatus;
  reloadStatus: () => void;
}) {
  const { t, locale: uiLocale } = useI18n();
  const canManage = useCanManageSearch();
  const [params, setParams] = useSearchParams();
  const languages = status.locales.map((entry) => entry.locale);
  const query = readSynonymListQuery(params, languages);
  const queryKey = writeSynonymListQuery(query);
  const [reloads, setReloads] = useState(0);
  const list = useResource(
    (signal) => adminClient.listSynonymGroups({ ...listOptions(query), signal }),
    [queryKey, reloads],
  );

  const [dialog, setDialog] = useState<DialogState>({ kind: "closed" });
  const [formLocale, setFormLocale] = useState(languages[0] ?? "");
  const [text, setText] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<SynonymFieldErrors | null>(null);
  const [dialogError, setDialogError] = useState<MessageDescriptor | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<SynonymNotice>({ kind: "none" });
  const [flight] = useState(createSingleFlight);
  const noticeRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const termsRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (notice.kind !== "none") noticeRef.current?.focus();
  }, [notice]);
  useEffect(() => {
    if (dialogError !== null) errorRef.current?.focus();
    else if (fieldErrors?.terms !== undefined) termsRef.current?.focus();
  }, [dialogError, fieldErrors]);

  const parsed = parseTermsInput(text);

  function resetForm(nextLocale: string, nextText: string) {
    setFormLocale(nextLocale);
    setText(nextText);
    setShowIssues(false);
    setFieldErrors(null);
    setDialogError(null);
  }
  function openCreate() {
    resetForm(query.locale !== "" ? query.locale : (languages[0] ?? ""), "");
    setDialog({ kind: "create" });
  }
  function openEdit(group: AdminSynonymGroup) {
    resetForm(group.locale, termsToText(group.terms));
    setDialog({ kind: "edit", group });
  }
  function openDelete(group: AdminSynonymGroup) {
    resetForm(group.locale, "");
    setDialog({ kind: "delete", group });
  }
  function close() {
    if (!busy) setDialog({ kind: "closed" });
  }
  function refresh() {
    setReloads((count) => count + 1);
    reloadStatus();
  }

  /**
   * One write per confirmation or submit, never repeated by the screen. A lost answer closes the dialog and says so: the
   * list is read again and the admin checks it before adding the group a second time.
   */
  async function send(action: SynonymAction, task: () => Promise<AdminResult<unknown>>) {
    const running = flight.run(() => runWrite(task));
    if (running === null) return;
    setBusy(true);
    setFieldErrors(null);
    setDialogError(null);
    const outcome = await running.finally(() => setBusy(false));
    const result = synonymOutcome(action, outcome);
    switch (result.kind) {
      case "idle":
        return;
      case "saved":
        setDialog({ kind: "closed" });
        setNotice({ kind: "saved", action });
        refresh();
        return;
      case "gone":
        setDialog({ kind: "closed" });
        setNotice({ kind: "gone" });
        refresh();
        return;
      case "unknown":
        setDialog({ kind: "closed" });
        setNotice({ kind: "unknown", action });
        refresh();
        return;
      case "fields":
        if (action === "delete")
          setDialogError(result.errors.other[0] ?? { key: "errors.generic" });
        else setFieldErrors(result.errors);
        return;
      case "off":
        setDialogError({ key: "search.synonyms.dialogOff" });
        return;
      case "forbidden":
        setDialogError({ key: "search.synonyms.dialogForbidden" });
        return;
      case "refused":
        setDialogError(result.descriptor);
        return;
    }
  }

  async function submitForm() {
    if (!canManage || (dialog.kind !== "create" && dialog.kind !== "edit")) return;
    setShowIssues(true);
    if (!canSubmitTerms(parsed)) {
      termsRef.current?.focus();
      return;
    }
    if (dialog.kind === "edit") {
      if (sameTerms(dialog.group.terms, parsed.terms)) {
        setDialog({ kind: "closed" });
        setNotice({ kind: "unchanged" });
        return;
      }
      const { id } = dialog.group;
      await send("update", () => adminClient.updateSynonymGroup(id, { terms: parsed.terms }));
      return;
    }
    await send("create", () =>
      adminClient.createSynonymGroup({ locale: formLocale, terms: parsed.terms }),
    );
  }

  async function confirmDelete() {
    if (!canManage || dialog.kind !== "delete") return;
    const { id } = dialog.group;
    await send("delete", () => adminClient.deleteSynonymGroup(id));
  }

  return (
    <>
      <p className="max-w-prose text-muted-foreground">{t("search.synonyms.intro")}</p>
      <SynonymApplyNote t={t} uiLocale={uiLocale} queue={status.queue} locales={status.locales} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SynonymFilter
          t={t}
          locales={languages}
          value={query.locale}
          onChange={(next) => setParams(writeSynonymListQuery(withLocale(query, next)))}
        />
        {canManage ? (
          <Button onClick={openCreate}>{t("search.synonyms.add")}</Button>
        ) : (
          <p className="text-muted-foreground">{t("search.synonyms.readOnly")}</p>
        )}
      </div>
      <SynonymStatusLine t={t} notice={notice} innerRef={noticeRef} />
      <SynonymResultsView
        t={t}
        uiLocale={uiLocale}
        query={query}
        state={list}
        canManage={canManage}
        onRetry={list.reload}
        onEdit={openEdit}
        onDelete={openDelete}
        hrefForOffset={(offset) =>
          `${PATHS.searchSynonyms}${writeSynonymListQuery({ ...query, offset })}`
        }
      />
      <SynonymFormDialog
        t={t}
        open={dialog.kind === "create" || dialog.kind === "edit"}
        mode={dialog.kind === "edit" ? "edit" : "create"}
        locales={languages}
        locale={formLocale}
        onLocaleChange={setFormLocale}
        text={text}
        onTextChange={setText}
        parsed={parsed}
        showIssues={showIssues}
        fieldErrors={fieldErrors}
        error={dialog.kind === "create" || dialog.kind === "edit" ? dialogError : null}
        errorRef={errorRef}
        termsRef={termsRef}
        busy={busy}
        onSubmit={() => void submitForm()}
        onClose={close}
      />
      <DeleteSynonymDialog
        t={t}
        group={dialog.kind === "delete" ? dialog.group : null}
        busy={busy}
        error={dialog.kind === "delete" ? dialogError : null}
        errorRef={errorRef}
        onConfirm={() => void confirmDelete()}
        onClose={close}
      />
    </>
  );
}

/** `/search/synonyms`: the synonym groups per language (read with catalog.read, changed with catalog.write). */
export function SearchSynonymsPage() {
  const { t } = useI18n();
  // The status gives the shop's languages, the queue number and which languages wait for settings; it is read again after a write.
  const status = useRefreshingResource((signal) => adminClient.getSearchStatus({ signal }), []);
  const screen =
    status.fallback !== null ? searchScreenState(status.fallback) : ({ kind: "data" } as const);
  return (
    <SearchFrame t={t} current="searchSynonyms" title={t("page.searchSynonyms.title")}>
      {screen.kind === "off" ? (
        <SearchOffView t={t} />
      ) : status.data !== null ? (
        <SynonymsLoaded status={status.data} reloadStatus={status.reload} />
      ) : status.fallback === null ? (
        <LoadingView t={t} />
      ) : (
        <ResourceFallback t={t} state={status.fallback} onRetry={status.reload} />
      )}
    </SearchFrame>
  );
}
