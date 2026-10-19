"use client";

import type { CartNotice } from "@fluxkit/api-client";
import { Alert, Button, Container, type Translator } from "@fluxkit/ui";
import { cartNoticeMessageKey } from "../lib/cart-model";
import { useI18n } from "./i18n-provider";
import { useAccount } from "./session-provider";

/**
 * What the merge of the guest cart into the account's cart changed (`cartNotices` of a sign-in or registration): shown ONCE,
 * on whatever page the shopper lands on, until they dismiss it. It sits at the top of `<main>` (`SiteShell`), the only
 * place that renders it, so a notice can never appear twice. A polite `status` message: it does not interrupt.
 */
export function CartNoticesView({
  notices,
  t,
  onDismiss,
}: {
  notices: readonly CartNotice[];
  t: Translator;
  onDismiss: () => void;
}) {
  if (notices.length === 0) return null;
  return (
    <Container className="pt-4">
      <Alert variant="warning" title={t("account.cartNotice.title")}>
        <ul className="mt-1 list-disc ps-5">
          {notices.map((notice) => (
            <li key={notice.code}>{t(cartNoticeMessageKey(notice.code))}</li>
          ))}
        </ul>
        <Button variant="secondary" className="mt-3" onClick={onDismiss}>
          {t("account.cartNotice.dismiss")}
        </Button>
      </Alert>
    </Container>
  );
}

export function SessionNotices() {
  const { t } = useI18n();
  const { state, store } = useAccount();
  return (
    <CartNoticesView
      notices={state.cartNotices}
      t={t}
      onDismiss={() => store.dismissCartNotices()}
    />
  );
}
