import type { AdminProduct, AdminProductTypeDetail } from "@fluxkit/api-client";
import { useEffect } from "react";
import type { EditorNoticeKind } from "./editor-notice";
import type { ContentLocales } from "../catalog-dictionaries/form-parts";
import type { PublishProblem } from "./publish-problems";

/** What the editor gives every tab panel (`src/layout/product-editor.ts`). */
export interface ProductTabProps {
  product: AdminProduct;
  productType: AdminProductTypeDetail;
  content: ContentLocales;
  /** The problems of the last publish attempt (each tab shows its own). */
  problems: readonly PublishProblem[];
  /** A write ended: the editor shows the status line and reloads the product (never a local change). */
  onChanged: (kind: EditorNoticeKind) => void;
  /** Whether the tab has unsaved input (the editor locks the lifecycle actions meanwhile). */
  onDirtyChange: (dirty: boolean) => void;
}

/** Reports a tab's dirty state to the editor, and "clean" when the tab goes away. */
export function useReportDirty(dirty: boolean, onDirtyChange: (dirty: boolean) => void): void {
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
}
