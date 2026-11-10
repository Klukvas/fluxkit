import { Container } from "@fluxkit/ui";
import Link from "next/link";
import { announcement } from "../config/announcement";
import { localizedHref } from "../lib/locale-path";
import type { HeaderTopSlotProps } from "../lib/slots";

/**
 * FORK slot component (`header.top`): a thin, one-line announcement bar from `config/announcement.ts`. Kept to one short line
 * (`text-xs`, truncated) because below `lg` it is sticky with the header (`docs/contracts/slots.md`).
 */
export function AnnouncementBar({ locale, t }: HeaderTopSlotProps) {
  if (announcement === null) return null;
  const text = t(announcement.messageKey);
  return (
    <div data-announcement="" className="bg-primary text-primary-foreground">
      <Container>
        <p className="truncate py-1 text-center text-xs">
          {announcement.href === null ? (
            text
          ) : (
            <Link
              href={localizedHref(locale, announcement.href)}
              className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {text}
            </Link>
          )}
        </p>
      </Container>
    </div>
  );
}
