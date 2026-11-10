import Link from "next/link";
import { announcementConfig, type AnnouncementConfig } from "../config/announcement";
import { localizedHref } from "../lib/locale-path";
import type { HeaderTopSlotProps } from "../lib/slots";
import { focusRing } from "./styles";

/**
 * The `header.top` slot component of the fork (`config/slots.tsx`): a thin bar above the header's row, its text and link from
 * `config/announcement.ts`. Shown from `lg` only: below it the header is sticky and a bar would grow it while
 * `scroll-padding-top` stays 80 px (`docs/customization.md`, UI slots). A SERVER component; `config` is a prop for tests.
 */
export function AnnouncementBar({
  locale,
  t,
  config = announcementConfig,
}: HeaderTopSlotProps & { config?: AnnouncementConfig }) {
  if (!config.enabled) return null;
  return (
    <div className="bg-primary py-1 text-center text-sm text-primary-foreground max-lg:hidden">
      <p>
        {t(config.messageKey)}
        {config.href === null ? null : (
          <>
            {" "}
            <Link
              href={localizedHref(locale, config.href)}
              className={`font-medium underline underline-offset-4 ${focusRing}`}
            >
              {t(config.linkLabelKey)}
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
