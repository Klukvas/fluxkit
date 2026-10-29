"use client";

import { Container } from "@fluxkit/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { runAccountDeletion } from "../lib/delete-account";
import { failureFromThrown } from "../lib/failure";
import { browserDownloadEnvironment, downloadBlob } from "../lib/file-download";
import { localizedHref } from "../lib/locale-path";
import { exportBlob, exportFileName, mapExportFailure, type WaitParts } from "../lib/personal-data";
import { AccountGate } from "./account-gate";
import {
  DELETE_FIELDS,
  DELETE_IDS,
  DeleteSection,
  ExportSection,
  type ExportState,
} from "./account-data-views";
import { useI18n } from "./i18n-provider";
import { useAccount, useStoreClient } from "./session-provider";
import { useForm } from "./use-form";

const NO_STORE = { fetchOptions: { cache: "no-store" } } as const;

/** "Download my data": one request per click (a second click while one runs does nothing), the file built in the browser. */
function ExportPanel() {
  const { t } = useI18n();
  const client = useStoreClient();
  const { store } = useAccount();
  const [state, setState] = useState<ExportState>({ status: "idle" });
  const running = useRef(false);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The result is announced by the live region and the focus moves to it, so a keyboard user lands on the news.
    if (state.status === "done" || state.status === "failed") statusRef.current?.focus();
  }, [state]);

  async function download(): Promise<void> {
    if (running.current) return;
    running.current = true;
    setState({ status: "pending" });
    try {
      const result = await client.getDataExport(NO_STORE);
      if (result.ok) {
        // The file is the typed client's parsed document written as JSON: no URL of its own, nothing leaves the browser.
        downloadBlob(
          exportBlob(result.data),
          exportFileName(result.data),
          browserDownloadEnvironment(),
        );
        setState({ status: "done", file: exportFileName(result.data) });
        return;
      }
      const reason = mapExportFailure(result);
      // A 401 means the session ended: the account gate takes the shopper to the sign-in page.
      if (reason.kind === "signed_out") store.sessionEnded();
      setState({ status: "failed", reason });
    } catch (error) {
      setState({ status: "failed", reason: { kind: "other", failure: failureFromThrown(error) } });
    } finally {
      running.current = false;
    }
  }

  return (
    <ExportSection t={t} state={state} onDownload={() => void download()} statusRef={statusRef} />
  );
}

/** "Delete my account": password and the typed word, then the one request. Success leaves for the confirmation page. */
function DeletePanel() {
  const { t, locale } = useI18n();
  const client = useStoreClient();
  const { store } = useAccount();
  const router = useRouter();
  const [blocked, setBlocked] = useState<string[] | null>(null);
  const [limited, setLimited] = useState<WaitParts | null | undefined>(undefined);
  const blockedRef = useRef<HTMLDivElement>(null);
  const form = useForm<Record<(typeof DELETE_FIELDS)[number], string>>({
    initial: { password: "", confirmWord: "" },
    fieldOrder: DELETE_FIELDS,
    fieldIds: DELETE_IDS,
  });

  useEffect(() => {
    if (blocked !== null) blockedRef.current?.focus();
  }, [blocked]);

  return (
    <DeleteSection
      t={t}
      values={form.values}
      onValueChange={(name, value) => {
        form.setValue(name, value);
      }}
      pending={form.pending}
      failure={form.failure}
      blocked={blocked}
      {...(limited === undefined ? {} : { limited })}
      summaryRef={form.summaryRef}
      blockedRef={blockedRef}
      onSubmit={(event) =>
        form.submit(event, {
          required: DELETE_FIELDS,
          leaves: true,
          // The rules (typed word first, one request, the password cleared after every failed answer) are in `lib/delete-account.ts`.
          run: (values) =>
            runAccountDeletion({
              values,
              expectedWord: t("account.data.delete.word"),
              client,
              callOptions: NO_STORE,
              effects: {
                setBlocked,
                setLimited,
                clearPassword: () => {
                  form.setValue("password", "");
                },
                clearAll: () => {
                  form.setValues({ password: "", confirmWord: "" });
                },
                sessionEnded: () => {
                  store.sessionEnded();
                },
                leave: () => {
                  router.replace(localizedHref(locale, "/account/deleted"));
                },
              },
            }),
        })
      }
    />
  );
}

/** `/account/data`: what the shop keeps, a download of it, and deleting the account. */
export function AccountDataPage() {
  const { t, locale } = useI18n();
  return (
    <AccountGate titleKey="account.data.title">
      {() => (
        <Container className="flex flex-col gap-10 py-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold text-foreground">{t("account.data.title")}</h1>
            <Link
              href={localizedHref(locale, "/account")}
              className="self-start underline underline-offset-4"
            >
              {t("account.profile.back")}
            </Link>
            <p className="max-w-prose text-foreground">{t("account.data.intro")}</p>
            <ul className="max-w-prose list-disc ps-5 text-foreground">
              <li>{t("account.data.keeps.account")}</li>
              <li>{t("account.data.keeps.orders")}</li>
              <li>{t("account.data.keeps.mail")}</li>
              <li>{t("account.data.keeps.session")}</li>
            </ul>
            <p className="text-muted-foreground">
              {t("account.data.policy")}{" "}
              <Link
                href={localizedHref(locale, "/legal/privacy")}
                className="underline underline-offset-4"
              >
                {t("notice.privacyLink")}
              </Link>
            </p>
          </div>
          <ExportPanel />
          <DeletePanel />
        </Container>
      )}
    </AccountGate>
  );
}
