/**
 * The ONLY place the Email area renders HTML that did not come from this app. The preview HTML is the output of a mail
 * template (built-ins, or a feature's): it is markup for a mail client, with inline styles and links, and must never run in
 * the admin page. It is shown in an iframe with an EMPTY `sandbox`: no scripts, no same-origin access (the document gets an
 * opaque origin, so it cannot read the admin page, the cookie or the API), no forms, no popups, no top navigation. `srcdoc`
 * keeps it off the network (no request is made for the document). A source guard (`email-source.spec.ts`) pins this file as
 * the only iframe and the empty sandbox; the e2e test reads the attribute in the browser.
 */
export const PREVIEW_SANDBOX = "";

export function SandboxedMailFrame({ title, html }: { title: string; html: string }) {
  return (
    <iframe
      title={title}
      sandbox={PREVIEW_SANDBOX}
      srcDoc={html}
      referrerPolicy="no-referrer"
      loading="eager"
      className="h-160 w-full rounded-md border border-border bg-background"
    />
  );
}
