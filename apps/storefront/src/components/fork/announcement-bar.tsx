import { Container } from "@fluxkit/ui";
import Link from "next/link";
import { announcementConfig, type AnnouncementConfig } from "../../config/announcement";
import { isPlainStorefrontPath, localizedHref } from "../../lib/locale-path";
import type { HeaderTopSlotProps } from "../../lib/slots";

/**
 * FORK (reshape R3): the thin announcement bar of the `header.top` slot (`docs/contracts/slots.md`), from
 * `config/announcement.ts`. A server component: its own full-width opaque surface, the text in the page width. Below `lg` it is
 * sticky with the header; `data-announcement-bar` lets app/globals.css raise `scroll-padding-top` for it (CORE-EDIT R3).
 * A link that is not a plain storefront path is left out (a slot component that throws takes every page down).
 */
export function AnnouncementBar({
  locale,
  t,
  config = announcementConfig,
}: HeaderTopSlotProps & {
  /** `config/announcement.ts`; a prop for tests. */
  config?: AnnouncementConfig;
}) {
  if (!config.enabled) return null;
  const link = config.link !== null && isPlainStorefrontPath(config.link.href) ? config.link : null;
  return (
    <div data-announcement-bar="" className="bg-primary text-primary-foreground">
      <Container>
        <p className="py-1 text-center text-sm">
          {t(config.textKey)}
          {link === null ? null : (
            <>
              {" "}
              <Link
                href={localizedHref(locale, link.href)}
                className="rounded-control font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {t(link.labelKey)}
              </Link>
            </>
          )}
        </p>
      </Container>
    </div>
  );
}
