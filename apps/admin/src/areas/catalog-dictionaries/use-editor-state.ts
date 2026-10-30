import { useCallback, useRef, useState, type RefObject } from "react";
import { useFocusAfterCommit } from "../../lib/use-focus-after-commit";
import type { NoticeKind } from "./dictionary-frame";

export interface EditorState {
  notice: { kind: NoticeKind; n: number } | null;
  noticeRef: RefObject<HTMLDivElement | null>;
  /**
   * A write ended (saved, or the answer was lost): show the notice, move the focus to it, and reload what the server has.
   * "No changes" sent nothing, so it reloads nothing.
   */
  changed: (kind: NoticeKind) => void;
  confirmingDelete: boolean;
  setConfirmingDelete: (value: boolean) => void;
  deleted: boolean;
  setDeleted: (value: boolean) => void;
}

/** The state every dictionary editor page shares: the status line, the delete confirmation, and "this item is gone". */
export function useEditorState(reload: () => void): EditorState {
  const [notice, setNotice] = useState<{ kind: NoticeKind; n: number } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  const focusAfterCommit = useFocusAfterCommit();
  const changed = useCallback(
    (kind: NoticeKind) => {
      setNotice((current) => ({ kind, n: (current?.n ?? 0) + 1 }));
      if (kind !== "noChanges") reload();
      focusAfterCommit(noticeRef);
    },
    [reload, focusAfterCommit],
  );
  return { notice, noticeRef, changed, confirmingDelete, setConfirmingDelete, deleted, setDeleted };
}
