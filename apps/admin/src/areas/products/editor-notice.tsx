import { LiveRegion, type Translator } from "@fluxkit/ui";
import type { Ref } from "react";
import { UnknownResultNotice } from "../catalog-dictionaries/form-parts";

/** What the editor's status line can say after a write. */
export const EDITOR_NOTICE_KINDS = [
  "saved",
  "noChanges",
  "unknown",
  "published",
  "unpublished",
  "archived",
  "restored",
] as const;
export type EditorNoticeKind = (typeof EDITOR_NOTICE_KINDS)[number];

const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * The editor's status line: always in the page (a live region announces a change of a region that already exists) and
 * focusable, so the focus moves to it after a write. A lost answer is a warning to look at the reloaded product.
 */
export function EditorNoticeBar({
  t,
  notice,
  innerRef,
}: {
  t: Translator;
  notice: { kind: EditorNoticeKind; n: number } | null;
  innerRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={innerRef} tabIndex={-1} className={focusClass}>
      <LiveRegion>
        {notice === null ? null : notice.kind === "unknown" ? (
          <UnknownResultNotice t={t} />
        ) : (
          <p className="rounded-md border border-success p-3 text-foreground">
            {t(`products.notice.${notice.kind}`)}
          </p>
        )}
      </LiveRegion>
    </div>
  );
}
