import type { AdminEmailStatus } from "@fluxkit/api-client";
import { locales } from "@fluxkit/ui";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { runWrite } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { useRefreshingResource } from "../../lib/use-refreshing-resource";
import { EmailFrame } from "./email-frame";
import { useCanManageEmail } from "./email-permissions";
import { StatusView, TestSendPanel, type StatusState } from "./status-view";
import { testSendViewFrom, type TestSendView } from "./test-send";

function TestSend({
  status,
  uiLocale,
  onSent,
}: {
  status: AdminEmailStatus;
  uiLocale: string;
  onSent: () => void;
}) {
  const { t } = useI18n();
  const canManage = useCanManageEmail();
  const [locale, setLocale] = useState<string>(
    (locales as readonly string[]).includes(uiLocale) ? uiLocale : (locales[0] ?? "en"),
  );
  const [view, setView] = useState<TestSendView>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [flight] = useState(createSingleFlight);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (view.kind !== "idle") resultRef.current?.focus();
  }, [view]);

  async function send() {
    if (!canManage || !status.configured) return;
    // One request per click, never repeated by the screen: a lost answer is shown and the admin looks at the list.
    const running = flight.run(() => runWrite(() => adminClient.sendTestEmail({ locale })));
    if (running === null) return;
    setBusy(true);
    setView({ kind: "idle" });
    const outcome = await running.finally(() => setBusy(false));
    setView(testSendViewFrom(outcome));
    if (outcome.kind !== "aborted") onSent();
  }

  return (
    <TestSendPanel
      t={t}
      configured={status.configured}
      canManage={canManage}
      locales={locales}
      locale={locale}
      onLocaleChange={setLocale}
      busy={busy}
      view={view}
      onSend={() => void send()}
      resultRef={resultRef}
    />
  );
}

/** `/email`: the delivery status, the 24 hour counts, the queue and the test send. */
export function EmailStatusPage() {
  const { t, locale } = useI18n();
  // The counts are read again after a test send; the panel (and its result) stays mounted meanwhile.
  const resource = useRefreshingResource((signal) => adminClient.getEmailStatus({ signal }), []);
  const [now] = useState(() => new Date());
  const state: StatusState =
    resource.fallback !== null
      ? resource.fallback
      : resource.data !== null
        ? { status: "ready", data: resource.data }
        : { status: "loading" };
  return (
    <EmailFrame t={t} current="email" title={t("page.email.title")}>
      <p className="max-w-prose text-muted-foreground">{t("mail.status.intro")}</p>
      <StatusView
        t={t}
        uiLocale={locale}
        state={state}
        now={now}
        onRetry={resource.reload}
        testSend={(status) => (
          <TestSend status={status} uiLocale={locale} onSent={resource.reload} />
        )}
      />
    </EmailFrame>
  );
}
