/**
 * Hands a `Blob` to the browser as a download without navigating anywhere (privacy plan step 10: the personal-data export
 * comes from the typed client's response, so it never has a URL of its own). The blob lives behind a temporary object URL
 * that is revoked shortly after the click, so it never outlives the download. The browser's pieces are passed in, so the order
 * of the steps is tested without a DOM. No third-party code.
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
