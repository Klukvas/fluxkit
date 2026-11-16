"use client";

import { Button, Dialog } from "@fluxkit/ui";
import { useEffect, useState } from "react";
import { demoNoticeUrls } from "../config/demo-notice";
import { useI18n } from "./i18n-provider";
import { secondaryLinkButton } from "./styles";

/** Mounted only in demo mode. Storage is browser-only and contains no shopper data. */
export function DemoNoticeDialog() {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem("fluxkit_demo_notice_seen") === null) {
        window.localStorage.setItem("fluxkit_demo_notice_seen", "true");
        setOpen(true);
      }
    } catch {
      // Failed reads or writes cannot remember this visit: keep closed rather than nag on every page. The strip stays.
      setOpen(false);
    }
  }, []);

  function close() {
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("demo.title")}
      description={t("demo.body")}
      footer={
        <>
          <a
            href={demoNoticeUrls[locale]}
            target="_blank"
            rel="noopener noreferrer"
            className={secondaryLinkButton}
            onClick={close}
          >
            {t("demo.order")}
          </a>
          <Button className="min-h-11" onClick={close}>
            {t("demo.explore")}
          </Button>
        </>
      }
    >
      <p>{t("demo.cta")}</p>
    </Dialog>
  );
}
