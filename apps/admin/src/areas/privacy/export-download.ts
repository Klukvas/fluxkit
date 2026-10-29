/**
 * Hands the export `Blob` to the browser as a download without navigating to an API address (the strict CSP of the SPA makes
 * a page-level navigation the wrong tool, and the document holds personal data that must not be opened inside this origin).
 * The blob lives behind a temporary object URL that is revoked shortly after the click, so it never outlives the download.
 * The browser's pieces are passed in, so the order of the steps is tested without a DOM. (The same technique as the order
 * area's label download; kept separate so this area imports no other area's code.)
 */

export interface DownloadAnchor {
  href: string;
  download: string;
  hidden: boolean | string;
  click: () => void;
}

export interface DownloadEnvironment {
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  /** A link element attached to the page until `release` is called (some browsers ignore a detached link). */
  createAnchor: () => { anchor: DownloadAnchor; release: () => void };
  /** Runs `task` after `delayMs` (the revoke waits until the browser has started reading the blob). */
  schedule: (task: () => void, delayMs: number) => void;
}

/** How long the object URL stays valid after the click. */
export const REVOKE_DELAY_MS = 10_000;

export function downloadBlob(blob: Blob, filename: string, environment: DownloadEnvironment): void {
  const url = environment.createObjectUrl(blob);
  const { anchor, release } = environment.createAnchor();
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  try {
    anchor.click();
  } finally {
    release();
    environment.schedule(() => environment.revokeObjectUrl(url), REVOKE_DELAY_MS);
  }
}

/** The real browser. Only called from an event handler (a click), in the page. */
export function browserDownloadEnvironment(): DownloadEnvironment {
  return {
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    createAnchor: () => {
      const anchor = document.createElement("a");
      anchor.rel = "noopener";
      document.body.append(anchor);
      return { anchor, release: () => anchor.remove() };
    },
    schedule: (task, delayMs) => {
      window.setTimeout(task, delayMs);
    },
  };
}
